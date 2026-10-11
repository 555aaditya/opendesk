package billing

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stripe/stripe-go/v87"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/plan"
)

type urlBody struct {
	Body struct {
		URL string `json:"url"`
	}
}

func newURL(u string) *urlBody {
	out := &urlBody{}
	out.Body.URL = u
	return out
}

// UsageReport is the GET /v1/billing/usage body.
type UsageReport struct {
	From         time.Time     `json:"from"`
	To           time.Time     `json:"to"`
	TotalCredits int           `json:"total_credits"`
	TotalCalls   int           `json:"total_calls"`
	ByFeature    []FeatureUse  `json:"by_feature"`
	ByDay        []DayUse      `json:"by_day"`
	ByMember     []MemberUsage `json:"by_member"`
}

type FeatureUse struct {
	Feature string `json:"feature"`
	Credits int    `json:"credits"`
	Calls   int    `json:"calls"`
}

type DayUse struct {
	Date    string `json:"date" doc:"YYYY-MM-DD, UTC"`
	Credits int    `json:"credits"`
	Calls   int    `json:"calls"`
}

type MemberUsage struct {
	User    *domain.UserRef `json:"user" doc:"null for calls without a user (widget answers, automations)"`
	Credits int             `json:"credits"`
	Calls   int             `json:"calls"`
}

// requireBillingAdmin is the gate for routes that open Stripe: a signed-in owner or admin.
func requireBillingAdmin(ctx context.Context) (*auth.Principal, error) {
	p, err := auth.RequireWorkspace(ctx, auth.RoleAdmin, "")
	if err != nil {
		return nil, httpx.Wrap(err)
	}
	if p.Kind != auth.KindUser {
		return nil, httpx.Forbidden()
	}
	return p, nil
}

