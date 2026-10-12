// Package plan holds workspace entitlements: plan limits and AI credits.
//
// Limits and credits are enforced only when billing is enabled (opendesk Cloud, Stripe
// configured). A self-hosted instance gets Unlimited entitlements, and AI usage is still
// recorded so admins can see it.
package plan

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/db"
)

const (
	Free = "free"
	Pro  = "pro"
	// SelfHosted is reported when billing is disabled.
	SelfHosted = "self_hosted"
)

// Plan numbers. Prices live in Stripe; these are the limits the API enforces.
const (
	FreeMaxMailboxes = 1
	FreeMaxMembers   = 1
	// FreeMonthlyCredits is the AI allowance on the free plan, per workspace per month.
	FreeMonthlyCredits = 50
	// ProCreditsPerSeat is the monthly AI allowance per paid seat, pooled across the workspace.
	ProCreditsPerSeat = 1000
	// CreditPackSize is how many credits one STRIPE_PRICE_CREDITS purchase adds.
	CreditPackSize = 2000
)

// Milli is an amount of AI credits in thousandths of a credit. Balances and usage rows
// are kept in Milli; the API reports credits as numbers with up to 3 decimals.
type Milli int64

// Credits returns m as a number of credits.
func (m Milli) Credits() float64 { return float64(m) / 1000 }

// CreditUSD is what one credit buys of AI usage at the markup (contracts/billing.md).
const CreditUSD = 0.01

// FromCost turns a provider cost in USD into credits at the given markup, rounded up to
// a thousandth of a credit. A call with any cost is at least one thousandth.
func FromCost(usd, markup float64) Milli {
	if usd <= 0 {
		return 0
	}
	if markup < 1 {
		markup = 1
	}
	m := Milli(math.Ceil(usd * markup / CreditUSD * 1000))
	return max(m, 1)
}

// Typical credits of a call per AI feature (contracts/billing.md "Metered credits"): the
// minimum balance to start a call, and the charge when a provider reports no cost.
var Typical = map[string]Milli{
	"summarize":    1000,
	"rewrite":      1000,
	"translate":    1000,
	"triage":       1000, // every triage decision in one call (Jev, or the AI model)
	"decide":       1000, // the ai_decide automation conditions of one trigger run, in one call
	"answer_check": 100,  // the widget agent's relevance check on Jev
	"draft_reply":  3000,
	"answer":       3000, // one model turn of a widget agent reply
	"answer_email": 3000, // one model turn of an agent email answer or suggested reply
	"playground":   3000, // one model turn of an agent playground reply
	"kb_draft":     5000, // knowledge base article draft from tickets
	"copilot":      2000, // free-form question about a ticket
	"assistant":    2000, // one model turn of the assistant (Ollie)
}

var (
	// ErrLimit means a plan limit was reached; the API answers 402 plan_limit.
	ErrLimit = errors.New("plan limit reached")
	// ErrNoCredits means the workspace has no AI credits left; 402 no_credits.
	ErrNoCredits = errors.New("no AI credits left")
)

// LimitError says which limit was reached.
type LimitError struct {
	Resource string // "mailboxes" | "members"
	Limit    int
}

func (e *LimitError) Error() string {
	return fmt.Sprintf("the %s plan allows %d %s", Free, e.Limit, e.Resource)
}
func (e *LimitError) Unwrap() error { return ErrLimit }

// Entitlements is what a workspace may use right now.
type Entitlements struct {
	Plan           string `json:"plan" enum:"free,pro,self_hosted"`
	BillingEnabled bool   `json:"billing_enabled"`
	Status         string `json:"status"`
	// Zero means unlimited.
	MaxMailboxes int `json:"max_mailboxes"`
	MaxMembers   int `json:"max_members"`
	// Monthly AI allowance; zero with UnlimitedAI.
	MonthlyCredits int  `json:"monthly_credits"`
	UnlimitedAI    bool `json:"unlimited_ai"`
}

