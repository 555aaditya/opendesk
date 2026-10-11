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
| `ticket:<wid>:<ticket_id>`    | `ws` token, `kind=user`, same `wid`            | Presence (`presence_state`, `presence_diff`) and `"typing"` |
| `contact:<wid>:<contact_id>`  | widget socket: `widget_ws` token with `sub == contact_id`, same `wid` | `"event"` for public envelopes with that topic, and `"typing"` from agents |

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
- `"typing"` `{ "ticket_id": "..." }` broadcasts `"customer_typing"` `{ticket_id, contact_id}`
  to `ticket:<wid>:<ticket_id>`.

Clients send messages through REST, never through the socket.

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
