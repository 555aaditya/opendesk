package billing

// Auto-recharge and running-low handling for AI credits (contracts/billing.md
// "Auto-recharge"). When a charged AI call takes a workspace below its threshold, a
// unique River job buys credit packs off-session on the customer's saved payment method
// and grants them once per PaymentIntent. With auto-recharge off (or at its monthly
// limit), owners and admins are told once when credits run low and once when they run out.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/stripe/stripe-go/v87"

	"github.com/useopendesk/opendesk/internal/audit"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/jobs"
	"github.com/useopendesk/opendesk/internal/mailer"
	"github.com/useopendesk/opendesk/internal/plan"
)

// Auto-recharge defaults and bounds (the ai_auto_recharge columns).
const (
	DefaultRechargeThreshold = 200
	DefaultRechargePacks     = 1
	DefaultRechargeLimit     = 5
	MaxRechargeThreshold     = 100000
	MaxRechargePacks         = 20
	MaxRechargeLimit         = 30
)

// OutOfCreditsBelow is the balance under which a workspace counts as out of credits: a
// widget agent reply or a draft (3 credits each) can no longer start.
const OutOfCreditsBelow = plan.Milli(3000)

// Notification types sent to owners and admins.
const (
	NotifyCreditsLow          = "credits_low"
	NotifyCreditsOut          = "credits_out"
	NotifyAutoRechargeFailed  = "auto_recharge_failed"
	rechargeSource            = "stripe_auto_recharge"
	rechargeKind              = "auto_recharge"
	failCardDeclined          = "card_declined"
	failAuthenticationNeeded  = "authentication_required"
	failNoPaymentMethod       = "no_payment_method"
	failPaymentFailed         = "payment_failed"
	failUnavailable           = "unavailable"
	errPaymentMethodRequired  = "payment_method_required"
	paymentMethodRequiredText = "Add a payment method before turning on auto-recharge."
)

// AutoRecharge is Billing.auto_recharge: the settings and what happened last.
type AutoRecharge struct {
	Enabled            bool             `json:"enabled"`
	Threshold          int              `json:"threshold" doc:"Recharge when the remaining credits fall below this"`
	Packs              int              `json:"packs" doc:"Credit packs bought per recharge"`
	MonthlyLimit       int              `json:"monthly_limit" doc:"At most this many recharges per calendar month (UTC)"`
	RechargesThisMonth int              `json:"recharges_this_month"`
	LowAt              int              `json:"low_at" doc:"Remaining credits below this read as running low"`
	LastRecharge       *Recharge        `json:"last_recharge"`
	Failure            *RechargeFailure `json:"failure" doc:"Why auto-recharge turned itself off; null once it is back on"`
}

type Recharge struct {
	At       time.Time `json:"at"`
	Packs    int       `json:"packs"`
	Credits  int       `json:"credits"`
	Amount   int64     `json:"amount" doc:"In the currency's minor unit"`
	Currency string    `json:"currency"`
}

type RechargeFailure struct {
	Code string    `json:"code" enum:"card_declined,authentication_required,no_payment_method,payment_failed,unavailable"`
	At   time.Time `json:"at"`
}

// rechargeSettings is one ai_auto_recharge row (or the defaults).
type rechargeSettings struct {
	Enabled                  bool
	Threshold, Packs, Limit  int
	FailureCode              *string
	FailedAt                 *time.Time
	LowNotified, OutNotified *time.Time
}

func defaultSettings() rechargeSettings {
	return rechargeSettings{Threshold: DefaultRechargeThreshold, Packs: DefaultRechargePacks, Limit: DefaultRechargeLimit}
}

func readSettings(ctx context.Context, q db.Querier, wid uuid.UUID, forUpdate bool) (rechargeSettings, error) {
	st := defaultSettings()
	sql := `SELECT enabled, threshold, packs, monthly_limit, failure_code, failed_at, low_notified_at, out_notified_at
		FROM ai_auto_recharge WHERE workspace_id = $1`
	if forUpdate {
		sql += ` FOR UPDATE`
	}
	err := q.QueryRow(ctx, sql, wid).Scan(&st.Enabled, &st.Threshold, &st.Packs, &st.Limit, &st.FailureCode, &st.FailedAt,
		&st.LowNotified, &st.OutNotified)
	if db.IsNotFound(err) {
		return defaultSettings(), nil
	}
	return st, err
}

func ensureSettings(ctx context.Context, q db.Querier, wid uuid.UUID) error {
	_, err := q.Exec(ctx, `INSERT INTO ai_auto_recharge (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING`, wid)
	return err
}

