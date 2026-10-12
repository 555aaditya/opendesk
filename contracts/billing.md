# Billing, plans and AI credits

Billing exists only on opendesk Cloud. It is **on when `STRIPE_SECRET_KEY` is set**. Without
it (every self-hosted instance by default) a workspace reports plan `self_hosted`, has no
limits and unlimited AI (the instance brings its own AI key); usage is still recorded.
Same code, same API.

## Plans

| plan | price | mailboxes | members | AI credits / month |
| --- | --- | --- | --- | --- |
| `free` | $0, per workspace, forever | 1 | 1 | 50 per workspace |
| `pro` | $19 per seat per month (Stripe recurring per-seat price `STRIPE_PRICE_PRO`; optional yearly `STRIPE_PRICE_PRO_YEARLY`) | unlimited | unlimited | 1,000 per paid seat, pooled |
| `self_hosted` | free | unlimited | unlimited | unlimited (own key) |

- Every feature is on every plan. Plans differ only in the limits above.
- Seats (Stripe quantity) = members whose role is owner, admin or agent. **Viewers are free.**
  The quantity is synced to Stripe whenever members change (prorated).
- On free, "members" counts all members plus pending invitations; the owner is the 1.
- Downgrade (subscription ends): existing mailboxes and members stay; creating new ones is
  refused until the workspace is within the free limits. Nothing is deleted.
- `past_due` keeps Pro while Stripe retries; `unpaid`/`canceled` fall back to free.
- AI credit packs: one-time purchase (`STRIPE_PRICE_CREDITS`), 2,000 credits each, never expire,
  spent after the monthly allowance. Available on free and pro.
- Constants live in `internal/plan` (single source). Prices are Stripe objects, never hard-coded.

## Metered credits

AI credits follow real usage, not a price per feature. **1 credit = $0.01 of AI usage at the
instance's markup** (`AI_CREDIT_MARKUP`, default `1.5`, read only when billing is on):

```
credits = provider cost in USD × AI_CREDIT_MARKUP ÷ 0.01, rounded up to 0.001 credit
```

- The provider cost is the call's `usage.cost` from OpenRouter (chat, Jev decisions). When a
  provider reports no cost (direct Anthropic, an OpenAI-compatible server, direct TypeSafe), the cost
  is the call's tokens at the model's OpenRouter price when known, else the call is charged the
  feature's typical credits below.
- Balances are kept in thousandths of a credit; the API reports credits as numbers with up to 3
  decimals.
- A pricier model, a longer thread or a longer answer uses more credits; a short one fewer.
- Embeddings (indexing articles and tickets) are not charged.
- **Own key** (contracts/ai.md "Provider per workspace"): a workspace that brings its own provider key
  pays its provider directly. Its LLM calls charge **no credits** and are never refused for lack of
  credits (`Reserve` is skipped); each still writes a usage row with `millicredits = 0` and
  `source = "own_key"`. Jev decisions stay on the instance and are charged as usual, so a workspace on
  its own key still spends a few credits on triage and automation decisions. The widget agent's
  monthly cap counts credits, so it does not limit calls on the workspace's key.

Typical credits per call (what a call costs with the default models and a typical thread). It is
also the **minimum balance to start a call**: `Reserve` refuses (`402 no_credits`) when the balance is
below it. If a call ends up costing more than the remaining balance, the balance goes to 0 and the
rest is not charged.

| feature | key | typical credits |
| --- | --- | --- |
| Summarize a ticket | `summarize` | 1 |
| Rewrite (tone, length, fix grammar) | `rewrite` | 1 |
| Translate a message or draft | `translate` | 1 |
| Auto-triage (tags, priority, severity, team, sentiment, language): one call, every question batched | `triage` | 1 |
| `ai_decide` automation conditions (all of one trigger run in one call) | `decide` | 1 |
| Widget agent relevance check (Jev) | `answer_check` | 0.1 |
| Ask about a ticket (copilot) | `copilot` | 2 |
| Draft a reply | `draft_reply` | 3 |
| Widget agent reply (each model turn of a reply, tool turns included) | `answer` | 3 |
| Agent email answer or suggested reply (each model turn, tool turns included) | `answer_email` | 3 |
| Agent playground reply, and each agent test answered or graded in a test run | `playground` | 3 |
| Draft a KB article from tickets | `kb_draft` | 5 |
| Ollie, the assistant (each model turn of a run) | `assistant` | 2 |

