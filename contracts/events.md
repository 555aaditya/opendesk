# Events

Every state change that someone else should see is written as an **event** in the
same database transaction as the change (`events` table = transactional outbox).
Use `events.Publish(ctx, tx, events.Event{...})` from `internal/events`; never write
the table by hand.

`seq` is contiguous **per workspace** (`workspaces.event_seq`, incremented with
`UPDATE ... RETURNING`). A client that sees `seq` jump knows it missed events and
fetches them with `GET /v1/events?since=<last_seq>`.

## Envelope

```jsonc
{
  "id": "0192f0c4-...",          // uuid v7, unique
  "seq": 1042,                    // contiguous per workspace
  "workspace_id": "…",
  "type": "message.created",
  "visibility": "agents",         // "agents" | "public"
  "topics": ["workspace:<wid>", "user:<uid>", "contact:<wid>:<contact_id>"],
  "data": { /* see catalog */ },
  "occurred_at": "2026-10-11T09:00:00Z"
}
```

- `visibility: "public"` events may reach the end customer (widget). Internal notes,
  assignment, tags, SLA and everything else is `"agents"`.
- `topics` decides fan-out in the gateway. Every event includes `workspace:<wid>`.
  Add `user:<uid>` for per-user notifications, and `contact:<wid>:<contact_id>` for
  public events about a chat conversation.

## Transport

1. `events.Relay` (worker role) reads unpublished rows in seq order, publishes each to
   NATS subject **`od.events.<workspace_id>`** (JSON envelope as payload), sets
   `published_at`, and enqueues webhook deliveries.
2. The Elixir gateway subscribes to `od.events.>` and pushes to Phoenix channels.
3. Control messages on **`od.control.disconnect`**: `{"user_id": "...", "session_id": "..."?}`
   tells the gateway to close that user's sockets (logout, password change, removal).
4. Rows are kept 7 days for replay, then pruned.

## Catalog

`data` shapes. Objects are the same JSON the REST API returns for that resource.

| type                     | visibility | topics (besides workspace)            | data |
| ------------------------ | ---------- | ------------------------------------- | ---- |
| `ticket.created`         | agents     | —                                     | `{ "ticket": Ticket }` |
| `ticket.updated`         | agents     | `user:<assignee>` when assignee changes | `{ "ticket": Ticket, "changes": ["status","assignee_id",...] }` |
| `ticket.deleted`         | agents     | —                                     | `{ "ticket_id": "..." }` |
| `message.created`        | agents (note) / public (reply on chat ticket) / agents (reply on email ticket) | `contact:<wid>:<cid>` when public | `{ "ticket_id": "...", "message": Message }` |
| `message.updated`        | agents     | —                                     | `{ "ticket_id": "...", "message": Message }` (delivery status) |
| `activity.created`       | agents     | —                                     | `{ "ticket_id": "...", "activity": Activity }` |
| `contact.created` / `contact.updated` / `contact.deleted` | agents | — | `{ "contact": Contact }` / `{ "contact_id" }` |
| `company.created` / `company.updated` / `company.deleted` | agents | — | `{ "company": Company }` / `{ "company_id" }` |
| `tag.created` / `tag.updated` / `tag.deleted` | agents | — | `{ "tag": Tag }` / `{ "tag_id" }` |
| `mailbox.created` / `mailbox.updated` / `mailbox.deleted` | agents | — | `{ "mailbox": Mailbox }` / `{ "mailbox_id" }` |
| `member.added` / `member.updated` / `member.removed` | agents | `user:<uid>` | `{ "member": Member }` / `{ "user_id" }` |
| `notification.created`   | agents     | `user:<uid>`                          | `{ "notification": Notification }` |
| `billing.updated`        | agents     | —                                     | `Billing` (`contracts/billing.md`): plan, status, seats, limits, usage, credits, prices. Sent on subscription changes, seat syncs and credit purchases |
| `saved_reply.*`, `view.*`, `automation.*`, `sla_policy.*`, `kb_article.*`, `kb_collection.*`, `team.*`, `webhook.*` | agents | — | `{ "<resource>": Obj }` / `{ "<resource>_id" }` |
| `chat.typing` (not stored; gateway only) | public | `contact:<wid>:<cid>` | `{ "ticket_id": "...", "user": {"id","name"} }` |

Webhooks receive the envelope unchanged (minus `topics`), signed:
`OD-Signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>.<body>")>`, `OD-Event-Id`, `OD-Event-Type`.