// Service reads and enforces entitlements. A nil *Service behaves like a self-hosted
// instance: no limits, unlimited AI.
type Service struct {
	Billing bool
	// Markup turns a provider cost into credits (AI_CREDIT_MARKUP); below 1 counts as 1.
	Markup float64
	// OnLimit, when set, is told about every refused mailbox or member (analytics).
	OnLimit func(wid uuid.UUID, resource string)
	// OnSpend, when set, is told the balance before and after every call Spend charged
	// (billing: auto-recharge and running-low notices). It runs after the charge commits
	// and never fails the call.
	OnSpend func(ctx context.Context, wid uuid.UUID, before, after Milli)
}

func (s *Service) enabled() bool { return s != nil && s.Billing }

func (s *Service) limitHit(wid uuid.UUID, le *LimitError) error {
	if s != nil && s.OnLimit != nil {
		s.OnLimit(wid, le.Resource)
	}
	return le
}

// lock serializes limit checks per workspace for the rest of q's transaction, so two
// concurrent creates cannot both pass a limit. Outside a transaction it is a no-op.
func lock(ctx context.Context, q db.Querier, wid uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT 1 FROM subscriptions WHERE workspace_id = $1 FOR UPDATE`, wid)
	return err
}

func New(billingEnabled bool, markup float64) *Service {
	return &Service{Billing: billingEnabled, Markup: markup}
}

// Ensure creates the subscription and credit rows for a workspace if they are missing.
func Ensure(ctx context.Context, q db.Querier, wid uuid.UUID) error {
	if _, err := q.Exec(ctx, `INSERT INTO subscriptions (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING`, wid); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `INSERT INTO ai_credits (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING`, wid)
	return err
}

// Paid reports whether a subscription status grants the paid plan. past_due keeps access
// while Stripe retries payment.
func Paid(status string) bool {
	switch status {
	case "active", "trialing", "past_due":
		return true
	}
	return false
}

// Entitlements returns the workspace's current limits.
func (s *Service) Entitlements(ctx context.Context, q db.Querier, wid uuid.UUID) (Entitlements, error) {
	if !s.enabled() {
		return Entitlements{Plan: SelfHosted, Status: "active", UnlimitedAI: true}, nil
	}
	if err := Ensure(ctx, q, wid); err != nil {
		return Entitlements{}, err
	}
	var planName, status string
	var seats int
	if err := q.QueryRow(ctx, `SELECT plan, status, seats FROM subscriptions WHERE workspace_id = $1`, wid).
		Scan(&planName, &status, &seats); err != nil {
		return Entitlements{}, err
	}
	e := Entitlements{Plan: Free, BillingEnabled: true, Status: status}
	if planName == Pro && Paid(status) {
		e.Plan = Pro
		e.MonthlyCredits = ProCreditsPerSeat * max(seats, 1)
		return e, nil
	}
	e.MaxMailboxes, e.MaxMembers, e.MonthlyCredits = FreeMaxMailboxes, FreeMaxMembers, FreeMonthlyCredits
	return e, nil
}

// CheckMailbox refuses a new mailbox past the plan limit.
func (s *Service) CheckMailbox(ctx context.Context, q db.Querier, wid uuid.UUID) error {
	e, err := s.Entitlements(ctx, q, wid)
	if err != nil || e.MaxMailboxes == 0 {
		return err
	}
	if err := lock(ctx, q, wid); err != nil {
		return err
	}
	var n int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE workspace_id = $1`, wid).Scan(&n); err != nil {
		return err
	}
	if n >= e.MaxMailboxes {
		return s.limitHit(wid, &LimitError{Resource: "mailboxes", Limit: e.MaxMailboxes})
	}
	return nil
}

// CheckMember refuses a new member or invitation past the plan limit. Pending
// invitations count, so a limit cannot be passed by inviting many people at once.
func (s *Service) CheckMember(ctx context.Context, q db.Querier, wid uuid.UUID) error {
	e, err := s.Entitlements(ctx, q, wid)
	if err != nil || e.MaxMembers == 0 {
		return err
	}
	if err := lock(ctx, q, wid); err != nil {
		return err
	}
	n, err := memberCount(ctx, q, wid, true)
	if err != nil {
		return err
	}
	if n >= e.MaxMembers {
		return s.limitHit(wid, &LimitError{Resource: "members", Limit: e.MaxMembers})
	}
	return nil
}

func memberCount(ctx context.Context, q db.Querier, wid uuid.UUID, withInvites bool) (int, error) {
	var n int
	sql := `SELECT (SELECT count(*) FROM members WHERE workspace_id = $1)`
	if withInvites {
		sql += ` + (SELECT count(*) FROM invitations WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now())`
	}
	err := q.QueryRow(ctx, sql, wid).Scan(&n)
	return n, err
}

// BilledSeats is the Stripe quantity for a workspace: owners, admins and agents.
// Viewers are free.
func BilledSeats(ctx context.Context, q db.Querier, wid uuid.UUID) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM members WHERE workspace_id = $1 AND role <> 'viewer'`, wid).Scan(&n)
	return max(n, 1), err
}

// Credits is a workspace's AI credit balance for the current period, in Milli.
type Credits struct {
	Plan         string
	Unlimited    bool
	Monthly      Milli
	IncludedUsed Milli
	Purchased    Milli
	Remaining    Milli
	PeriodStart  time.Time
	PeriodEnd    time.Time
}

func periodStart(now time.Time) time.Time {
	now = now.UTC()
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// Balance returns the credit balance, rolling the monthly allowance over if a new period began.
func (s *Service) Balance(ctx context.Context, q db.Querier, wid uuid.UUID) (Credits, error) {
	e, err := s.Entitlements(ctx, q, wid)
	if err != nil {
		return Credits{}, err
	}
	if err := Ensure(ctx, q, wid); err != nil {
		return Credits{}, err
	}
	ps := periodStart(time.Now())
	c := Credits{Plan: e.Plan, Unlimited: e.UnlimitedAI, Monthly: Milli(e.MonthlyCredits) * 1000, PeriodStart: ps, PeriodEnd: ps.AddDate(0, 1, 0)}
	if err := q.QueryRow(ctx, `UPDATE ai_credits SET
			included_used_milli = CASE WHEN period_start < $2 THEN 0 ELSE included_used_milli END,
			period_start = GREATEST(period_start, $2)
		WHERE workspace_id = $1 RETURNING included_used_milli, purchased_milli`, wid, ps).
		Scan(&c.IncludedUsed, &c.Purchased); err != nil {
		return Credits{}, err
	}
	c.Remaining = max(c.Monthly-c.IncludedUsed, 0) + c.Purchased
	return c, nil
}

// Usage describes one AI call for Spend.
type Usage struct {
	UserID       *uuid.UUID
	TicketID     *uuid.UUID
	Feature      string // a key of Typical
	Model        string
	InputTokens  int
	OutputTokens int
	// CostUSD is the provider's cost of the call; 0 when unknown, which charges the
	// feature's typical credits.
	CostUSD float64
	// OwnKey marks a call made on the workspace's own provider key: it is recorded
	// (source own_key) and charges no credits.
	OwnKey bool
}

// Charge is what u costs in credits at the service's markup.
func (s *Service) Charge(u Usage) (Milli, error) {
	typical, ok := Typical[u.Feature]
	if !ok {
		return 0, fmt.Errorf("plan: unknown AI feature %q", u.Feature)
	}
	if u.CostUSD > 0 {
		return FromCost(u.CostUSD, s.markup()), nil
	}
	return typical, nil
}

func (s *Service) markup() float64 {
	if s == nil || s.Markup < 1 {
		return 1
	}
	return s.Markup
}

// Reserve checks that a feature can run before calling the model: the balance must
// cover the feature's typical credits. It does not spend.
func (s *Service) Reserve(ctx context.Context, q db.Querier, wid uuid.UUID, feature string) error {
	typical, ok := Typical[feature]
	if !ok {
		return fmt.Errorf("plan: unknown AI feature %q", feature)
	}
	c, err := s.Balance(ctx, q, wid)
	if err != nil {
		return err
	}
	if !c.Unlimited && (c.Remaining < typical || c.Remaining <= 0) {
		return ErrNoCredits
	}
	return nil
}

// Spend charges a completed AI call on its real cost: the monthly allowance first, then
// purchased credits. A call that costs more than what is left takes the balance to zero.
// The row lock makes concurrent spends safe. Usage is always recorded. It returns the
// credits charged. A call on the workspace's own key (u.OwnKey) is recorded and charges 0;
// callers skip Reserve for it, since no balance is needed.
func (s *Service) Spend(ctx context.Context, pool db.Querier, wid uuid.UUID, u Usage) (Milli, error) {
	cost, err := s.Charge(u)
	if err != nil {
		return 0, err
	}
	if u.OwnKey {
		_, err := pool.Exec(ctx, `INSERT INTO ai_usage (workspace_id, user_id, feature, millicredits, model, input_tokens, output_tokens, ticket_id, cost_usd, source)
			VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8, 'own_key')`, wid, u.UserID, u.Feature, u.Model, u.InputTokens, u.OutputTokens, u.TicketID, u.CostUSD)
		return 0, err
	}
	e, err := s.Entitlements(ctx, pool, wid)
	if err != nil {
		return 0, err
	}
	charged := cost
	var before Milli
	balanced := false
	err = pgx.BeginFunc(ctx, txStarter{pool}, func(tx pgx.Tx) error {
		if !e.UnlimitedAI {
			if err := Ensure(ctx, tx, wid); err != nil {
				return err
			}
			ps := periodStart(time.Now())
			var used, purchased Milli
			if err := tx.QueryRow(ctx, `SELECT CASE WHEN period_start < $2 THEN 0 ELSE included_used_milli END, purchased_milli
				FROM ai_credits WHERE workspace_id = $1 FOR UPDATE`, wid, ps).Scan(&used, &purchased); err != nil {
				return err
			}
			fromIncluded := min(max(Milli(e.MonthlyCredits)*1000-used, 0), cost)
			fromPurchased := min(cost-fromIncluded, max(purchased, 0))
			charged = fromIncluded + fromPurchased
			before, balanced = max(Milli(e.MonthlyCredits)*1000-used, 0)+max(purchased, 0), true
			if _, err := tx.Exec(ctx, `UPDATE ai_credits SET period_start = GREATEST(period_start, $2),
				included_used_milli = $3, purchased_milli = purchased_milli - $4, updated_at = now() WHERE workspace_id = $1`,
				wid, ps, used+fromIncluded, fromPurchased); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `INSERT INTO ai_usage (workspace_id, user_id, feature, millicredits, model, input_tokens, output_tokens, ticket_id, cost_usd)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, wid, u.UserID, u.Feature, charged, u.Model, u.InputTokens, u.OutputTokens, u.TicketID, u.CostUSD)
		return err
	})
	if err == nil && balanced && charged > 0 && s != nil && s.OnSpend != nil {
		s.OnSpend(ctx, wid, before, before-charged)
	}
	return charged, err
}

// Grant adds purchased credits once per external id (a Stripe checkout session or invoice).
func Grant(ctx context.Context, tx pgx.Tx, wid uuid.UUID, credits int, source, externalID string) (bool, error) {
	if err := Ensure(ctx, tx, wid); err != nil {
		return false, err
	}
	tag, err := tx.Exec(ctx, `INSERT INTO ai_credit_grants (workspace_id, credits, source, external_id) VALUES ($1, $2, $3, $4)
		ON CONFLICT (external_id) DO NOTHING`, wid, credits, source, externalID)
	if err != nil || tag.RowsAffected() == 0 {
		return false, err
	}
	_, err = tx.Exec(ctx, `UPDATE ai_credits SET purchased_milli = purchased_milli + $2, updated_at = now() WHERE workspace_id = $1`, wid, int64(credits)*1000)
	return err == nil, err
}

// txStarter lets Spend open a transaction on a pool, or a savepoint inside a tx.
type txStarter struct{ q db.Querier }

func (t txStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	if b, ok := t.q.(interface {
		Begin(context.Context) (pgx.Tx, error)
	}); ok {
		return b.Begin(ctx)
	}
	return nil, errors.New("plan: querier cannot begin a transaction")
}
