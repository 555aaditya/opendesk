# Realtime gateway (Elixir, `gateway.opendesk.sh`)

Phoenix Channels over WebSocket, JSON serializer v2 (use the `phoenix` npm client).
The gateway is stateless apart from Presence and holds **no database connection**.

## Connect

Two sockets. `GATEWAY_URL` is `wss://gateway.opendesk.sh/socket` (self-hosted
single-domain: `wss://desk.example.com/socket`, Caddy routes `/socket*`); the `phoenix`
client appends `/websocket`.

| socket | `new Socket(...)` URL | wire path | tokens | Origin | topics |
| --- | --- | --- | --- | --- | --- |
| agents | `GATEWAY_URL` | `/socket/websocket?vsn=2.0.0&token=<jwt>` | `ws` only | must be in `CHECK_ORIGINS` (non-browser clients send none and are allowed) | `workspace:`, `user:`, `ticket:` |
| widget | `GATEWAY_URL + "/widget"` | `/socket/widget/websocket?vsn=2.0.0&token=<jwt>` | `widget_ws` only | any (the widget is embedded on customer sites) | `contact:<wid>:<sub>` only |

1. Client gets a token: agents `POST /v1/realtime/token` (purpose `ws`), widget
   `POST /v1/widget/session` (purpose `widget_ws`; its response also carries
   `gateway_url` = `GATEWAY_URL + "/widget"`, i.e. `wss://gateway.opendesk.sh/socket/widget`,
   which the widget passes to `new Socket(gateway_url, ...)`). Tokens live 5 minutes; they only
   need to be valid at connect. On reconnect the client fetches a fresh one.
2. Gateway verifies HS256 with `AUTH_SECRET`, checks `exp` and that the `purpose` is the
   one that socket accepts; the agents' socket also checks the browser `Origin` against
   `CHECK_ORIGINS` (comma-separated). A token on the wrong socket is refused (HTTP 403).
3. Socket id `user_socket:<sub>` so `od.control.disconnect` can kill it.

## Channels

| topic                         | who may join                                   | server pushes |
| ----------------------------- | ---------------------------------------------- | ------------- |
| `workspace:<wid>`             | `ws` token with that `wid`                     | `"event"` with every envelope for that workspace (visibility `agents` or `public`) |
| | | Pushed envelopes omit `topics`: per-user events (`notification.created`) are told apart by the channel they arrive on (`user:<uid>`), not by `topics` |
| `user:<uid>`                  | `ws` token, `kind=user`, `sub == uid`          | `"event"` envelopes whose topics include `user:<uid>` |
| `ticket:<wid>:<ticket_id>`    | `ws` token, `kind=user`, same `wid`            | Presence (`presence_state`, `presence_diff`), `"typing"` and `"live"` |
| `contact:<wid>:<contact_id>`  | widget socket: `widget_ws` token with `sub == contact_id`, same `wid` | `"event"` for public envelopes with that topic, `"typing"` from agents and `"live"` |

Join params on `ticket:<wid>:<tid>`: `{"watch": true}` watches a ticket (the inbox list
shows who is on it): the joiner receives `presence_state`/`presence_diff` but is **not**
tracked, and its `"presence"` and `"typing"` pushes are ignored. `{"state": "viewing" |
"replying" | "idle"}` sets the initial Presence state (default `"viewing"`).

Join replies `{"ok": {"server_time": "..."}}`. Unauthorized joins reply `{"error": {"reason": "forbidden"}}`.

### Client → server

On `ticket:<wid>:<tid>`:
- `"presence"` `{ "state": "viewing" | "replying" | "idle" }` updates the caller's Presence
  meta (`{user_id, name, avatar, state, online_at}`). Rate limited.
- `"typing"` `{ "contact_id": "..."? }` broadcasts `"typing"` `{user_id, name}` to other
  agents on the ticket topic, and when `contact_id` is given, to `contact:<wid>:<contact_id>`
  as `{ "ticket_id", "user": {id, name} }` (chat tickets only).

On `contact:<wid>:<cid>`:
- `"typing"` `{ "ticket_id": "..." }` broadcasts `"customer_typing"` `{ticket_id, contact_id}` to that ticket topic; `contact_id` comes from the token, and clients show it only when it is the ticket's contact
  to `ticket:<wid>:<ticket_id>`.

Clients send messages through REST, never through the socket.

## Live events

Short-lived previews that are never stored or replayed: the widget agent's reply as it is generated
(`contracts/agent.md`). The API publishes them on NATS subject **`od.live.<wid>`**:

```jsonc
{ "workspace_id": "…", "ticket_id": "…", "contact_id": "…",
  "type": "ai.reply.started" | "ai.reply.delta" | "ai.reply.tool" | "ai.reply.ended", "data": { /* below */ } }
```

The gateway checks that `workspace_id` matches the subject and that the ids are uuids, then pushes
`"live"` with `{type, data}` to `contact:<wid>:<contact_id>` and `ticket:<wid>:<ticket_id>` (watchers
included). There is no `seq` and no catch-up: a client that misses them still gets the posted
message as `message.created`.

| type | data |
| --- | --- |
| `ai.reply.started` | `{reply_id, ticket_id, bot: {name}}`: the agent is writing (show a typing state) |
| `ai.reply.delta` | `{reply_id, ticket_id, text}`: append `text` (markdown; hide `[n]` citation markers) |
| `ai.reply.tool` | `{reply_id, ticket_id, tool: string /* display name */, status: "running" \| "done" \| "error"}`: the agent is using a tool (show "Checking <tool>…") |
| `ai.reply.ended` | `{reply_id, ticket_id, message_id: string \| null, handoff: boolean, action_id: string \| null}`: `message_id` is the posted message (replace the preview with it when its `message.created` arrives); `null` means nothing was posted (drop the preview); `action_id` when the message asks the visitor to confirm an action |

`reply_id` is a uuid per generated reply. Events of one reply arrive in order.

## Missed events

Each `"event"` carries `seq`. The web app tracks the last `seq` it applied for its
workspace. On reconnect, or when `seq` is not `last + 1`, it calls
`GET /v1/events?since=<last>` and applies those first. If that returns
`{"resync": true}` (gap older than retention), it invalidates all queries.

## Ops

- Health: `GET /health` → 200.
- Metrics/errors: PostHog (`POSTHOG_KEY`) for connection counts and errors, optional.
- Clustering: `libcluster` with DNS polling (`CLUSTER_DNS`) so Presence spans nodes; a
  single node needs nothing.
- Env: `PORT` (4000), `AUTH_SECRET`, `NATS_URL`, `NATS_TOKEN`, `CHECK_ORIGINS`,
  `SECRET_KEY_BASE`, `CLUSTER_DNS`, `POSTHOG_KEY`, `POSTHOG_HOST`.
