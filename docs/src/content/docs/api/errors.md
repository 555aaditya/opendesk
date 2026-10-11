---
title: Errors
description: opendesk returns RFC 9457 problem details with a stable machine-readable code.
---

Errors use [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details with content type `application/problem+json`:

```json
{
  "status": 422,
  "title": "Unprocessable Entity",
  "detail": "subject is required",
  "code": "validation_failed",
  "request_id": "01J9...",
  "errors": [
    { "message": "expected length >= 1", "location": "body.subject", "value": "" }
  ]
}
```

| field | meaning |
| --- | --- |
| `status` | The HTTP status code. |
| `title` | The standard text for that status. |
| `detail` | A human-readable explanation. Show it to people, but do not parse it. |
| `code` | A stable machine string. Branch on this. |
| `request_id` | Quote it if you contact support. Every response also has an `X-Request-Id` header. |
| `errors` | For validation errors, one entry per problem, with where it was found. |

## Codes

The common codes:

| code | status | meaning |
| --- | --- | --- |
| `bad_request` | 400 | The request is malformed. |
| `validation_failed` | 400, 422 | One or more fields are invalid. See `errors`. |
| `workspace_required` | 400 | A workspace-scoped route was called without `OD-Workspace`. |
| `captcha_failed` | 400 | The bot challenge on sign-in, registration or reset failed. |
| `unauthenticated` | 401 | Credentials are missing or invalid. |
| `invalid_credentials` | 401 | The email or password is wrong. The same answer is given for an unknown email. |
| `forbidden` | 403 | Your role or API key scopes do not allow this. |
| `mfa_required` | 403 | This action needs two-factor authentication on your account. |
| `reauth_required` | 403 | This action needs a recent sign-in. Sign in again and retry. |
| `plan_limit` | 402 | The workspace's plan limit is reached; `detail` names the limit. Cloud only. |
| `no_credits` | 402 | The workspace has no AI credits left. Cloud only. |
| `not_found` | 404 | The resource does not exist in this workspace. |
| `ai_disabled` | 404 | No AI provider is configured on this instance. |
| `billing_disabled` | 404 | Billing is not enabled on this instance. |
| `conflict` | 409 | The request conflicts with the current state, such as a duplicate. |
| `idempotency_in_progress` | 409 | A request with the same [idempotency key](/api/idempotency/) is still running. Retry shortly. |
| `idempotency_key_reused` | 422 | The idempotency key was used for a different request. Use a new key. |
| `too_large` | 413 | The upload or message is too large. |
| `rate_limited` | 429 | Too many requests. See [Rate limits](/api/rate-limits/). |
| `internal` | 500 | Something went wrong on our side. |

Some routes return more specific codes, such as `weak_password`, `email_taken` or `sole_owner`. They are listed per operation in the [OpenAPI reference](/api/openapi/). Treat a code you do not recognize by its HTTP status.

A request without valid credentials returns `401`. A resource in another workspace returns `404`, the same as one that does not exist.

Server errors always carry the same fixed message and never include internal details. The `request_id` lets the operator find the logged cause.

## Handling errors

- Retry `429` after the time in `RateLimit-Reset`, and `5xx` with exponential backoff.
- Do not retry other `4xx` responses unchanged.
- Use an [idempotency key](/api/idempotency/) on creates so a retry never creates a duplicate.