func monthStart(now time.Time) time.Time {
	now = now.UTC()
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// rechargesThisMonth counts recharges that charged or may still charge this month.
func rechargesThisMonth(ctx context.Context, q db.Querier, wid uuid.UUID) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM ai_auto_recharges WHERE workspace_id = $1 AND status IN ('pending', 'succeeded')
		AND created_at >= $2`, wid, monthStart(time.Now())).Scan(&n)
	return n, err
}

// LowAt is the balance (credits) under which a workspace is running low: the
// auto-recharge threshold, but never more than a fifth of the monthly allowance (at
// least 5), so a small allowance does not read as low from its first call.
func LowAt(threshold, monthly int) int {
	if threshold <= 0 {
		threshold = DefaultRechargeThreshold
	}
	return min(threshold, max(monthly/5, 5))
}

func loadAutoRecharge(ctx context.Context, q db.Querier, wid uuid.UUID, monthly int) (*AutoRecharge, error) {
	st, err := readSettings(ctx, q, wid, false)
	if err != nil {
		return nil, err
	}
	ar := &AutoRecharge{Enabled: st.Enabled, Threshold: st.Threshold, Packs: st.Packs, MonthlyLimit: st.Limit, LowAt: LowAt(st.Threshold, monthly)}
	if st.Enabled {
		ar.LowAt = st.Threshold
	}
	if ar.RechargesThisMonth, err = rechargesThisMonth(ctx, q, wid); err != nil {
		return nil, err
	}
	var r Recharge
	err = q.QueryRow(ctx, `SELECT updated_at, packs, credits, amount, currency FROM ai_auto_recharges
		WHERE workspace_id = $1 AND status = 'succeeded' ORDER BY updated_at DESC LIMIT 1`, wid).
		Scan(&r.At, &r.Packs, &r.Credits, &r.Amount, &r.Currency)
	switch {
	case err == nil:
		ar.LastRecharge = &r
	case !db.IsNotFound(err):
		return nil, err
	}
	if !st.Enabled && st.FailureCode != nil && st.FailedAt != nil {
		ar.Failure = &RechargeFailure{Code: *st.FailureCode, At: *st.FailedAt}
	}
	return ar, nil
}

func rechargeOpts() *river.InsertOpts {
	return &river.InsertOpts{Queue: jobs.QueueDefault, MaxAttempts: 6,
		UniqueOpts: river.UniqueOpts{ByArgs: true, ByState: uniqueStates}}
}

// ─── API ───────────────────────────────────────────────────────────────────

func (s *svc) registerRechargeAPI(api huma.API) {
	tags := []string{"Billing"}

	huma.Register(api, huma.Operation{OperationID: "update-billing-auto-recharge", Method: http.MethodPatch, Path: "/v1/billing/auto-recharge",
		Summary: "Change the AI credits auto-recharge settings", Tags: tags},
		func(ctx context.Context, in *struct {
			Body struct {
				Enabled      *bool `json:"enabled,omitempty"`
				Threshold    *int  `json:"threshold,omitempty" minimum:"1" maximum:"100000" doc:"Recharge when the remaining credits fall below this"`
				Packs        *int  `json:"packs,omitempty" minimum:"1" maximum:"20" doc:"Credit packs per recharge"`
				MonthlyLimit *int  `json:"monthly_limit,omitempty" minimum:"1" maximum:"30" doc:"Recharges per calendar month (UTC)"`
			}
		}) (*struct{ Body Billing }, error) {
			if !s.enabled() {
				return nil, errDisabled()
			}
			p, err := requireBillingAdmin(ctx)
			if err != nil {
				return nil, err
			}
			wid := p.WorkspaceID
			if !s.d.Limiter.Allow("billing:auto_recharge:"+wid.String(), 120, time.Hour) {
				return nil, httpx.RateLimited()
			}
			body := in.Body
			cur, err := readSettings(ctx, s.d.DB.Pool, wid, false)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if body.Enabled != nil && *body.Enabled && !cur.Enabled {
				if s.d.Cfg.StripePriceCredits == "" {
					return nil, httpx.E(422, "credits_unavailable", "Credit packs are not available.")
				}
				cus, err := s.customerID(ctx, s.d.DB.Pool, wid)
				if err != nil {
					return nil, httpx.Wrap(err)
				}
				if cus == "" {
					return nil, httpx.E(409, errPaymentMethodRequired, paymentMethodRequiredText)
				}
				pm, err := s.paymentMethod(ctx, cus)
				if err != nil {
					return nil, s.wrapStripe(err)
				}
				if pm == "" {
					return nil, httpx.E(409, errPaymentMethodRequired, paymentMethodRequiredText)
				}
			}
			prices := s.pricesFor(ctx)
			var out Billing
			err = s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
				if err := plan.Ensure(ctx, tx, wid); err != nil {
					return err
				}
				if err := ensureSettings(ctx, tx, wid); err != nil {
					return err
				}
				st, err := readSettings(ctx, tx, wid, true)
				if err != nil {
					return err
				}
				next := st
				if body.Enabled != nil {
					next.Enabled = *body.Enabled
				}
				if body.Threshold != nil {
					next.Threshold = *body.Threshold
				}
				if body.Packs != nil {
					next.Packs = *body.Packs
				}
				if body.MonthlyLimit != nil {
					next.Limit = *body.MonthlyLimit
				}
				// One recharge must lift the balance back above the threshold, or every
				// charged call after it would buy again until the monthly limit.
				if next.Packs*plan.CreditPackSize <= next.Threshold {
					return httpx.E(422, "recharge_too_small", "Each recharge must bring your credits back above the threshold. Buy more packs per recharge or lower the threshold.")
				}
				changes := map[string]any{}
				if next.Enabled != st.Enabled {
					changes["enabled"] = next.Enabled
				}
				if next.Threshold != st.Threshold {
					changes["threshold"] = next.Threshold
				}
				if next.Packs != st.Packs {
					changes["packs"] = next.Packs
				}
				if next.Limit != st.Limit {
					changes["monthly_limit"] = next.Limit
				}
				if len(changes) > 0 {
					// Turning it on clears the last failure.
					if _, err := tx.Exec(ctx, `UPDATE ai_auto_recharge SET enabled = $2, threshold = $3, packs = $4, monthly_limit = $5,
						failure_code = CASE WHEN $2 AND NOT enabled THEN NULL ELSE failure_code END,
						failed_at = CASE WHEN $2 AND NOT enabled THEN NULL ELSE failed_at END,
						updated_at = now() WHERE workspace_id = $1`, wid, next.Enabled, next.Threshold, next.Packs, next.Limit); err != nil {
						return err
					}
					if err := audit.Log(ctx, tx, p, wid, "billing.auto_recharge_updated", "workspace", &wid, changes); err != nil {
						return err
					}
				}
				if next.Enabled {
					// Already below the threshold: recharge now.
					c, err := s.d.Plan.Balance(ctx, tx, wid)
					if err != nil {
						return err
					}
					if !c.Unlimited && c.Remaining < plan.Milli(next.Threshold)*1000 {
						if _, err := s.d.Jobs.InsertTx(ctx, tx, jobs.AutoRechargeArgs{WorkspaceID: wid}, rechargeOpts()); err != nil {
							return err
						}
					}
				}
				if len(changes) > 0 {
					if err := s.publish(ctx, tx, wid, prices); err != nil {
						return err
					}
				}
				out, err = s.load(ctx, tx, wid, prices)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body Billing }{out}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "create-billing-payment-method", Method: http.MethodPost, Path: "/v1/billing/payment-method",
		Summary: "Start a Stripe Checkout that saves a payment method", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*urlBody, error) {
			if !s.enabled() {
				return nil, errDisabled()
			}
			p, err := requireBillingAdmin(ctx)
			if err != nil {
				return nil, err
			}
			if !s.d.Limiter.Allow("billing:checkout:"+p.WorkspaceID.String(), 30, time.Hour) {
				return nil, httpx.RateLimited()
			}
			cus, err := s.customer(ctx, p.WorkspaceID)
			if err != nil {
				return nil, s.wrapStripe(err)
			}
			currency := "usd"
			if pack := s.pricesFor(ctx).CreditPack; pack != nil && pack.Currency != "" {
				currency = pack.Currency
			}
			wid := p.WorkspaceID.String()
			meta := map[string]string{"workspace_id": wid, "kind": "payment_method"}
			sess, err := s.sc.V1CheckoutSessions.Create(ctx, &stripe.CheckoutSessionCreateParams{
				Mode:              stripe.String(string(stripe.CheckoutSessionModeSetup)),
				Customer:          stripe.String(cus),
				ClientReferenceID: stripe.String(wid),
				Currency:          stripe.String(currency),
				SuccessURL:        stripe.String(s.appURL("payment_method", "success")),
				CancelURL:         stripe.String(s.appURL("payment_method", "canceled")),
				Metadata:          meta,
				SetupIntentData:   &stripe.CheckoutSessionCreateSetupIntentDataParams{Metadata: meta},
			})
			if err != nil {
				return nil, s.wrapStripe(err)
			}
			return newURL(sess.URL), nil
		})
}

// customerID is the workspace's Stripe customer, or "" before any purchase.
func (s *svc) customerID(ctx context.Context, q db.Querier, wid uuid.UUID) (string, error) {
	var cus *string
	err := q.QueryRow(ctx, `SELECT stripe_customer_id FROM subscriptions WHERE workspace_id = $1`, wid).Scan(&cus)
	if db.IsNotFound(err) || cus == nil {
		return "", nil
	}
	return *cus, err
}

// paymentMethod is the payment method an off-session charge uses: the customer's
// default, else the most recently saved one. "" means none is saved.
func (s *svc) paymentMethod(ctx context.Context, cus string) (string, error) {
	c, err := s.sc.V1Customers.Retrieve(ctx, cus, nil)
	if isMissing(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if c.Deleted {
		return "", nil
	}
	if c.InvoiceSettings != nil && c.InvoiceSettings.DefaultPaymentMethod != nil && c.InvoiceSettings.DefaultPaymentMethod.ID != "" {
		return c.InvoiceSettings.DefaultPaymentMethod.ID, nil
	}
	params := &stripe.CustomerListPaymentMethodsParams{Customer: stripe.String(cus)}
	params.Limit = stripe.Int64(1)
	params.Single = true
	for pm, err := range s.sc.V1Customers.ListPaymentMethods(ctx, params).All(ctx) {
		if err != nil {
			if isMissing(err) {
				return "", nil
			}
			return "", err
		}
		return pm.ID, nil
	}
	return "", nil
}

// ensureDefaultPM makes a saved payment method the customer's default, so the portal
// and off-session charges use it: pm when given (a setup Checkout), else the most recent
// one when the customer has no default yet. Best effort: failures are logged.
func (s *svc) ensureDefaultPM(ctx context.Context, cus, pm string) {
	if cus == "" {
		return
	}
	if pm == "" {
		c, err := s.sc.V1Customers.Retrieve(ctx, cus, nil)
		if err != nil {
			if !isMissing(err) {
				s.d.Log.Warn("stripe customer", "err", stripeErr(err))
			}
			return
		}
		if c.Deleted || (c.InvoiceSettings != nil && c.InvoiceSettings.DefaultPaymentMethod != nil) {
			return
		}
		if pm, err = s.paymentMethod(ctx, cus); err != nil || pm == "" {
			if err != nil {
				s.d.Log.Warn("stripe payment methods", "err", stripeErr(err))
			}
			return
		}
	}
	if _, err := s.sc.V1Customers.Update(ctx, cus, &stripe.CustomerUpdateParams{
		InvoiceSettings: &stripe.CustomerUpdateInvoiceSettingsParams{DefaultPaymentMethod: stripe.String(pm)}}); err != nil {
		s.d.Log.Warn("stripe default payment method", "err", stripeErr(err))
	}
}

// ─── Spend hook ────────────────────────────────────────────────────────────

// onSpend runs after every charged AI call (plan.Service.OnSpend). It never fails the
// call: problems are logged.
func (s *svc) onSpend(ctx context.Context, wid uuid.UUID, before, after plan.Milli) {
	if !s.enabled() {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if err := s.afterSpend(ctx, wid, before, after); err != nil {
		s.d.Log.Warn("credits after spend", "workspace_id", wid, "err", err)
	}
}

func (s *svc) afterSpend(ctx context.Context, wid uuid.UUID, before, after plan.Milli) error {
	pool := s.d.DB.Pool
	st, err := readSettings(ctx, pool, wid, false)
	if err != nil {
		return err
	}
	threshold := plan.Milli(st.Threshold) * 1000
	// LowAt never exceeds the threshold, so nothing below happens above it.
	if after >= max(threshold, OutOfCreditsBelow) {
		return nil
	}
	if st.Enabled && after < threshold {
		n, err := rechargesThisMonth(ctx, pool, wid)
		if err != nil {
			return err
		}
		if n < st.Limit {
			if s.d.Jobs == nil {
				return nil
			}
			_, err := s.d.Jobs.Insert(ctx, jobs.AutoRechargeArgs{WorkspaceID: wid}, rechargeOpts())
			return err
		}
		// At its monthly limit, auto-recharge waits for next month: the notices below apply.
	}
	if before >= OutOfCreditsBelow && after < OutOfCreditsBelow {
		return s.notifyOnce(ctx, wid, NotifyCreditsOut, after)
	}
	e, err := s.d.Plan.Entitlements(ctx, pool, wid)
	if err != nil {
		return err
	}
	low := plan.Milli(LowAt(st.Threshold, e.MonthlyCredits)) * 1000
	if st.Enabled {
		low = threshold
	}
	if before >= low && after < low && after >= OutOfCreditsBelow {
		return s.notifyOnce(ctx, wid, NotifyCreditsLow, after)
	}
	return nil
}

// notifyOnce sends a running-low or out-of-credits notice to owners and admins, once
// per period: a grant or a new month re-arms it.
func (s *svc) notifyOnce(ctx context.Context, wid uuid.UUID, typ string, remaining plan.Milli) error {
	col := "low_notified_at"
	if typ == NotifyCreditsOut {
		col = "out_notified_at"
	}
	prices := s.pricesFor(ctx)
	return s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		if err := ensureSettings(ctx, tx, wid); err != nil {
			return err
		}
		st, err := readSettings(ctx, tx, wid, true)
		if err != nil {
			return err
		}
		sent := st.LowNotified
		if typ == NotifyCreditsOut {
			sent = st.OutNotified
		}
		if sent != nil && !sent.Before(monthStart(time.Now())) {
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE ai_auto_recharge SET `+col+` = now() WHERE workspace_id = $1`, wid); err != nil {
			return err
		}
		data := map[string]any{"remaining": remaining.Credits()}
		var mail *adminMail
		if typ == NotifyCreditsOut {
			mail = &adminMail{subject: "AI credits are out", title: "Your workspace is out of AI credits",
				body: []string{"Ollie has paused: the chat widget agent stops answering and drafts, summaries and other AI features are unavailable until credits are added.",
					"Buy a credit pack or turn on auto-recharge to keep Ollie working."},
				cta: "Buy credits"}
		}
		if err := s.notifyAdmins(ctx, tx, wid, typ, data, mail); err != nil {
			return err
		}
		// Spends publish nothing; this lets the app's running-low banner appear live.
		return s.publish(ctx, tx, wid, prices)
	})
}

