---
title: Account and auth
description: Sign in, sessions, two-factor authentication and your own user account.
---

These endpoints act on the signed-in user, not a workspace, so they do not take `OD-Workspace`. They are for user sessions; API keys cannot use them.

## Sign-in

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/auth/config` | Providers, password login, sign-up and challenge settings |
| `POST` | `/v1/auth/register` | `{email, password, name, turnstile_token?}` |
| `POST` | `/v1/auth/login` | `{email, password, turnstile_token?}` |
| `POST` | `/v1/auth/mfa` | `{mfa_token, code}` |
| `POST` | `/v1/auth/refresh` | Refresh cookie → new access token, rotates the refresh token |
| `POST` | `/v1/auth/logout` | Revokes the session, closes sockets |
| `POST` | `/v1/auth/password/forgot` | `{email}`, always `204` |
| `POST` | `/v1/auth/password/reset` | `{token, password}` |
| `POST` | `/v1/auth/email/verify` | `{token}` |
| `POST` | `/v1/auth/email/resend` | |
| `GET` | `/v1/auth/oauth/{provider}/start?redirect_to=` | Redirects to Google, Microsoft, GitHub or OIDC |
| `GET` | `/v1/auth/oauth/{provider}/callback` | Redirects to `APP_URL/auth/callback?code=` |
| `POST` | `/v1/auth/oauth/exchange` | `{code}` → access token, or `mfa_required` |

```sh
curl https://api.opendesk.sh/v1/auth/config
```

```json
{ "providers": [{ "id": "google", "name": "Google" }], "password_login": true, "signup_enabled": true, "turnstile_site_key": "0x4AAA..." }
```

Login, registration and password reset are rate limited and protected by a Turnstile challenge when one is configured. Login gives the same answer, in the same time, for an unknown email and a wrong password.

## Two-factor authentication

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/auth/totp/setup` | → `{secret, otpauth_url}` |
| `POST` | `/v1/auth/totp/enable` | `{code}` → `{recovery_codes}` |
| `POST` | `/v1/auth/totp/disable` | `{code}` |

A code can be used only once. Recovery codes are single use.

## Your account

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/me` | `{ user, memberships }` |
| `PATCH` | `/v1/me` | `{name?, avatar_url?}` |
| `POST` | `/v1/me/password` | `{current_password, new_password}` |
| `GET` | `/v1/me/sessions` | Your sessions, with `current` marking this one |
| `DELETE` | `/v1/me/sessions/{id}` | Revoke a session |
| `DELETE` | `/v1/me` | `{password?, code?}`: delete your account |

```ts
type User = { id: string; email: string; name: string; avatar_url: string; email_verified: boolean; totp_enabled: boolean; created_at: string };
type Membership = { workspace: Workspace; role: Role };
```

Passwords are 12 to 128 characters and are refused if they appear in a list of breached passwords. Deleting your account is refused while you are the only owner of a workspace that has other members.
