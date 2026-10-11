---
title: Cloud plans and billing
description: The free and Pro plans on opendesk Cloud, seats, AI credits, credit packs and downgrades.
---

Billing applies only to opendesk Cloud. Self-hosted opendesk has no plans, no limits and no billing.

**Every feature is on every plan.** Plans differ only in limits.

## Plans

| plan | price | mailboxes | members | AI credits per month |
| --- | --- | --- | --- | --- |
| Free | $0 per workspace, forever | 1 | 1 | 50 per workspace |
| Pro | $19 per seat per month | unlimited | unlimited | 1,000 per paid seat, pooled |
| Self-hosted | free | unlimited | unlimited | unlimited, with your own AI key |

Pro can also be billed yearly when a yearly price is offered. Prices shown at checkout come from the billing provider and include tax where it applies.

## Seats

A seat is a member with the **owner**, **admin** or **agent** role. **Viewers are free.** When members join, leave or change role, the seat count updates automatically, prorated.

On the free plan, the member limit counts all members plus pending invitations, and the owner is the one member.

## Upgrading and managing

Owners and admins upgrade from **Settings → Billing**, which opens a secure checkout. The billing portal from the same page manages the payment method, invoices, tax ids and cancellation.

## AI credits

AI features spend credits. See the [credit costs](/guides/ai/#credits-on-cloud).

- Each workspace gets a monthly allowance: 50 on Free, 1,000 per paid seat on Pro, shared across the workspace.
- **Credit packs** add 2,000 credits each, as a one-time purchase on Free or Pro. Purchased credits never expire and are spent after the monthly allowance.
- A failed AI request costs nothing.
- When credits run out, AI features ask you to top up, and the chat answer bot stops answering until credits are available.

## Payment problems and downgrades

- If a payment fails, Pro stays active while it is retried.
- If the subscription ends (canceled or unpaid), the workspace returns to Free.
- **Nothing is deleted on a downgrade.** Existing mailboxes and members stay. Creating new ones is refused until the workspace is within the free limits.

## Self-hosted

A self-hosted instance runs the same code with billing off: every workspace is on the self-hosted plan with unlimited mailboxes, members and AI use, paid for with your own [AI provider key](/self-hosting/ai/).

## Related

- [Billing API](/api/resources/billing/)
