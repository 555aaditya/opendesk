---
title: Configuration reference
description: Every environment variable opendesk and the realtime gateway read, with defaults and meaning.
---

opendesk reads its configuration from environment variables. The self-host bundle keeps them in `/opt/opendesk/.env`; for local development, copy `.env.example` in the repository to `.env`.

Empty values use the default. Booleans accept `true`/`false`, `1`/`0`.

## Refuses to boot

opendesk checks its secrets at start and refuses to run when they are unsafe:

- `AUTH_SECRET` shorter than 32 bytes. Outside production a development secret is used when it is empty.
- `CREDENTIALS_KEY` missing in production, or not 32 bytes.
- In production, embedded NATS listening beyond `127.0.0.1` without `NATS_TOKEN`.
- `OPENDESK_ROLE` other than `all`, `api` or `worker`.
- `STRIPE_SECRET_KEY` set without `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO`.

The realtime gateway also refuses to start with an `AUTH_SECRET` under 32 bytes.

## Core

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENDESK_ENV` | `development` | `development` or `production`. Production enforces the checks above. |
| `OPENDESK_ROLE` | `all` | `all` (API and workers), `api` or `worker`. See [Scaling](/self-hosting/scaling/). |
| `HTTP_ADDR` | `:8080` | Address the HTTP server listens on. |
| `DATA_DIR` | `./data` | Local data: attachments with the `local` driver, and embedded NATS storage. |
| `SERVE_WEB` | `false` | Serve the embedded web app and `/config.js` from this binary. `true` in the self-host bundle. |
| `SIGNUP_ENABLED` | `true` | Allow anyone to register. When `false`, only invited people can create an account. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers from a reverse proxy for the client IP. Enable only behind a proxy you control. |
| `EVENT_RETENTION` | `168h` | How long events are kept for replay (a Go duration). |

## URLs

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_URL` | `http://localhost:8080` | Public URL of the API. OAuth redirect URIs are built from it. |
| `APP_URL` | `http://localhost:5173` | Public URL of the web app. Links in email point here. |
| `GATEWAY_URL` | `ws://localhost:4000/socket` | Public WebSocket URL of the realtime gateway, given to clients. |
| `SITE_URL` | `https://opendesk.sh` | Marketing site URL used in links. |
| `CORS_ORIGINS` | `APP_URL` | Comma-separated origins allowed to call the API from a browser. |
| `COOKIE_DOMAIN` | empty (host only) | Domain for the refresh cookie. Set it when the API and app are on different subdomains of one domain. |
| `COOKIE_SECURE` | `true` when `API_URL` is `https` | Mark cookies `Secure`. |

On a self-hosted single domain, `API_URL` and `APP_URL` are both `https://desk.example.com` and `GATEWAY_URL` is `wss://desk.example.com/socket`.

## Database

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://opendesk:opendesk@localhost:5432/opendesk?sslmode=disable` | Pooled connection used by request handlers. On Neon, the `-pooler` host. |
| `DATABASE_URL_DIRECT` | `DATABASE_URL` | Direct connection for migrations, background jobs and the event relay, which need session features such as `LISTEN`/`NOTIFY`. |

See [Postgres and Neon](/self-hosting/postgres/).

## Secrets

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUTH_SECRET` | none in production | At least 32 bytes. Signs every JWT. **Must be identical** in opendesk and the realtime gateway. |
| `CREDENTIALS_KEY` | none in production | 32 bytes, hex or base64. Encrypts mailbox credentials, OAuth tokens, webhook secrets and TOTP secrets with AES-256-GCM. **Never change it**: existing credentials become unreadable. |

Generate them with `openssl rand -hex 32`.

## NATS

| Variable | Default | Meaning |
| --- | --- | --- |
| `NATS_URL` | empty | Empty runs NATS **embedded** in this process. Set it to use an external NATS cluster. |
| `NATS_TOKEN` | empty | Token for the embedded server, or for the external cluster. Required in production when embedded NATS listens beyond localhost. |
| `NATS_LISTEN` | `127.0.0.1:4222` | Where embedded NATS listens, so the realtime gateway can connect. |
| `NATS_STORE_DIR` | `DATA_DIR/nats` | Embedded NATS storage directory. |

## Storage

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local` (under `DATA_DIR`) or `s3` (any S3-compatible store). |
| `S3_BUCKET` | | Bucket name. |
| `S3_REGION` | `auto` | Region. `auto` suits Cloudflare R2. |
| `S3_ENDPOINT` | | Custom endpoint for R2, MinIO and others. Empty uses AWS. |
| `S3_ACCESS_KEY_ID` | | Access key. |
| `S3_SECRET_ACCESS_KEY` | | Secret key. |
| `S3_FORCE_PATH_STYLE` | `false` | Use path-style URLs. Usually needed for MinIO. |

See [Storage](/self-hosting/storage/).

## Platform email

Verification, password reset and invitation emails. Replies to customers go through each mailbox, not this.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAIL_DRIVER` | `log` | `log` (print to the log), `smtp` or `ses`. |
| `MAIL_FROM` | `opendesk <notifications@localhost>` | From address. |
| `SMTP_HOST` | | SMTP server. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_USERNAME` | | SMTP username. |
| `SMTP_PASSWORD` | | SMTP password. |
| `SMTP_TLS` | `starttls` | `starttls`, `tls` or `none`. |
| `SES_REGION` | `us-east-1` | Amazon SES region, with `MAIL_DRIVER=ses`. Credentials come from the standard AWS environment. |