func (s *svc) registerAPI(api huma.API) {
	tags := []string{"Billing"}

	huma.Register(api, huma.Operation{OperationID: "get-billing", Method: http.MethodGet, Path: "/v1/billing",
		Summary: "Get the workspace plan, limits, credits and prices", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*struct{ Body Billing }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeSettingsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			b, err := s.load(ctx, s.d.DB.Pool, p.WorkspaceID, s.pricesFor(ctx))
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body Billing }{b}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "create-billing-checkout", Method: http.MethodPost, Path: "/v1/billing/checkout",
		Summary: "Start a Stripe Checkout for the Pro plan", Tags: tags},
		func(ctx context.Context, in *struct {
			Body *struct {
				Interval string `json:"interval,omitempty" enum:"month,year" default:"month"`
			}
		}) (*urlBody, error) {
			if !s.enabled() {
				return nil, errDisabled()
			}
			p, err := requireBillingAdmin(ctx)
			if err != nil {
				return nil, err
			}
			price := s.d.Cfg.StripePricePro
			if in.Body != nil && in.Body.Interval == "year" {
				if price = s.d.Cfg.StripePriceProYear; price == "" {
					return nil, httpx.E(422, "interval_unavailable", "Yearly billing is not available.")
				}
			}
			if !s.d.Limiter.Allow("billing:checkout:"+p.WorkspaceID.String(), 30, time.Hour) {
				return nil, httpx.RateLimited()
			}
			e, err := s.d.Plan.Entitlements(ctx, s.d.DB.Pool, p.WorkspaceID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if e.Plan == plan.Pro {
				return nil, httpx.E(409, "already_subscribed", "This workspace is already on Pro. Manage the subscription in the billing portal.")
			}
			cus, err := s.customer(ctx, p.WorkspaceID)
			if err != nil {
				return nil, s.wrapStripe(err)
			}
			seats, err := plan.BilledSeats(ctx, s.d.DB.Pool, p.WorkspaceID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			wid := p.WorkspaceID.String()
			meta := map[string]string{"workspace_id": wid}
			params := &stripe.CheckoutSessionCreateParams{
				Mode:                stripe.String(string(stripe.CheckoutSessionModeSubscription)),
				Customer:            stripe.String(cus),
				ClientReferenceID:   stripe.String(wid),
				LineItems:           []*stripe.CheckoutSessionCreateLineItemParams{{Price: stripe.String(price), Quantity: stripe.Int64(int64(seats))}},
				SuccessURL:          stripe.String(s.appURL("checkout", "success")),
				CancelURL:           stripe.String(s.appURL("checkout", "canceled")),
				AllowPromotionCodes: stripe.Bool(true),
				AdaptivePricing:     &stripe.CheckoutSessionCreateAdaptivePricingParams{Enabled: stripe.Bool(true)},
				Metadata:            meta,
				SubscriptionData:    &stripe.CheckoutSessionCreateSubscriptionDataParams{Metadata: meta},
			}
			s.applyTax(params)
			sess, err := s.sc.V1CheckoutSessions.Create(ctx, params)
			if err != nil {
				return nil, s.wrapStripe(err)
			}
			return newURL(sess.URL), nil
		})

	huma.Register(api, huma.Operation{OperationID: "create-billing-portal", Method: http.MethodPost, Path: "/v1/billing/portal",
		Summary: "Open the Stripe Customer Portal", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*urlBody, error) {
			if !s.enabled() {
				return nil, errDisabled()
			}
			p, err := requireBillingAdmin(ctx)
			if err != nil {
				return nil, err
			}
			var cus *string
			if err := s.d.DB.Pool.QueryRow(ctx, `SELECT stripe_customer_id FROM subscriptions WHERE workspace_id = $1`, p.WorkspaceID).
				Scan(&cus); err != nil && !db.IsNotFound(err) {
				return nil, httpx.Wrap(err)
			}
			if cus == nil {
				return nil, httpx.E(409, "no_billing_account", "This workspace has no billing account yet. Upgrade or buy credits first.")
			}
			sess, err := s.sc.V1BillingPortalSessions.Create(ctx, &stripe.BillingPortalSessionCreateParams{
				Customer: cus, ReturnURL: stripe.String(s.d.Cfg.AppURL + "/settings/billing")})
			if err != nil {
				return nil, s.wrapStripe(err)
			}
			return newURL(sess.URL), nil
		})

	huma.Register(api, huma.Operation{OperationID: "create-credits-checkout", Method: http.MethodPost, Path: "/v1/billing/credits/checkout",
		Summary: "Start a Stripe Checkout for AI credit packs", Tags: tags},
		func(ctx context.Context, in *struct {
			Body struct {
				Packs int `json:"packs" minimum:"1" maximum:"20" doc:"Number of credit packs to buy"`
			}
		}) (*urlBody, error) {
			if !s.enabled() {
				return nil, errDisabled()
			}
			p, err := requireBillingAdmin(ctx)
			if err != nil {
				return nil, err
			}
			if s.d.Cfg.StripePriceCredits == "" {
				return nil, httpx.E(422, "credits_unavailable", "Credit packs are not available.")
			}
			if !s.d.Limiter.Allow("billing:checkout:"+p.WorkspaceID.String(), 30, time.Hour) {
				return nil, httpx.RateLimited()
			}
			cus, err := s.customer(ctx, p.WorkspaceID)
			if err != nil {
				return nil, s.wrapStripe(err)
			}
			wid := p.WorkspaceID.String()
			meta := map[string]string{"workspace_id": wid, "kind": "credits", "packs": strconv.Itoa(in.Body.Packs)}
			params := &stripe.CheckoutSessionCreateParams{
				Mode:              stripe.String(string(stripe.CheckoutSessionModePayment)),
				Customer:          stripe.String(cus),
				ClientReferenceID: stripe.String(wid),
				LineItems: []*stripe.CheckoutSessionCreateLineItemParams{{Price: stripe.String(s.d.Cfg.StripePriceCredits),
					Quantity: stripe.Int64(int64(in.Body.Packs))}},
				SuccessURL:        stripe.String(s.appURL("credits", "success")),
				CancelURL:         stripe.String(s.appURL("credits", "canceled")),
				AdaptivePricing:   &stripe.CheckoutSessionCreateAdaptivePricingParams{Enabled: stripe.Bool(true)},
				InvoiceCreation:   &stripe.CheckoutSessionCreateInvoiceCreationParams{Enabled: stripe.Bool(true)},
				Metadata:          meta,
				PaymentIntentData: &stripe.CheckoutSessionCreatePaymentIntentDataParams{Metadata: meta},
			}
			s.applyTax(params)
			sess, err := s.sc.V1CheckoutSessions.Create(ctx, params)
			if err != nil {
				return nil, s.wrapStripe(err)
			}
			return newURL(sess.URL), nil
		})

	huma.Register(api, huma.Operation{OperationID: "get-billing-usage", Method: http.MethodGet, Path: "/v1/billing/usage",
		Summary: "AI credit usage by feature, day and member", Tags: tags},
		func(ctx context.Context, in *struct {
			From string `query:"from" doc:"RFC 3339 time or YYYY-MM-DD (default: start of this month, UTC)"`
			To   string `query:"to" doc:"RFC 3339 time or YYYY-MM-DD, exclusive (default: now)"`
		}) (*struct{ Body UsageReport }, error) {
			// AI usage is recorded on every instance, so self-hosted admins see it too.
			p, err := auth.RequireWorkspace(ctx, auth.RoleAdmin, auth.ScopeSettingsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			now := time.Now().UTC()
			from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
			to := now
			if in.From != "" {
				if from, err = parseTime(in.From); err != nil {
					return nil, httpx.Validation("from must be an RFC 3339 time or a YYYY-MM-DD date.")
				}
			}
			if in.To != "" {
				if to, err = parseTime(in.To); err != nil {
					return nil, httpx.Validation("to must be an RFC 3339 time or a YYYY-MM-DD date.")
				}
			}
			if !to.After(from) || to.Sub(from) > 367*24*time.Hour {
				return nil, httpx.Validation("to must be after from, at most a year apart.")
			}
			r, err := usageReport(ctx, s.d.DB.Pool, p.WorkspaceID, from, to)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body UsageReport }{r}, nil
		})
}

func parseTime(v string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t.UTC(), nil
	}
	return time.Parse(time.DateOnly, v)
}

