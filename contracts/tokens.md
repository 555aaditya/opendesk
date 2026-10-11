# Tokens and credentials

All JWTs are **HS256**, signed with `AUTH_SECRET` (min 32 bytes; the Go API and the
Elixir gateway both refuse to boot below that). Every JWT carries a `purpose` claim
and a consumer accepts exactly one purpose. `exp` is required.

| purpose      | issued by                     | lifetime | accepted by                     |
| ------------ | ----------------------------- | -------- | ------------------------------- |
| `access`     | `/v1/auth/*` login + refresh  | 15 min   | Go API (Bearer)                 |
| `ws`         | `POST /v1/realtime/token`     | 5 min    | Elixir gateway (socket connect) |
| `widget_ws`  | `POST /v1/widget/session`     | 5 min    | Elixir gateway (socket connect) |
| `mfa`        | login when TOTP is enabled    | 5 min    | `POST /v1/auth/mfa`             |
| `oauth_state`| OAuth start endpoints         | 10 min   | OAuth callbacks                 |
| `passkey_login` | `POST /v1/auth/passkey/login/begin` | 5 min | `POST /v1/auth/passkey/login/finish` |
| `passkey_register` | `POST /v1/me/passkeys/register/begin` | 5 min | `POST /v1/me/passkeys/register/finish` |

## Claims

```jsonc
// access
{ "purpose": "access", "sub": "<user_id>", "sid": "<session_id>", "mfa": true, "iat": 0, "exp": 0 }

// access.mfa is true when the session passed a second factor: TOTP or a recovery code
// after the first factor, or a user-verified passkey on its own.

// passkey_login / passkey_register: jti names the pending WebAuthn ceremony stored
// server-side (challenge, expiry); finishing deletes it, so each token works once.
// passkey_register is bound to the user (sub) and the session (sid) that began it.
{ "purpose": "passkey_login", "jti": "<uuid>", "iat": 0, "exp": 0 }
{ "purpose": "passkey_register", "sub": "<user_id>", "sid": "<session_id>", "jti": "<uuid>", "iat": 0, "exp": 0 }

// ws (agent / API-key socket)
{ "purpose": "ws", "sub": "<user_id or api_key_id>", "kind": "user" | "api_key",
  "wid": "<workspace_id>", "role": "owner|admin|agent|viewer",
  "name": "Anna", "avatar": "https://...", "jti": "<uuid>", "iat": 0, "exp": 0 }

// widget_ws (end customer in the chat widget)
{ "purpose": "widget_ws", "sub": "<contact_id>", "wid": "<workspace_id>", "jti": "<uuid>", "iat": 0, "exp": 0 }
```

The gateway never touches the database: everything it needs to authorize a join is
in the claims.

## Opaque credentials (Go API only, stored hashed with SHA-256)

| credential      | format                          | where                                            |
| --------------- | ------------------------------- | ------------------------------------------------ |
| refresh token   | 32 random bytes, base64url      | `od_refresh` cookie, HttpOnly, Secure, SameSite=Lax, Path=`/v1/auth`, Domain=`COOKIE_DOMAIN` |
| API key         | `od_live_` + 32 bytes base64url | `Authorization: Bearer od_live_...`              |
| visitor token   | `od_vis_` + 32 bytes base64url  | `Authorization: Visitor od_vis_...` (widget API) |
| one-time tokens | 32 bytes base64url              | email links (verify, reset, invite, oauth login) |

Passwords: Argon2id only (`m=64MiB, t=3, p=2`, 16-byte salt, 32-byte key), PHC string format.

## Requests

- Agent requests: `Authorization: Bearer <access_jwt>` plus `OD-Workspace: <workspace_id>`
  for workspace-scoped routes. The API checks membership and resolves the role.
- API keys are bound to one workspace; `OD-Workspace` is ignored for them.
- Widget requests: `Authorization: Visitor <token>`; the workspace comes from the session.
