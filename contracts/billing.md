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
| Agent playground reply | `playground` | 3 |
| Draft a KB article from tickets | `kb_draft` | 5 |
| Ollie, the assistant (each model turn of a run) | `assistant` | 2 |

Jev decisions cost a fraction of an LLM call (per input token, output free), so triage and the
widget relevance check use only a little. Usage rows record decision calls with model `jev`.
Usage rows (`ai_usage`) store the feature, model, token counts, credits charged and the provider
cost in USD; the provider cost is internal and never returned by the API.

Go API (`internal/plan`, `d.Plan`):
- `d.Plan.Entitlements(ctx, q, wid)`, `d.Plan.CheckMailbox`, `d.Plan.CheckMember` (return
  `*plan.LimitError` → `httpx.Wrap` → `402 plan_limit`).
- `d.Plan.Reserve(ctx, q, wid, feature)` before a model call (`402 no_credits`), then
  `d.Plan.Spend(ctx, pool, wid, plan.Usage{..., CostUSD})` after it succeeds. Failed calls cost nothing.
- `plan.Grant(ctx, tx, wid, credits, source, externalID)` is idempotent per external id.

## Endpoints (owner area: billing)

| method | path | who | notes |
| --- | --- | --- | --- |
| GET | `/v1/billing` | member | `Billing` below |
| POST | `/v1/billing/checkout` | owner/admin | `{interval: "month"\|"year"}` → `{url}` Stripe Checkout (subscription, quantity = billed seats, automatic tax, promotion codes, `client_reference_id` = workspace id) |
| POST | `/v1/billing/portal` | owner/admin | `{url}` Stripe Customer Portal (payment method, invoices, cancel, tax ids) |
| POST | `/v1/billing/credits/checkout` | owner/admin | `{packs: 1..20}` → `{url}` one-time Checkout |
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
}
interface Price { id: string; unit_amount: number; currency: string; interval: "month" | "year" | null; credits?: number }
```

Stripe webhook events handled: `checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
`invoice.payment_failed`. Each change publishes `billing.updated` (agents visibility, data =
`Billing`) and is audit-logged (`billing.subscribed`, `billing.canceled`, `billing.credits_purchased`).

```ts
// GET /v1/billing/usage?from&to (RFC 3339 or YYYY-MM-DD; default this month, UTC; at most a year).
// A YYYY-MM-DD `to` includes that day; an RFC 3339 `to` is exclusive. The response `from`/`to` are RFC 3339 (`to` exclusive).
interface UsageReport {
  from: string; to: string; total_credits: number; total_calls: number
  by_feature: { feature: string; credits: number; calls: number }[]
  by_day: { date: string /* YYYY-MM-DD UTC */; credits: number; calls: number; by_feature: Record<string, number> /* credits */ }[] // days with usage only
  by_member: { user: UserRef | null /* null: widget agent, automations */; credits: number; calls: number }[]
  by_model: { model: string; credits: number; calls: number; input_tokens: number; output_tokens: number }[]
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

Errors: `402 plan_limit` (`detail` names the limit), `402 no_credits`, `404 billing_disabled`,
`409 already_subscribed` (checkout while on Pro: use the portal), `409 no_billing_account`
(portal before any purchase), `422 interval_unavailable` (no yearly price),
`422 credits_unavailable`, `502 billing_unavailable` (Stripe unreachable).
The web app shows an upgrade prompt for both 402 codes.
