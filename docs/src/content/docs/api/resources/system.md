---
title: System
description: Health checks, the OpenAPI document and the API reference UI.
---

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness: the process is up |
| `GET` | `/readyz` | Readiness: the database and NATS are reachable |
| `GET` | `/v1/openapi.json` | The OpenAPI 3.1 document |
| `GET` | `/docs` | The interactive API reference |
| `GET` | `/v1/events?since=<seq>` | Missed events, see [Realtime](/api/realtime/#missed-events) |
| `POST` | `/v1/realtime/token` | A socket token, see [Realtime](/api/realtime/) |

The realtime gateway has its own health check at `GET /health`.

Use `/healthz` for container liveness and `/readyz` for load balancer readiness.
