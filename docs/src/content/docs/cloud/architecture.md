---
title: Domains, AWS and Cloudflare
description: How the hosted opendesk service is laid out across domains, AWS, Cloudflare and Neon.
---

The hosted service at opendesk.sh runs the same code as a self-hosted install, split into roles and spread across managed infrastructure. The infrastructure is defined in Terraform in `deploy/terraform`.

## Domains

| Domain | Serves | Runs on |
| --- | --- | --- |
| `opendesk.sh` | Marketing site and `install.sh` | Cloudflare Pages |
| `docs.opendesk.sh` | This documentation | Cloudflare Pages |
| `app.opendesk.sh` | The web app, help center and `widget/v1.js` | Cloudflare Pages |
| `api.opendesk.sh` | The REST API, `/docs` and `/v1/openapi.json` | AWS ECS behind an ALB |
| `gateway.opendesk.sh` | The realtime gateway (`/socket`) | AWS ECS behind the same ALB |
| `in.opendesk.sh` | Forwarding addresses (`<token>@in.opendesk.sh`) | Cloudflare Email Routing and an Email Worker |

## Request path

```
browser ──▶ Cloudflare ──▶ app.opendesk.sh (Pages, static)
        └─▶ Cloudflare ──▶ ALB ──▶ api (ECS Fargate) ──▶ Neon Postgres (pooled)
                              └──▶ gateway (ECS Fargate) ◀── NATS ◀── worker (ECS Fargate) ──▶ Neon (direct)
```

## AWS

- **ECS Fargate** runs the opendesk API (`OPENDESK_ROLE=api`), workers (`OPENDESK_ROLE=worker`) and the realtime gateway as separate services, each scaled independently.
- **NATS** runs as a three-node JetStream cluster on ECS. Every API, worker and gateway task connects to it.
- An **Application Load Balancer** terminates TLS for the API and gateway, with certificates from ACM.
- **S3** stores attachments and raw email, in a private bucket. Downloads use short-lived signed URLs.
- **SES** sends platform email (verification, password reset, invitations) with DKIM, a custom MAIL FROM domain and DMARC.
- **Secrets Manager** and **KMS** hold every secret; tasks receive them at start.
- Deployments use short-lived credentials through GitHub OIDC. Images are immutable and tagged by commit.

## Cloudflare

- **DNS** and zone security settings for every domain.
- **Pages** hosts the site, docs and web app as static builds.
- **Email Routing** receives all mail for `in.opendesk.sh` with a catch-all rule and hands each message to the **Email Worker**, which posts it to `POST /v1/inbound/email` with a shared secret. If the API is unavailable, the worker reports a temporary failure so the sending server retries later.

## Neon

Postgres runs on [Neon](https://neon.tech). Request handlers use the pooled (`-pooler`) host; migrations, background jobs and the event relay use the direct host, because they need session features such as `LISTEN`/`NOTIFY`. The production branch does not autosuspend. opendesk uses no Neon-only features, so the same code runs on stock Postgres.

## Data flow for a change

1. An agent's request writes the change and an event in one Postgres transaction.
2. A worker's event relay publishes the event to NATS on `od.events.<workspace_id>`.
3. Every gateway node pushes it to the browsers subscribed to that workspace.
4. The relay also queues webhook deliveries.

## Subprocessors

| Provider | Purpose |
| --- | --- |
| Amazon Web Services | Compute, object storage, email sending, secrets |
| Cloudflare | DNS, static hosting, inbound email, edge security |
| Neon | Managed Postgres |
| PostHog | Product analytics, without personal data in events |