func usageReport(ctx context.Context, q db.Querier, wid uuid.UUID, from, to time.Time) (UsageReport, error) {
	r := UsageReport{From: from, To: to, ByFeature: []FeatureUse{}, ByDay: []DayUse{}, ByMember: []MemberUsage{}}
	const where = ` FROM ai_usage a WHERE a.workspace_id = $1 AND a.created_at >= $2 AND a.created_at < $3`
	rows, err := q.Query(ctx, `SELECT a.feature, sum(a.credits)::int, count(*)::int`+where+` GROUP BY a.feature ORDER BY 2 DESC, 1`, wid, from, to)
	if err != nil {
		return r, err
	}
	if r.ByFeature, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (FeatureUse, error) {
		var f FeatureUse
		return f, row.Scan(&f.Feature, &f.Credits, &f.Calls)
	}); err != nil {
		return r, err
	}
	for _, f := range r.ByFeature {
		r.TotalCredits += f.Credits
		r.TotalCalls += f.Calls
	}
	rows, err = q.Query(ctx, `SELECT to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') d, sum(a.credits)::int, count(*)::int`+where+
		` GROUP BY d ORDER BY d`, wid, from, to)
	if err != nil {
		return r, err
	}
	if r.ByDay, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (DayUse, error) {
		var d DayUse
		return d, row.Scan(&d.Date, &d.Credits, &d.Calls)
	}); err != nil {
		return r, err
	}
	rows, err = q.Query(ctx, `SELECT u.id, u.name, u.email, u.avatar_url, sum(a.credits)::int, count(*)::int
		FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id
		WHERE a.workspace_id = $1 AND a.created_at >= $2 AND a.created_at < $3
		GROUP BY u.id, u.name, u.email, u.avatar_url ORDER BY 5 DESC LIMIT 500`, wid, from, to)
	if err != nil {
		return r, err
	}
	r.ByMember, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (MemberUsage, error) {
		var m MemberUsage
		var id *uuid.UUID
		var name, email, avatar *string
		if err := row.Scan(&id, &name, &email, &avatar, &m.Credits, &m.Calls); err != nil {
			return m, err
		}
		if id != nil {
			m.User = &domain.UserRef{ID: *id, Name: *name, Email: *email, AvatarURL: *avatar}
		}
		return m, nil
	})
	return r, err
}

