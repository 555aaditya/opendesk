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

## Credit costs

| feature | key | credits |
| --- | --- | --- |
| Summarize a ticket | `summarize` | 1 |
| Rewrite (tone, length, fix grammar) | `rewrite` | 1 |
| Translate a message or draft | `translate` | 1 |
| Auto-triage (tags, priority, sentiment, language) | `triage` | 1 |
| Ask about a ticket (copilot) | `copilot` | 2 |
| Draft a reply | `draft_reply` | 3 |
| Widget AI answer from the knowledge base | `answer` | 3 |
| Draft a KB article from tickets | `kb_draft` | 5 |
| Ollie, the assistant (each model turn of a run) | `assistant` | 2 |

Go API (`internal/plan`, `d.Plan`):
- `d.Plan.Entitlements(ctx, q, wid)`, `d.Plan.CheckMailbox`, `d.Plan.CheckMember` (return
  `*plan.LimitError` → `httpx.Wrap` → `402 plan_limit`).
- `d.Plan.Reserve(ctx, q, wid, feature)` before a model call (`402 no_credits`), then
  `d.Plan.Spend(ctx, pool, wid, plan.Usage{...})` after it succeeds. Failed calls cost nothing.
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
  credits: { unlimited: boolean; monthly: number; used: number; purchased: number; remaining: number; period_end: string }
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
  by_member: { user: UserRef | null /* null: widget answers, automations */; credits: number; calls: number }[]
}
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
