package billing_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/billing"
	"github.com/useopendesk/opendesk/internal/plan"
)

// setBalance leaves exactly `credits` purchased credits and no monthly allowance.
func (e *env) setBalance(wid uuid.UUID, credits int64) {
	e.t.Helper()
	ent, err := e.d.Plan.Entitlements(context.Background(), e.d.DB.Pool, wid)
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.d.DB.Pool.Exec(context.Background(), `UPDATE ai_credits SET included_used_milli = $2, purchased_milli = $3,
		period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' WHERE workspace_id = $1`,
		wid, int64(ent.MonthlyCredits)*1000, credits*1000); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) spend(wid uuid.UUID, feature string, usd float64) {
	e.t.Helper()
	if _, err := e.d.Plan.Spend(context.Background(), e.d.DB.Pool, wid, plan.Usage{Feature: feature, Model: "test", CostUSD: usd}); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) rechargeJobs(wid uuid.UUID) int64 {
	return e.count(`SELECT count(*) FROM river_job WHERE kind = 'billing.auto_recharge' AND args->>'workspace_id' = $1`, wid.String())
}

func (e *env) notices(wid uuid.UUID, typ string) int64 {
	return e.count(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND type = $2`, wid, typ)
}

func TestAutoRechargeSettingsNeedAPaymentMethod(t *testing.T) {
	e := newEnv(t, true)
	owner := e.signup("owner")
	wid := owner.newWorkspace("Acme")

	b := owner.do("GET", "/v1/billing", nil)
	expect(t, b, 200, "")
	if b.num("auto_recharge", "threshold") != 200 || b.num("auto_recharge", "packs") != 1 || b.num("auto_recharge", "monthly_limit") != 5 ||
		b.Body["auto_recharge"].(map[string]any)["enabled"] != false || b.num("auto_recharge", "low_at") != 10 {
		t.Fatalf("defaults: %s", b.Raw)
	}
	// One recharge must lift the balance above the threshold (a pack is 2,000 credits).
	expect(t, owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"threshold": 5000, "packs": 2}), 422, "recharge_too_small")
	expect(t, owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"threshold": 2000}), 422, "recharge_too_small")
	// No Stripe customer yet, then a customer without a saved card.
	expect(t, owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"enabled": true}), 409, "payment_method_required")
	expect(t, owner.do("POST", "/v1/billing/credits/checkout", map[string]any{"packs": 1}), 200, "")
	if f := e.fake.lastSession(); f.Get("payment_intent_data[setup_future_usage]") != "off_session" {
		t.Fatalf("credit pack checkout does not save the card: %v", f)
	}
	expect(t, owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"enabled": true}), 409, "payment_method_required")

	// A setup Checkout saves a card and makes it the default.
	r := owner.do("POST", "/v1/billing/payment-method", nil)
	expect(t, r, 200, "")
	f := e.fake.lastSession()
	cus := e.scalar(`SELECT stripe_customer_id FROM subscriptions WHERE workspace_id = $1`, wid).(string)
	if f.Get("mode") != "setup" || f.Get("currency") != "usd" || f.Get("customer") != cus ||
		f.Get("success_url") != "http://app.test/settings/billing?payment_method=success" {
		t.Fatalf("setup checkout form: %v", f)
	}
	pm := e.fake.addPM(cus)
	e.fake.mu.Lock()
	e.fake.setupPMs["seti_1"] = pm
	e.fake.mu.Unlock()
	expect(t, e.event("evt_setup", "checkout.session.completed", map[string]any{"id": "cs_setup", "object": "checkout.session", "mode": "setup",
		"status": "complete", "customer": cus, "setup_intent": "seti_1", "metadata": map[string]any{"workspace_id": wid.String(), "kind": "payment_method"}}), 200, "")
	e.fake.mu.Lock()
	def := e.fake.defaultPM[cus]
	e.fake.mu.Unlock()
	if def != pm {
		t.Fatalf("default payment method %q, want %q", def, pm)
	}

	// Validation and roles.
	expect(t, owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"packs": 21}), 422, "")
	expect(t, owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"threshold": 0}), 422, "")
	expect(t, owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"monthly_limit": 31}), 422, "")

	r = owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"enabled": true, "threshold": 20, "packs": 3, "monthly_limit": 2})
	expect(t, r, 200, "")
	if r.Body["auto_recharge"].(map[string]any)["enabled"] != true || r.num("auto_recharge", "threshold") != 20 || r.num("auto_recharge", "packs") != 3 ||
		r.num("auto_recharge", "monthly_limit") != 2 || r.num("auto_recharge", "low_at") != 20 {
		t.Fatalf("updated: %s", r.Raw)
	}
	if n := e.count(`SELECT count(*) FROM audit_logs WHERE workspace_id = $1 AND action = 'billing.auto_recharge_updated'`, wid); n != 1 {
		t.Fatalf("audit rows: %d", n)
	}
	if n := e.count(`SELECT count(*) FROM events WHERE workspace_id = $1 AND type = 'billing.updated'`, wid); n < 1 {
		t.Fatal("no billing.updated event")
	}
	// The free allowance (50) is above the threshold: nothing to recharge yet.
	if n := e.rechargeJobs(wid); n != 0 {
		t.Fatalf("recharge jobs: %d", n)
	}
}

func TestAutoRechargeOnThreshold(t *testing.T) {
	e := newEnv(t, true)
	ctx := context.Background()
	owner, wid, _ := proWorkspace(t, e)
	cus := e.scalar(`SELECT stripe_customer_id FROM subscriptions WHERE workspace_id = $1`, wid).(string)
	pm := e.fake.addPM(cus)
	expect(t, owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"enabled": true, "threshold": 500, "packs": 2, "monthly_limit": 2}), 200, "")
	if n := e.rechargeJobs(wid); n != 0 {
		t.Fatalf("recharge jobs at 1000 credits: %d", n)
	}

	// $4 at 1.5x is 600 credits: 1000 -> 400, below 500. One job, however many calls.
	e.spend(wid, "draft_reply", 4)
	e.spend(wid, "summarize", 0)
	if n := e.rechargeJobs(wid); n != 1 {
		t.Fatalf("recharge jobs: %d", n)
	}
	if err := billing.RunAutoRecharge(ctx, e.d, wid); err != nil {
		t.Fatal(err)
	}
	forms := e.fake.intentForms()
	if len(forms) != 1 {
		t.Fatalf("payment intents: %d", len(forms))
	}
	for k, want := range map[string]string{"amount": "2000", "currency": "usd", "customer": cus, "payment_method": pm, "off_session": "true",
		"confirm": "true", "metadata[workspace_id]": wid.String(), "metadata[kind]": "auto_recharge", "metadata[packs]": "2"} {
		if got := forms[0].Get(k); got != want {
			t.Errorf("payment intent %s = %q, want %q", k, got, want)
		}
	}
	piID := e.scalar(`SELECT payment_intent_id FROM ai_auto_recharges WHERE workspace_id = $1`, wid).(string)
	if n := e.count(`SELECT count(*) FROM ai_credit_grants WHERE workspace_id = $1 AND external_id = $2 AND source = 'stripe_auto_recharge'`, wid, piID); n != 1 {
		t.Fatalf("grants: %d", n)
	}
	b := owner.do("GET", "/v1/billing", nil)
	if b.num("credits", "purchased") != 4000 || b.num("credits", "remaining") != 4399 || b.num("auto_recharge", "recharges_this_month") != 1 ||
		b.num("auto_recharge", "last_recharge", "credits") != 4000 || b.num("auto_recharge", "last_recharge", "amount") != 2000 {
		t.Fatalf("after recharge: %s", b.Raw)
	}
	if n := e.count(`SELECT count(*) FROM audit_logs WHERE workspace_id = $1 AND action = 'billing.credits_recharged'`, wid); n != 1 {
		t.Fatalf("recharge audit rows: %d", n)
	}

	// The webhook for the same PaymentIntent grants nothing more.
	pi := e.fake.intent(piID)
	expect(t, e.event("evt_pi_ok", "payment_intent.succeeded", pi), 200, "")
	expect(t, e.event("evt_pi_ok_again", "payment_intent.succeeded", pi), 200, "")
	if n := e.count(`SELECT count(*) FROM ai_credit_grants WHERE workspace_id = $1`, wid); n != 1 {
		t.Fatalf("grants after webhook: %d", n)
	}
	if b := owner.do("GET", "/v1/billing", nil); b.num("credits", "purchased") != 4000 {
		t.Fatalf("purchased after webhook: %s", b.Raw)
	}
	// A retried job above the threshold does nothing.
	if err := billing.RunAutoRecharge(ctx, e.d, wid); err != nil {
		t.Fatal(err)
	}
	if len(e.fake.intentForms()) != 1 {
		t.Fatal("charged above the threshold")
	}

	// Second recharge of the month, then the monthly limit (2) holds.
	e.setBalance(wid, 100)
	if err := billing.RunAutoRecharge(ctx, e.d, wid); err != nil {
		t.Fatal(err)
	}
	e.setBalance(wid, 100)
	if err := billing.RunAutoRecharge(ctx, e.d, wid); err != nil {
		t.Fatal(err)
	}
	if n := len(e.fake.intentForms()); n != 2 {
		t.Fatalf("payment intents past the monthly limit: %d", n)
	}
	// At the limit, spending below the threshold queues nothing and, at the end, tells admins.
	if _, err := e.d.DB.Pool.Exec(ctx, `DELETE FROM river_job WHERE kind = 'billing.auto_recharge' AND args->>'workspace_id' = $1`, wid.String()); err != nil {
		t.Fatal(err)
	}
	e.setBalance(wid, 4)
	e.spend(wid, "draft_reply", 0)
	if n := e.rechargeJobs(wid); n != 0 {
		t.Fatalf("recharge jobs past the limit: %d", n)
	}
	if n := e.notices(wid, billing.NotifyCreditsOut); n != 1 {
		t.Fatalf("out-of-credits notices: %d", n)
	}
}

func TestAutoRechargeFailureTurnsItOff(t *testing.T) {
	for _, tc := range []struct{ mode, code string }{{"decline", "card_declined"}, {"auth", "authentication_required"}} {
		t.Run(tc.mode, func(t *testing.T) {
			e := newEnv(t, true)
			ctx := context.Background()
			owner, wid, _ := proWorkspace(t, e)
			cus := e.scalar(`SELECT stripe_customer_id FROM subscriptions WHERE workspace_id = $1`, wid).(string)
			e.fake.addPM(cus)
			expect(t, owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"enabled": true}), 200, "")
			e.fake.setPIMode(tc.mode)
			e.setBalance(wid, 50)
			if err := billing.RunAutoRecharge(ctx, e.d, wid); err != nil {
				t.Fatal(err)
			}
			b := owner.do("GET", "/v1/billing", nil)
			ar := b.Body["auto_recharge"].(map[string]any)
			if ar["enabled"] != false || b.str("auto_recharge", "failure", "code") != tc.code || b.num("credits", "purchased") != 50 {
				t.Fatalf("after failure: %s", b.Raw)
			}
			if n := e.notices(wid, billing.NotifyAutoRechargeFailed); n != 1 {
				t.Fatalf("failure notices: %d", n)
			}
			if n := e.count(`SELECT count(*) FROM audit_logs WHERE workspace_id = $1 AND action = 'billing.auto_recharge_failed'`, wid); n != 1 {
				t.Fatalf("failure audit rows: %d", n)
			}
			if n := e.count(`SELECT count(*) FROM river_job WHERE kind = 'mail.system' AND args->>'to' = $1 AND args->>'subject' LIKE 'Auto-recharge failed%'`, owner.email); n != 1 {
				t.Fatalf("failure emails: %d", n)
			}
			if st := e.scalar(`SELECT status FROM ai_auto_recharges WHERE workspace_id = $1`, wid).(string); st != "failed" {
				t.Fatalf("attempt status %q", st)
			}
			// Off now: nothing else is charged, and the late webhook changes nothing.
			if err := billing.RunAutoRecharge(ctx, e.d, wid); err != nil {
				t.Fatal(err)
			}
			if n := len(e.fake.intentForms()); n != 1 {
				t.Fatalf("payment intents: %d", n)
			}
			piID := e.scalar(`SELECT payment_intent_id FROM ai_auto_recharges WHERE workspace_id = $1`, wid).(string)
			expect(t, e.event("evt_pi_fail", "payment_intent.payment_failed", e.fake.intent(piID)), 200, "")
			if n := e.notices(wid, billing.NotifyAutoRechargeFailed); n != 1 {
				t.Fatalf("failure notices after webhook: %d", n)
			}
			// Turning it back on clears the failure.
			e.fake.setPIMode("")
			r := owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"enabled": true})
			expect(t, r, 200, "")
			if r.Body["auto_recharge"].(map[string]any)["failure"] != nil {
				t.Fatalf("failure kept: %s", r.Raw)
			}
			// Still below the threshold, so turning it on queued a recharge.
			if n := e.rechargeJobs(wid); n != 1 {
				t.Fatalf("recharge jobs after turning on: %d", n)
			}
		})
	}
}

func TestAutoRechargeProcessingSettlesByWebhook(t *testing.T) {
	e := newEnv(t, true)
	ctx := context.Background()
	owner, wid, _ := proWorkspace(t, e)
	cus := e.scalar(`SELECT stripe_customer_id FROM subscriptions WHERE workspace_id = $1`, wid).(string)
	e.fake.addPM(cus)
	expect(t, owner.do("PATCH", "/v1/billing/auto-recharge", map[string]any{"enabled": true}), 200, "")
	e.fake.setPIMode("processing")
	e.setBalance(wid, 10)
	if err := billing.RunAutoRecharge(ctx, e.d, wid); err != nil {
		t.Fatal(err)
	}
	if n := e.count(`SELECT count(*) FROM ai_credit_grants WHERE workspace_id = $1`, wid); n != 0 {
		t.Fatalf("granted while processing: %d", n)
	}
	piID := e.scalar(`SELECT payment_intent_id FROM ai_auto_recharges WHERE workspace_id = $1 AND status = 'pending'`, wid).(string)
	// A pending attempt counts against the limit and is not charged twice.
	if b := owner.do("GET", "/v1/billing", nil); b.num("auto_recharge", "recharges_this_month") != 1 {
		t.Fatalf("pending recharge not counted: %s", b.Raw)
	}
	pi := e.fake.intent(piID)
	e.fake.mu.Lock()
	pi["status"] = "succeeded"
	e.fake.mu.Unlock()
	expect(t, e.event("evt_pi_processing_ok", "payment_intent.succeeded", pi), 200, "")
	if b := owner.do("GET", "/v1/billing", nil); b.num("credits", "purchased") != 2010 || b.num("auto_recharge", "last_recharge", "credits") != 2000 {
		t.Fatalf("after webhook: %s", b.Raw)
	}
	// The job's retry reads the settled intent and grants nothing more.
	if err := billing.RunAutoRecharge(ctx, e.d, wid); err != nil {
		t.Fatal(err)
	}
	if n := e.count(`SELECT count(*) FROM ai_credit_grants WHERE workspace_id = $1`, wid); n != 1 {
		t.Fatalf("grants: %d", n)
	}
	if len(e.fake.intentForms()) != 1 {
		t.Fatal("charged twice")
	}
	// A credit pack PaymentIntent from Checkout is not an auto-recharge.
	expect(t, e.event("evt_pi_checkout", "payment_intent.succeeded", map[string]any{"id": "pi_checkout", "object": "payment_intent", "status": "succeeded",
		"amount": 1000, "currency": "usd", "customer": cus, "metadata": map[string]any{"workspace_id": wid.String(), "kind": "credits", "packs": "1"}}), 200, "")
	if n := e.count(`SELECT count(*) FROM ai_credit_grants WHERE workspace_id = $1`, wid); n != 1 {
		t.Fatalf("grants after a checkout intent: %d", n)
	}
}

func TestRunningLowNotices(t *testing.T) {
	e := newEnv(t, true)
	owner := e.signup("owner")
	wid := owner.newWorkspace("Acme")
	// Free: 50 credits, so low is below 10 (a fifth of the allowance) and out below 3.
	e.spend(wid, "draft_reply", 0.2) // 30 credits: 20 left
	if n := e.notices(wid, billing.NotifyCreditsLow); n != 0 {
		t.Fatalf("low notices at 20: %d", n)
	}
	e.spend(wid, "draft_reply", 0.08) // 12 credits: 8 left
	e.spend(wid, "summarize", 0)      // 1 credit: 7 left
	if n := e.notices(wid, billing.NotifyCreditsLow); n != 1 {
		t.Fatalf("low notices: %d", n)
	}
	e.spend(wid, "draft_reply", 0.03) // 4.5 credits: 2.5 left
	e.spend(wid, "summarize", 0)      // 1 credit: 1.5 left
	if n := e.notices(wid, billing.NotifyCreditsOut); n != 1 {
		t.Fatalf("out notices: %d", n)
	}
	if n := e.notices(wid, billing.NotifyCreditsLow); n != 1 {
		t.Fatalf("low notices after out: %d", n)
	}
	if n := e.count(`SELECT count(*) FROM river_job WHERE kind = 'mail.system' AND args->>'to' = $1 AND args->>'subject' LIKE 'AI credits are out%'`, owner.email); n != 1 {
		t.Fatalf("out emails: %d", n)
	}
	// A purchase re-arms the notices.
	cs := map[string]any{"id": "cs_rearm_" + wid.String(), "object": "checkout.session", "mode": "payment", "payment_status": "paid",
		"client_reference_id": wid.String(), "metadata": map[string]any{"workspace_id": wid.String(), "kind": "credits", "packs": "1"}}
	expect(t, e.event("evt_rearm", "checkout.session.completed", cs), 200, "")
	if v := e.scalar(`SELECT out_notified_at IS NULL AND low_notified_at IS NULL FROM ai_auto_recharge WHERE workspace_id = $1`, wid).(bool); !v {
		t.Fatal("notices not re-armed after a purchase")
	}
}