## Inbound email

| Variable | Default | Meaning |
| --- | --- | --- |
| `INBOUND_DOMAIN` | `in.localhost` | Forwarding addresses are `<token>@INBOUND_DOMAIN`. |
| `INBOUND_SECRET` | | Shared secret for `POST /v1/inbound/email` (the `OD-Inbound-Secret` header). Empty turns the endpoint off. |
| `INBOUND_SMTP_ADDR` | empty (off) | Address for the built-in SMTP receiver, such as `:2525` or `:25`. |

See [Email setup](/self-hosting/email/).

## Sign-in providers and mailbox OAuth

| Variable | Default | Meaning |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Google sign-in and Gmail mailbox connections. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | | Microsoft sign-in and Outlook mailbox connections. |
| `MICROSOFT_TENANT` | `common` | `common`, `organizations`, `consumers` or your tenant id. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | | GitHub sign-in. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | | Any OpenID Connect provider for single sign-on. |
| `OIDC_NAME` | `SSO` | Button label for the OIDC provider. |

See [Google and Microsoft OAuth](/self-hosting/oauth-apps/). A sign-in provider is offered only when it is configured (for OIDC, the issuer and client id).

## Profile pictures

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOGO_DEV_TOKEN` | | A [logo.dev](https://logo.dev) publishable token. When set, company logos come from logo.dev instead of the company's website. |

Agent pictures from Google and GitHub, Gravatar and website icons need no configuration. See [Profile pictures and logos](/guides/profile-pictures/).

## Bot protection and analytics

| Variable | Default | Meaning |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | | Cloudflare Turnstile on login, registration and password reset. |
| `POSTHOG_KEY` | | Product analytics. Empty sends nothing. |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | PostHog host. |

## AI

AI features are on when a provider is configured. See [AI features](/guides/ai/).

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | detected | `anthropic`, `openai` (any OpenAI-compatible endpoint) or `none`. When empty: `anthropic` if `ANTHROPIC_API_KEY` is set, else `openai` if `OPENAI_API_KEY` is set, else `none`. |
| `ANTHROPIC_API_KEY` | | Anthropic API key. |
| `OPENAI_API_KEY` | | Key for OpenAI or a compatible endpoint. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint: Azure, Ollama, vLLM, LM Studio. Point it at a local model to keep everything on your server. |
| `AI_MODEL` | `claude-sonnet-5-5` with Anthropic | Model for drafting, summaries and answers. Required for `openai`. |
| `AI_FAST_MODEL` | `claude-haiku-4-5-20251001` with Anthropic, else `AI_MODEL` | Model for triage, classification and short rewrites. |
| `EMBEDDINGS_DRIVER` | detected | `voyage`, `openai` or `none`. When empty: `voyage` if `VOYAGE_API_KEY` is set, else `openai` with the `openai` provider, else `none` (search falls back to Postgres full-text search). |
| `VOYAGE_API_KEY` | | Voyage AI key for embeddings. |
| `EMBEDDINGS_MODEL` | | Embeddings model. |

Semantic search needs the Postgres `vector` extension (pgvector). Without it, opendesk uses full-text search.

## Billing (Cloud only)

Leave these empty on a self-hosted instance. Without `STRIPE_SECRET_KEY`, every workspace is on the `self_hosted` plan with no limits and unlimited AI.

| Variable | Default | Meaning |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | | Turns billing on. |
| `STRIPE_WEBHOOK_SECRET` | | Verifies Stripe webhooks. Required with billing. |
| `STRIPE_PRICE_PRO` | | Monthly per-seat price. Required with billing. |
| `STRIPE_PRICE_PRO_YEARLY` | | Optional yearly per-seat price. |
| `STRIPE_PRICE_CREDITS` | | One-time price for an AI credit pack. |
| `STRIPE_TAX` | `true` | Automatic tax on Checkout. |
| `STRIPE_API_URL` | | Development only: a local Stripe fake or stripe-mock. Refused when `OPENDESK_ENV=production`. |

## Realtime gateway

The `realtime` container reads its own variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | Listen port. |
| `AUTH_SECRET` | | **The same value** as opendesk. Verifies socket tokens. |
| `NATS_URL` | | NATS to subscribe to: opendesk's embedded server (`NATS_LISTEN`) or your cluster. |
| `NATS_TOKEN` | | NATS token. |
| `CHECK_ORIGINS` | | Comma-separated browser origins allowed to open agent sockets, such as `https://desk.example.com`. The chat widget endpoint (`/socket/widget`) accepts any origin, since it takes only widget tokens. |
| `SECRET_KEY_BASE` | | Phoenix secret. Generate with `openssl rand -hex 48`. |
| `CLUSTER_DNS` | empty | A DNS name that resolves to every gateway node, so Presence spans nodes. A single node needs nothing. |
| `POSTHOG_KEY`, `POSTHOG_HOST` | | Optional connection metrics and errors. |

The gateway's health check is `GET /health`.
