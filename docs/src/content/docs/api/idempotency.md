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

If you retry with the same key within **24 hours**, opendesk returns the result of the first request instead of performing it again.

## Rules

- Generate a new key for each new operation, and reuse a key only to retry that same request with the same body.
- Keys are kept for 24 hours. After that, the same key is treated as a new request.
- Idempotency applies to `POST` create routes. `PATCH` and `DELETE` are naturally safe to retry.