type adminMail struct {
	subject, title, cta string
	body                []string
}

// notifyAdmins sends an in-app notification to every owner and admin and, with mail,
// an email too.
func (s *svc) notifyAdmins(ctx context.Context, tx pgx.Tx, wid uuid.UUID, typ string, data map[string]any, mail *adminMail) error {
	var name string
	if err := tx.QueryRow(ctx, `SELECT name FROM workspaces WHERE id = $1`, wid).Scan(&name); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT u.id, u.email FROM members m JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.role IN ('owner', 'admin')`, wid)
	if err != nil {
		return err
	}
	type admin struct {
		id    uuid.UUID
		email string
	}
	admins, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (admin, error) {
		var a admin
		return a, r.Scan(&a.id, &a.email)
	})
	if err != nil {
		return err
	}
	var html, text string
	if mail != nil {
		html, text = mailer.Layout(mail.title, mail.body, mail.cta, s.d.Cfg.AppURL+"/settings/billing",
			"You get this email because you are an owner or admin of "+name+".")
	}
	for _, a := range admins {
		d := make(map[string]any, len(data))
		for k, v := range data {
			d[k] = v
		}
		if err := hd.Notify(ctx, tx, wid, a.id, typ, nil, d); err != nil {
			return err
		}
		if mail != nil {
			if _, err := s.d.Jobs.InsertTx(ctx, tx, jobs.SystemEmailArgs{To: a.email, Subject: mail.subject + " for " + name, HTML: html, Text: text},
				&river.InsertOpts{Queue: jobs.QueueEmail, MaxAttempts: 8}); err != nil {
				return err
			}
		}
	}
	return nil
}

// ─── The recharge ──────────────────────────────────────────────────────────

type attempt struct {
	ID              uuid.UUID
	PaymentIntentID *string
	CustomerID      string
	PaymentMethodID string
	Packs, Credits  int
	Amount          int64
	Currency        string
}

func pendingAttempt(ctx context.Context, q db.Querier, wid uuid.UUID) (*attempt, error) {
	var a attempt
	err := q.QueryRow(ctx, `SELECT id, payment_intent_id, customer_id, payment_method_id, packs, credits, amount, currency
		FROM ai_auto_recharges WHERE workspace_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, wid).
		Scan(&a.ID, &a.PaymentIntentID, &a.CustomerID, &a.PaymentMethodID, &a.Packs, &a.Credits, &a.Amount, &a.Currency)
	if db.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// autoRechargeWorker buys credit packs off-session for one workspace.