func (s *svc) appURL(key, value string) string {
	return s.d.Cfg.AppURL + "/settings/billing?" + key + "=" + value
}

// applyTax turns on Stripe Tax for a Checkout Session when STRIPE_TAX is set.
func (s *svc) applyTax(p *stripe.CheckoutSessionCreateParams) {
	if !s.d.Cfg.StripeTax {
		return
	}
	p.AutomaticTax = &stripe.CheckoutSessionCreateAutomaticTaxParams{Enabled: stripe.Bool(true)}
	p.CustomerUpdate = &stripe.CheckoutSessionCreateCustomerUpdateParams{Address: stripe.String("auto"), Name: stripe.String("auto")}
	p.TaxIDCollection = &stripe.CheckoutSessionCreateTaxIDCollectionParams{Enabled: stripe.Bool(true)}
}

// wrapStripe logs a Stripe failure (without request details) and answers 502.
func (s *svc) wrapStripe(err error) error {
	var se *stripe.Error
	if !errors.As(err, &se) {
		return httpx.Wrap(err)
	}
	s.d.Log.Error("stripe request failed", "err", stripeErr(err))
	return httpx.E(http.StatusBadGateway, "billing_unavailable", "The billing provider is unavailable. Try again in a moment.")
}

// customer returns the workspace's Stripe customer, creating it on first use with the
// workspace name, the owner's email and metadata.workspace_id.
func (s *svc) customer(ctx context.Context, wid uuid.UUID) (string, error) {
	if err := plan.Ensure(ctx, s.d.DB.Pool, wid); err != nil {
		return "", err
	}
	var cus *string
	var name, email string
	if err := s.d.DB.Pool.QueryRow(ctx, `SELECT s.stripe_customer_id, w.name, COALESCE((SELECT u.email FROM members m JOIN users u ON u.id = m.user_id
			WHERE m.workspace_id = w.id AND m.role = 'owner' LIMIT 1), '')
		FROM workspaces w JOIN subscriptions s ON s.workspace_id = w.id WHERE w.id = $1`, wid).Scan(&cus, &name, &email); err != nil {
		return "", err
	}
	if cus != nil {
		return *cus, nil
	}
	params := &stripe.CustomerCreateParams{Name: stripe.String(name), Metadata: map[string]string{"workspace_id": wid.String()}}
	if email != "" {
		params.Email = stripe.String(email)
	}
	params.IdempotencyKey = stripe.String("od-customer-" + wid.String())
	c, err := s.sc.V1Customers.Create(ctx, params)
	if err != nil {
		return "", err
	}
	// A concurrent request may have stored one first; keep whichever won.
	var id string
	err = s.d.DB.Pool.QueryRow(ctx, `UPDATE subscriptions SET stripe_customer_id = COALESCE(stripe_customer_id, $2), updated_at = now()
		WHERE workspace_id = $1 RETURNING stripe_customer_id`, wid, c.ID).Scan(&id)
	return id, err
}
