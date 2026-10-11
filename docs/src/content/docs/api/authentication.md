---
title: Authentication
description: Authenticate with user access tokens or workspace API keys, and the scopes each key can hold.
---

opendesk accepts two kinds of bearer credential.

| credential | for | header |
| --- | --- | --- |
| Access token | The web app and anything acting as a signed-in user | `Authorization: Bearer <jwt>` plus `OD-Workspace` |
| API key | Servers, scripts and integrations | `Authorization: Bearer od_live_...` |

The chat widget uses a third, narrower credential, the visitor token (`Authorization: Visitor od_vis_...`). See [Widget API](/api/resources/widget/).

## API keys

API keys are the right choice for integrations. Create one in **Settings → API keys** (admin only) with a name, a set of scopes and an optional expiry. The secret is shown **once**, when the key is created. opendesk stores only a hash of it.

```sh
curl https://api.opendesk.sh/v1/contacts \
  -H "Authorization: Bearer od_live_3q2...xYz"
```

- A key is bound to one workspace. `OD-Workspace` is ignored.
- The key list shows each key's prefix, scopes, creator, expiry and when it was last used.
- Deleting a key revokes it immediately. Creating and deleting keys is audit-logged.

### Scopes

| scope | grants |
| --- | --- |
| `tickets:read` | Read tickets, their messages and activities, and related ticket data |
| `tickets:write` | Create, update and reply to tickets |
| `contacts:read` | Read contacts and companies |
| `contacts:write` | Create, update and delete contacts and companies |
| `kb:read` | Read knowledge base collections and articles, including drafts |
| `kb:write` | Create, update and delete collections and articles |
| `settings:read` | Read workspace settings, such as the workspace, members, teams, mailboxes and webhooks |
| `settings:write` | Change workspace settings |
| `realtime` | Get a [realtime](/api/realtime/) token for the workspace |

Give each key only the scopes it needs. A request outside a key's scopes returns `403` with code `forbidden`.

## Access tokens

Access tokens are short-lived JWTs (15 minutes) issued when a user signs in.

1. `POST /v1/auth/login` with `{ "email", "password" }` returns `{ access_token, expires_in, user }` and sets a refresh cookie. If the account has two-factor authentication, it returns `{ "mfa_required": true, "mfa_token" }` instead; send that with the code to `POST /v1/auth/mfa`.
2. Send `Authorization: Bearer <access_token>` and `OD-Workspace: <id>` on each request.
3. Before it expires, `POST /v1/auth/refresh` with the cookie returns a new access token. The refresh token rotates on every use.
4. `POST /v1/auth/logout` revokes the session and closes its live sockets.

The refresh token lives in an `od_refresh` cookie (HttpOnly, Secure, SameSite=Lax, scoped to `/v1/auth`), so it is never readable by page scripts.

Sign-in is rate limited and protected by a challenge, so for automation use API keys rather than scripting a login.

## Credential formats

| credential | format | lifetime |
| --- | --- | --- |
| Access token | JWT, HS256, `purpose: access` | 15 minutes |
| Realtime token | JWT, `purpose: ws` | 5 minutes, only needs to be valid at connect |
| API key | `od_live_` + 32 random bytes, base64url | until revoked or its expiry |
| Visitor token | `od_vis_` + 32 random bytes, base64url | the widget session |

Every JWT carries a `purpose`, and each consumer accepts exactly one, so a token issued for one use cannot be replayed for another.