type autoRechargeWorker struct {
	river.WorkerDefaults[jobs.AutoRechargeArgs]
	s *svc
}

func (w *autoRechargeWorker) Timeout(*river.Job[jobs.AutoRechargeArgs]) time.Duration {
	return 2 * time.Minute
}

func (w *autoRechargeWorker) Work(ctx context.Context, job *river.Job[jobs.AutoRechargeArgs]) error {
	s, wid := w.s, job.Args.WorkspaceID
	if !s.enabled() {
		return nil
	}
	pool := s.d.DB.Pool
	a, err := pendingAttempt(ctx, pool, wid)
	if err != nil {
		return err
	}
	if a != nil && a.PaymentIntentID != nil {
		// A payment Stripe was still processing: read where it stands.
		pi, err := s.sc.V1PaymentIntents.Retrieve(ctx, *a.PaymentIntentID, nil)
		if err != nil {
			return fmt.Errorf("retrieve payment intent: %s", stripeErr(err))
		}
		return s.settle(ctx, wid, a, pi)
	}
	st, err := readSettings(ctx, pool, wid, false)
	if err != nil {
		return err
	}
	if !st.Enabled {
		if a != nil {
			// Turned off before the charge went through; a late success still grants (webhook).
			_, err := pool.Exec(ctx, `UPDATE ai_auto_recharges SET status = 'failed', failure_code = $2, updated_at = now()
				WHERE id = $1 AND status = 'pending'`, a.ID, failPaymentFailed)
			return err
		}
		return nil
	}
	if a == nil {
		if a, err = s.newAttempt(ctx, wid, st); err != nil || a == nil {
			return err
		}
	}
	return s.charge(ctx, wid, a)
}