Jev decisions cost a fraction of an LLM call (per input token, output free), so triage and the
widget relevance check use only a little. Usage rows record decision calls with model `jev`.
Usage rows (`ai_usage`) store the feature, model, token counts, credits charged, the provider
cost in USD and `source` (`credits`, or `own_key` for calls on the workspace's own key); the provider
cost is internal and never returned by the API.

Go API (`internal/plan`, `d.Plan`):
- `d.Plan.Entitlements(ctx, q, wid)`, `d.Plan.CheckMailbox`, `d.Plan.CheckMember` (return
  `*plan.LimitError` → `httpx.Wrap` → `402 plan_limit`).
- `d.Plan.Reserve(ctx, q, wid, feature)` before a model call (`402 no_credits`), then
  `d.Plan.Spend(ctx, pool, wid, plan.Usage{..., CostUSD})` after it succeeds. Failed calls cost nothing.
  A call on the workspace's own key skips `Reserve` and spends with `plan.Usage{..., OwnKey: true}`:
  recorded (`source = "own_key"`), 0 credits, balance untouched. Features go through `internal/ai`, which
  decides this per workspace (`ai.Service.Reserve` for callers outside it, such as the assistant).
- `plan.Grant(ctx, tx, wid, credits, source, externalID)` is idempotent per external id.

## Endpoints (owner area: billing)

| method | path | who | notes |
| --- | --- | --- | --- |
| GET | `/v1/billing` | member | `Billing` below |
| POST | `/v1/billing/checkout` | owner/admin | `{interval: "month"\|"year"}` → `{url}` Stripe Checkout (subscription, quantity = billed seats, automatic tax, promotion codes, `client_reference_id` = workspace id) |
| POST | `/v1/billing/portal` | owner/admin | `{url}` Stripe Customer Portal (payment method, invoices, cancel, tax ids) |
| POST | `/v1/billing/credits/checkout` | owner/admin | `{packs: 1..20}` → `{url}` one-time Checkout; saves the card for off-session use (`setup_future_usage: off_session`) |
| PATCH | `/v1/billing/auto-recharge` | owner/admin | `{enabled?, threshold?: 1..100000, packs?: 1..20, monthly_limit?: 1..30}` → `Billing`. See "Auto-recharge" |
| POST | `/v1/billing/payment-method` | owner/admin | `{url}` Stripe Checkout in setup mode: saves a card and makes it the customer's default. Returns to `?payment_method=success\|canceled` |
| GET | `/v1/billing/usage` | admin | `?from&to` → AI usage by feature, by day and by member; also on self-hosted |
| POST | `/v1/billing/stripe/webhook` | Stripe | signature checked with `STRIPE_WEBHOOK_SECRET`; idempotent via `stripe_events` |

All billing routes answer `404 billing_disabled` on an instance without Stripe, except
`GET /v1/billing`, which returns the self-hosted entitlements, and `GET /v1/billing/usage`.

```ts
interface Billing {
  plan: "free" | "pro" | "self_hosted"
  billing_enabled: boolean
  status: "none" | "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "paused"
  interval: "month" | "year"
  seats: number            // billed seats in Stripe
  billed_seats: number     // current owners+admins+agents (what the next sync will set)
  current_period_end: string | null
  cancel_at_period_end: boolean
  limits: { max_mailboxes: number; max_members: number }   // 0 = unlimited
  usage: { mailboxes: number; members: number }
  credits: { unlimited: boolean; monthly: number; used: number; purchased: number; remaining: number; period_end: string }  // credits, up to 3 decimals
  prices: { pro_month: Price | null; pro_year: Price | null; credit_pack: Price | null }  // read from Stripe, cached
  auto_recharge: AutoRecharge | null   // null when billing is disabled
}
interface AutoRecharge {
  enabled: boolean           // off by default
  threshold: number          // credits; recharge when the remaining credits fall below it (default 200)
  packs: number              // credit packs per recharge, 1..20 (default 1)
  monthly_limit: number      // recharges per calendar month, UTC, 1..30 (default 5)
  recharges_this_month: number  // succeeded or still pending
  low_at: number             // remaining credits below this read as running low (see below)
  last_recharge: { at: string; packs: number; credits: number; amount: number; currency: string } | null  // amount in minor units
  failure: { code: "card_declined" | "authentication_required" | "no_payment_method" | "payment_failed" | "unavailable"; at: string } | null
}
interface Price { id: string; unit_amount: number; currency: string; interval: "month" | "year" | null; credits?: number }
```

Stripe webhook events handled: `checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
`invoice.payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed` (auto-recharge
PaymentIntents only, `metadata.kind = auto_recharge`). Each change publishes `billing.updated` (agents visibility, data =
`Billing`) and is audit-logged (`billing.subscribed`, `billing.canceled`, `billing.credits_purchased`, `billing.credits_recharged`,
`billing.auto_recharge_updated` (with the changed fields), `billing.auto_recharge_failed` (with `reason`)).

```ts
// GET /v1/billing/usage?from&to (RFC 3339 or YYYY-MM-DD; default this month, UTC; at most a year).
// A YYYY-MM-DD `to` includes that day; an RFC 3339 `to` is exclusive. The response `from`/`to` are RFC 3339 (`to` exclusive).
interface UsageReport {
  from: string; to: string; total_credits: number; total_calls: number
  by_feature: { feature: string; credits: number; calls: number }[]
  by_day: { date: string /* YYYY-MM-DD UTC */; credits: number; calls: number; by_feature: Record<string, number> /* credits */ }[] // days with usage only
  by_member: { user: UserRef | null /* null: widget agent, automations */; credits: number; calls: number }[]
  by_model: { model: string; credits: number; calls: number; input_tokens: number; output_tokens: number; source: "credits" | "own_key" }[] // one row per model and source
  own_key_calls: number // calls on the workspace's own provider key (0 credits each)
}
// Every credits value is a number with up to 3 decimals.
```

- Checkout returns to `APP_URL/settings/billing?checkout=success|canceled`, credit packs to
  `?credits=success|canceled`. The plan changes when the webhook lands, not on the redirect:
  wait for `billing.updated` (or refetch `GET /v1/billing`).
- `billed_seats` changes with members; the Stripe quantity (`seats`) follows within seconds
  (debounced, prorated) and is reconciled hourly.
- Deleting a workspace cancels its subscription immediately.
- Mailbox OAuth connect past the limit redirects to `/settings/mailboxes?error=plan_limit`.

## Auto-recharge

Off by default. When on, a charged AI call that leaves the workspace below `threshold` credits
queues the River job `billing.auto_recharge` (`jobs.AutoRechargeArgs{workspace_id}`, unique per
workspace, so one runs at a time). The job:

- does nothing when the balance is back at or above the threshold, or when `monthly_limit`
  recharges already succeeded or are pending this month (UTC);
- creates an off-session, confirmed PaymentIntent for `packs × credit_pack.unit_amount` on the
  customer's default payment method (else the most recently saved one), with
  `metadata {workspace_id, kind: "auto_recharge", packs, attempt_id}`. The attempt id is the Stripe
  idempotency key, so a retried job never charges twice;
- grants `packs × 2,000` credits with `plan.Grant(..., "stripe_auto_recharge", payment_intent_id)`.
  `payment_intent.succeeded` grants the same way, so the worker and the webhook grant once
  between them. A `processing` payment is finished by the webhook.

When the payment fails (card declined, authentication required, no saved payment method, credit
packs unavailable), auto-recharge turns itself off and records `failure`; owners and admins get an
`auto_recharge_failed` notification and an email; it is audit-logged and `billing.updated` is
published. Turning it back on clears `failure`; if the balance is already below the threshold, a
recharge starts right away.

Turning it on needs a saved payment method: `409 payment_method_required` otherwise (the web app
offers "Add a payment method", which opens `POST /v1/billing/payment-method`). Credit pack Checkouts
save the card (`setup_future_usage: off_session`), subscription Checkouts save it with the
subscription, and after any completed Checkout the saved card becomes the customer's default when it
has none.

Running low (auto-recharge off, or at its monthly limit):

- **low**: remaining credits fall below `low_at` = the threshold, but never more than a fifth of the
  monthly allowance (at least 5); with auto-recharge on, `low_at` is the threshold. Owners and
  admins get one `credits_low` notification (`data {remaining}`).
- **out**: remaining credits fall below 3 (a widget agent reply or a draft can no longer start;
  the widget agent goes silent). One `credits_out` notification (`data {remaining}`) plus an email.
- Each is sent once a month at most; any credit grant (pack, recharge) re-arms both.

Errors: `402 plan_limit` (`detail` names the limit), `402 no_credits`, `404 billing_disabled`,
`409 already_subscribed` (checkout while on Pro: use the portal), `409 no_billing_account`
(portal before any purchase), `422 interval_unavailable` (no yearly price),
`422 credits_unavailable`, `409 payment_method_required` (turning auto-recharge on without a saved
payment method), `422 recharge_too_small` (packs per recharge would not lift the balance above the
threshold), `502 billing_unavailable` (Stripe unreachable).
The web app shows an upgrade prompt for both 402 codes.
