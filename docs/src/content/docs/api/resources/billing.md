---
title: Billing
description: Plans, seats, AI credits and Stripe checkout on opendesk Cloud.
---

**Cloud only.** Billing exists only on opendesk Cloud. See [Cloud plans and billing](/guides/billing/). On an instance without Stripe configured, every route below returns `404 billing_disabled`, except `GET /v1/billing`, which returns the self-hosted entitlements: plan `self_hosted`, no limits and unlimited AI.

| method | path | who | |
| --- | --- | --- | --- |
| `GET` | `/v1/billing` | member | The workspace's plan, limits, usage and credits |
| `POST` | `/v1/billing/checkout` | owner, admin | `{ interval: "month" \| "year" }` → `{ url }` to Stripe Checkout |
| `POST` | `/v1/billing/portal` | owner, admin | `{ url }` to the Stripe customer portal |
| `POST` | `/v1/billing/credits/checkout` | owner, admin | `{ packs: 1..20 }` → `{ url }` |
| `GET` | `/v1/billing/usage?from=&to=` | admin | AI usage by feature, day and member |

## The billing object

```ts
interface Billing {
  plan: "free" | "pro" | "self_hosted";
  billing_enabled: boolean;
  status: "none" | "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "paused";
  interval: "month" | "year";
  seats: number;          // billed seats in Stripe
  billed_seats: number;   // current owners, admins and agents
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  limits: { max_mailboxes: number; max_members: number };   // 0 = unlimited
  usage: { mailboxes: number; members: number };
  credits: { unlimited: boolean; monthly: number; used: number; purchased: number; remaining: number; period_end: string };
  prices: { pro_month: Price | null; pro_year: Price | null; credit_pack: Price | null };
}
```

## Plans and limits

- Every feature is on every plan. Plans differ only in limits.
- Seats are members with the owner, admin or agent role. **Viewers are free.**
- When a limit is reached, creating another mailbox or member returns `402 plan_limit`, with the limit named in `detail`. Nothing existing is removed.
- AI features spend credits from a monthly allowance, then from purchased packs, which never expire. With none left, AI routes return `402 no_credits`.

Changes publish a `billing.updated` event with the billing object.