// newAttempt records the next recharge, or returns nil when none is due. A missing
// payment method or price turns auto-recharge off.
func (s *svc) newAttempt(ctx context.Context, wid uuid.UUID, st rechargeSettings) (*attempt, error) {
	pool := s.d.DB.Pool
	c, err := s.d.Plan.Balance(ctx, pool, wid)
	if err != nil {
		return nil, err
	}
	if c.Unlimited || c.Remaining >= plan.Milli(st.Threshold)*1000 {
		return nil, nil
	}
	n, err := rechargesThisMonth(ctx, pool, wid)
	if err != nil || n >= st.Limit {
		return nil, err
	}
	if s.d.Cfg.StripePriceCredits == "" {
		return nil, s.fail(ctx, wid, nil, failUnavailable)
	}
	pack := s.pricesFor(ctx).CreditPack
	if pack == nil || pack.UnitAmount <= 0 {
		return nil, errors.New("credit pack price unavailable")
	}
	cus, err := s.customerID(ctx, pool, wid)
	if err != nil {
		return nil, err
	}
	pm := ""
	if cus != "" {
		if pm, err = s.paymentMethod(ctx, cus); err != nil {
			return nil, fmt.Errorf("payment method: %s", stripeErr(err))
		}
	}
	if pm == "" {
		return nil, s.fail(ctx, wid, nil, failNoPaymentMethod)
	}
	a := &attempt{CustomerID: cus, PaymentMethodID: pm, Packs: st.Packs, Credits: st.Packs * plan.CreditPackSize,
		Amount: pack.UnitAmount * int64(st.Packs), Currency: pack.Currency}
	err = pool.QueryRow(ctx, `INSERT INTO ai_auto_recharges (workspace_id, customer_id, payment_method_id, packs, credits, amount, currency)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, wid, a.CustomerID, a.PaymentMethodID, a.Packs, a.Credits, a.Amount, a.Currency).Scan(&a.ID)
	return a, err
}

// charge creates the off-session PaymentIntent. The attempt id is the idempotency key,
// so a retry returns the same PaymentIntent instead of charging again.
func (s *svc) charge(ctx context.Context, wid uuid.UUID, a *attempt) error {
	meta := map[string]string{"workspace_id": wid.String(), "kind": rechargeKind, "packs": strconv.Itoa(a.Packs), "attempt_id": a.ID.String()}
	params := &stripe.PaymentIntentCreateParams{
		Amount:        stripe.Int64(a.Amount),
		Currency:      stripe.String(a.Currency),
		Customer:      stripe.String(a.CustomerID),
		PaymentMethod: stripe.String(a.PaymentMethodID),
		OffSession:    stripe.Bool(true),
		Confirm:       stripe.Bool(true),
		Description:   stripe.String(fmt.Sprintf("opendesk AI credits auto-recharge (%d credits)", a.Credits)),
		Metadata:      meta,
	}
	params.IdempotencyKey = stripe.String("od-recharge-" + a.ID.String())
	pi, err := s.sc.V1PaymentIntents.Create(ctx, params)
	if err != nil {
		var se *stripe.Error
		if errors.As(err, &se) && (se.Type == stripe.ErrorTypeCard || se.Code == stripe.ErrorCodeAuthenticationRequired) {
			code := failCardDeclined
			if se.Code == stripe.ErrorCodeAuthenticationRequired {
				code = failAuthenticationNeeded
			}
			if se.PaymentIntent != nil && se.PaymentIntent.ID != "" {
				if _, err := s.d.DB.Pool.Exec(ctx, `UPDATE ai_auto_recharges SET payment_intent_id = $2 WHERE id = $1 AND payment_intent_id IS NULL`,
					a.ID, se.PaymentIntent.ID); err != nil {
					return err
				}
			}
			s.d.Log.Info("auto-recharge declined", "workspace_id", wid, "code", code)
			return s.fail(ctx, wid, &a.ID, code)
		}
		return fmt.Errorf("create payment intent: %s", stripeErr(err))
	}
	return s.settle(ctx, wid, a, pi)
}

// settle applies a PaymentIntent's outcome to its attempt.
func (s *svc) settle(ctx context.Context, wid uuid.UUID, a *attempt, pi *stripe.PaymentIntent) error {
	switch pi.Status {
	case stripe.PaymentIntentStatusSucceeded:
		return s.grantRecharge(ctx, wid, a.ID, pi.ID)
	case stripe.PaymentIntentStatusProcessing:
		// The webhook (payment_intent.succeeded or payment_failed) finishes it.
		_, err := s.d.DB.Pool.Exec(ctx, `UPDATE ai_auto_recharges SET payment_intent_id = $2, updated_at = now() WHERE id = $1`, a.ID, pi.ID)
		return err
	default:
		code := failPaymentFailed
		if pi.Status == stripe.PaymentIntentStatusRequiresAction {
			code = failAuthenticationNeeded
		}
		if _, err := s.d.DB.Pool.Exec(ctx, `UPDATE ai_auto_recharges SET payment_intent_id = $2 WHERE id = $1 AND payment_intent_id IS NULL`,
			a.ID, pi.ID); err != nil {
			return err
		}
		if pi.Status != stripe.PaymentIntentStatusCanceled {
			if _, err := s.sc.V1PaymentIntents.Cancel(ctx, pi.ID, nil); err != nil {
				s.d.Log.Warn("cancel payment intent", "err", stripeErr(err))
			}
		}
		return s.fail(ctx, wid, &a.ID, code)
	}
}

func (s *svc) grantRecharge(ctx context.Context, wid, attemptID uuid.UUID, piID string) error {
	prices := s.pricesFor(ctx)
	var granted bool
	var credits int
	err := s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		granted, credits, err = s.grantRechargeTx(ctx, tx, wid, attemptID, piID, 0)
		if err != nil || !granted {
			return err
		}
		return s.publish(ctx, tx, wid, prices)
	})
	if err == nil && granted {
		s.d.Analytics.Capture(wid.String(), wid.String(), "credits_recharged", map[string]any{"credits": credits})
	}
	return err
}

// grantRechargeTx grants a recharge's credits once per PaymentIntent and marks its
// attempt succeeded. packs (from the PaymentIntent metadata) is used when the attempt
// row is gone; 0 reads it from the attempt.
func (s *svc) grantRechargeTx(ctx context.Context, tx pgx.Tx, wid, attemptID uuid.UUID, piID string, packs int) (bool, int, error) {
	var rowPacks int
	err := tx.QueryRow(ctx, `UPDATE ai_auto_recharges SET status = 'succeeded', payment_intent_id = $3, failure_code = NULL, updated_at = now()
		WHERE id = $1 AND workspace_id = $2 RETURNING packs`, attemptID, wid, piID).Scan(&rowPacks)
	if err != nil && !db.IsNotFound(err) {
		return false, 0, err
	}
	if rowPacks > 0 {
		packs = rowPacks
	}
	if packs < 1 || packs > MaxRechargePacks {
		return false, 0, fmt.Errorf("payment intent %s: invalid packs", piID)
	}
	credits := packs * plan.CreditPackSize
	granted, err := plan.Grant(ctx, tx, wid, credits, rechargeSource, piID)
	if err != nil || !granted {
		return false, credits, err
	}
	if err := rearmNotices(ctx, tx, wid); err != nil {
		return false, credits, err
	}
	return true, credits, audit.Log(ctx, tx, nil, wid, "billing.credits_recharged", "workspace", &wid,
		map[string]any{"packs": packs, "credits": credits})
}

// rearmNotices lets the running-low notices fire again after credits were added.
func rearmNotices(ctx context.Context, tx pgx.Tx, wid uuid.UUID) error {
	_, err := tx.Exec(ctx, `UPDATE ai_auto_recharge SET low_notified_at = NULL, out_notified_at = NULL WHERE workspace_id = $1`, wid)
	return err
}

// fail turns auto-recharge off after a recharge could not be paid, tells owners and
// admins, and records why.
func (s *svc) fail(ctx context.Context, wid uuid.UUID, attemptID *uuid.UUID, code string) error {
	prices := s.pricesFor(ctx)
	return s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		return s.failTx(ctx, tx, wid, attemptID, code, prices)
	})
}

func (s *svc) failTx(ctx context.Context, tx pgx.Tx, wid uuid.UUID, attemptID *uuid.UUID, code string, prices Prices) error {
	if attemptID != nil {
		if _, err := tx.Exec(ctx, `UPDATE ai_auto_recharges SET status = 'failed', failure_code = $2, updated_at = now()
			WHERE id = $1 AND status = 'pending'`, *attemptID, code); err != nil {
			return err
		}
	}
	if err := ensureSettings(ctx, tx, wid); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE ai_auto_recharge SET enabled = false, failure_code = $2, failed_at = now(), updated_at = now()
		WHERE workspace_id = $1 AND enabled`, wid, code)
	if err != nil || tag.RowsAffected() == 0 {
		// Already off: someone turned it off, or an earlier failure did.
		return err
	}
	if err := audit.Log(ctx, tx, nil, wid, "billing.auto_recharge_failed", "workspace", &wid, map[string]any{"reason": code}); err != nil {
		return err
	}
	reason := map[string]string{
		failCardDeclined:         "The card on file was declined.",
		failAuthenticationNeeded: "The bank asked to confirm the payment, which cannot happen while nobody is at the checkout.",
		failNoPaymentMethod:      "There is no saved payment method.",
		failUnavailable:          "Credit packs are not available right now.",
	}[code]
	if reason == "" {
		reason = "The payment did not go through."
	}
	mail := &adminMail{subject: "Auto-recharge failed", title: "We could not recharge your AI credits",
		body: []string{reason + " Auto-recharge is now off, so nothing else will be charged.",
			"Update the payment method or buy credits, then turn auto-recharge back on."},
		cta: "Open billing"}
	if err := s.notifyAdmins(ctx, tx, wid, NotifyAutoRechargeFailed, map[string]any{"reason": code}, mail); err != nil {
		return err
	}
	return s.publish(ctx, tx, wid, prices)
}

