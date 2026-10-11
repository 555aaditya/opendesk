---
title: Events catalog
description: Every event opendesk emits, its visibility and its data.
---

Every state change that someone else should see is written as an event, in the same database transaction as the change. Events are delivered three ways: on the [realtime gateway](/api/realtime/), to [webhooks](/api/webhooks/), and through replay with `GET /v1/events?since=<seq>`.

## Envelope

```jsonc
{
  "id": "0192f0c4-...",          // UUID v7, unique
  "seq": 1042,                    // contiguous per workspace
  "workspace_id": "…",
  "type": "message.created",
  "visibility": "agents",         // "agents" | "public"
  "topics": ["workspace:<wid>", "user:<uid>", "contact:<wid>:<contact_id>"],
  "data": { },
  "occurred_at": "2026-10-11T09:00:00Z"
}
```

- `seq` increases by exactly one per event within a workspace. A jump means you missed events.
- `visibility: "public"` events may reach the end customer in the chat widget. Everything else is `"agents"`: internal notes, assignment, tags, SLA and all settings.
- `topics` decide realtime fan-out. Webhooks receive the envelope without `topics`.
- Objects in `data` are the same JSON the REST API returns.

## Catalog

| Type | Visibility | Extra topics | Data |
| --- | --- | --- | --- |
| `ticket.created` | agents | | `{ ticket }` |
| `ticket.updated` | agents | `user:<assignee>` when the assignee changes | `{ ticket, changes: ["status", "assignee_id", ...] }` |
| `ticket.deleted` | agents | | `{ ticket_id }` |
| `message.created` | see below | `contact:<wid>:<cid>` when public | `{ ticket_id, message }` |
| `message.updated` | agents | | `{ ticket_id, message }`, for delivery status changes |
| `activity.created` | agents | | `{ ticket_id, activity }` |
| `contact.created`, `contact.updated` | agents | | `{ contact }` |
| `contact.deleted` | agents | | `{ contact_id }` |
| `company.created`, `company.updated` | agents | | `{ company }` |
| `company.deleted` | agents | | `{ company_id }` |
| `tag.created`, `tag.updated` | agents | | `{ tag }` |
| `tag.deleted` | agents | | `{ tag_id }` |
| `mailbox.created`, `mailbox.updated` | agents | | `{ mailbox }` |
| `mailbox.deleted` | agents | | `{ mailbox_id }` |
| `member.added`, `member.updated` | agents | `user:<uid>` | `{ member }` |
| `member.removed` | agents | `user:<uid>` | `{ user_id }` |
| `notification.created` | agents | `user:<uid>` | `{ notification }` |
| `saved_reply.*`, `view.*`, `automation.*`, `sla_policy.*`, `kb_article.*`, `kb_collection.*`, `team.*`, `webhook.*` | agents | | `{ <resource> }` on create and update, `{ <resource>_id }` on delete |
| `billing.updated` | agents | | `Billing`, see [Billing API](/api/resources/billing/). Cloud only. |
| `webhook.test` | | | sent only to the webhook being tested |

### message.created visibility

| Message | Visibility |
| --- | --- |
| A note | `agents` |
| A reply on a chat ticket | `public`, also sent to the contact's topic |
| A reply on an email ticket | `agents` (the customer receives it by email) |

### Gateway-only events

`chat.typing` is not stored, has no `seq` and never reaches webhooks. The gateway sends typing indicators directly to the ticket and contact topics. See [Realtime](/api/realtime/#presence-and-typing-on-a-ticket).

AI summaries and triage results arrive as `ticket.updated` with `custom` in `changes`. Chat widget AI answers arrive as a normal `message.created`.

## Retention

Events are kept for 7 days (`EVENT_RETENTION` on self-hosted instances) for replay, then pruned.
