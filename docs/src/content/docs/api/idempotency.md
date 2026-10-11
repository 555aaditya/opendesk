---
title: Idempotency
description: Retry create requests safely with the Idempotency-Key header.
---

Networks fail. If a create request times out, you cannot tell whether it reached the server. An idempotency key lets you retry without creating a duplicate.

Send an `Idempotency-Key` header on `POST` create routes, with a unique value per logical operation, such as a UUID:

```sh
curl https://api.opendesk.sh/v1/tickets \
  -H "Authorization: Bearer od_live_..." \
  -H "Idempotency-Key: 6f1c9a2e-8a8e-4c4e-9f0b-2b6a1d7e4c10" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Order 1234 not delivered","contact":{"email":"ana@example.com","name":"Ana"},"channel":"api","body_html":"<p>Customer reports order 1234 has not arrived.</p>","kind":"note"}'
```

If you retry with the same key within **24 hours**, opendesk returns the result of the first request instead of performing it again. A replayed response has the same status, body, `Content-Type` and `Location` as the first one, plus the header `Idempotent-Replayed: true`.

## Rules

- Generate a new key for each new operation, and reuse a key only to retry that same request with the same body.
- A key is 1 to 255 printable ASCII characters. Any other value returns `422 validation_failed`.
- Keys belong to the caller: the API key, or the signed-in user in the selected workspace. Another caller can use the same value without conflict.
- Keys are kept for 24 hours. After that, the same key is treated as a new request.
- Idempotency applies to authenticated `POST` routes, such as creates. `PATCH` and `DELETE` are naturally safe to retry. Sign-in and token routes, and streamed (`text/event-stream`) responses, are not covered.

## Outcomes

| Situation | Response |
| --- | --- |
| First request with a key | Runs normally. The result is stored, unless it is a `5xx` or `429`. |
| Retry with the same key and body | The stored result, with `Idempotent-Replayed: true`. |
| Same key with a different body or route | `422 idempotency_key_reused`. Use a new key. |
| Same key while the first request is still running | `409 idempotency_in_progress`. Retry shortly. |
| First request failed with a `5xx` or `429` | Nothing is stored, so a retry with the same key runs again. |

Responses larger than 1 MiB are not stored, so a retry of such a request runs again.