// ─── Webhook ───────────────────────────────────────────────────────────────

// applyRechargeIntent handles payment_intent.succeeded and payment_intent.payment_failed
// for auto-recharge PaymentIntents (metadata.kind = auto_recharge). Others are ignored:
// credit packs bought in Checkout are granted on checkout.session.completed.
func (s *svc) applyRechargeIntent(ctx context.Context, tx pgx.Tx, typ string, wid uuid.UUID, pi *stripe.PaymentIntent, prices Prices) (bool, []capture, error) {
	if pi == nil || pi.Metadata["kind"] != rechargeKind {
		return false, nil, nil
	}
	attemptID, _ := uuid.Parse(pi.Metadata["attempt_id"])
	switch typ {
	case "payment_intent.succeeded":
		packs, _ := strconv.Atoi(pi.Metadata["packs"])
		granted, credits, err := s.grantRechargeTx(ctx, tx, wid, attemptID, pi.ID, packs)
		if err != nil || !granted {
			return false, nil, err
		}
		return true, []capture{{wid, "credits_recharged", map[string]any{"credits": credits}}}, nil
	case "payment_intent.payment_failed":
		var pending bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ai_auto_recharges WHERE id = $1 AND workspace_id = $2 AND status = 'pending')`,
			attemptID, wid).Scan(&pending); err != nil || !pending {
			return false, nil, err
		}
		code := failPaymentFailed
		if e := pi.LastPaymentError; e != nil {
			switch {
			case e.Code == stripe.ErrorCodeAuthenticationRequired:
				code = failAuthenticationNeeded
			case e.Type == stripe.ErrorTypeCard:
				code = failCardDeclined
			}
		}
		// failTx publishes billing.updated itself.
		return false, nil, s.failTx(ctx, tx, wid, &attemptID, code, prices)
	}
	return false, nil, nil
}
