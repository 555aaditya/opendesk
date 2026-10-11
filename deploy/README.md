# Deploying opendesk

opendesk ships two ways from the same code and the same images:

- **Self-hosted**: one machine, one domain, `curl -fsSL https://opendesk.sh/install.sh | sh`.
- **Hosted** (opendesk.sh): AWS ECS Fargate, Neon Postgres, Cloudflare in front.

```
deploy/
  docker/
    opendesk.Dockerfile        Go binary (API + workers + embedded NATS) with the web app embedded
    realtime.Dockerfile        the Phoenix gateway release (+ entrypoint, healthcheck)
  caddy/Caddyfile              self-host: automatic HTTPS, /socket* -> realtime, rest -> opendesk
  self-host/
    .env.template              every self-host setting, documented
    gen-env.sh                 .env with fresh secrets (make selfhost-env)
    opendesk-ctl               status, logs, backup, restore, upgrade
  install/
    install.sh(.sha256)        the one-command installer, published at opendesk.sh/install.sh
    stage-assets.sh            packages what the installer downloads from a release
  cloudflare/
    email-worker/              in.opendesk.sh mail -> POST /v1/inbound/email
    pages/                     _headers, runtime config and notes for the three Pages projects
  terraform/                   AWS + Cloudflare + Neon, see terraform/README.md
docker-compose.yml             (repo root) the self-host stack the installer runs
.github/workflows/             ci, release, deploy, security, neon-cleanup
```

## Architecture (hosted)

```
                                 Cloudflare (DNS, proxy, WAF, TLS)
  browsers ───────────┬───────────────┬───────────────────┬────────────────────┐
                      │               │                   │                    │
               opendesk.sh    docs.opendesk.sh    app.opendesk.sh       api.opendesk.sh
                Pages:site      Pages:docs       Pages:app + widget    gateway.opendesk.sh
                                                  + help center              │
                                                                             ▼
  mail to *@in.opendesk.sh                                ┌──── AWS us-east-1, one VPC, public subnets ────┐
        │                                                 │                                                 │
        ▼                                                 │   ALB (ACM cert, Cloudflare IPs only,           │
  Email Routing catch-all                                 │        idle timeout 600s for WebSockets)        │
        │                                                 │      │ host api.*          │ host gateway.*     │
        ▼                                                 │      ▼                     ▼                    │
  Email Worker ── POST /v1/inbound/email?to=… ──────────► │   ECS opendesk-api      ECS opendesk-gateway   │
  (OD-Inbound-Secret)                                     │   (Go, role=api) ×2-6   (Elixir) ×2-4          │
                                                          │      │                     │  Erlang dist,      │
                                                          │      │   ECS opendesk-worker  Presence across  │
                                                          │      │   (Go, role=worker:   nodes (Cloud Map)  │
                                                          │      │    River jobs, outbox relay)             │
                                                          │      │          │          │                    │
                                                          │      ▼          ▼          ▼                    │
                                                          │   NATS JetStream cluster: nats-1/2/3            │
                                                          │   (ECS + Cloud Map, opendesk.internal)          │
                                                          │                                                 │
                                                          │   S3 attachments · SES (DKIM, MAIL FROM)        │
                                                          │   Secrets Manager · KMS · ECR · CloudWatch      │
                                                          └──────────────────────┬──────────────────────────┘
                                                                                 │ TLS, same region
                                                                                 ▼
                                                          Neon Postgres (project "opendesk")
                                                            production branch, no autosuspend
                                                            DATABASE_URL         = -pooler host (requests)
                                                            DATABASE_URL_DIRECT  = direct host (migrations,
                                                                                   River, relay: LISTEN/NOTIFY)
                                                            preview/pr-<n> branches from CI
```

Events: a write commits its row and an `events` outbox row in one transaction;
the worker's relay publishes it to NATS `od.events.<wid>`; every gateway node
subscribes and pushes it to the browsers on `workspace:<wid>`; webhooks go out
from River jobs.

### Why there is no NAT Gateway

Tasks run in **public subnets with a public IP**, and their security groups
admit nothing from the internet: the api and gateway accept only the ALB, NATS
only the app tasks, the worker and migrate tasks nothing at all. The ALB itself
accepts only Cloudflare's published IP ranges.

The alternative, private subnets, needs a path out, and opendesk needs the
internet, not only AWS: Neon, Google and Microsoft OAuth, Gmail and Graph for
mailbox sync, IMAP and SMTP servers, customers' webhook endpoints and PostHog.
VPC interface endpoints (about $7 a month each, per AZ) would cover ECR, Secrets
Manager, SES and CloudWatch but none of those. A NAT Gateway costs about $33 a
month per AZ plus $0.045 per GB, which is most of what the compute costs at this
size, for no reduction in what can reach the tasks. S3 traffic uses the free
gateway endpoint.

Move to private subnets with a NAT Gateway when a customer requires fixed
egress IPs (allow-listed webhook sources or IMAP servers): that is a change to
`modules/network` and the services' `assign_public_ip`.

## First-time cloud setup

Do these once, in order. Values in `<angle brackets>` are yours.

### 1. Accounts and tools

- An AWS account with an admin role for Terraform (SSO recommended), the AWS
  CLI, Terraform >= 1.10, Node 24 and pnpm 12.
- A Cloudflare account with the `opendesk.sh` zone active.
- A Neon account and an API key (Account settings > API keys).
- A GitHub repository `opendesk/opendesk` with an environment named
  `production` (Settings > Environments). Restrict it to the `main` branch and,
  if you like, add required reviewers: every deploy runs in it.

### 2. Cloudflare API token

Create one token (My Profile > API Tokens > Create custom token) used by both
Terraform and CI, scoped to the opendesk.sh zone and the account:

- Zone: DNS Edit, Zone Settings Edit, Zone Edit (for HSTS and security settings),
  Email Routing Rules Edit
- Account: Cloudflare Pages Edit, Workers Scripts Edit, Email Routing Addresses Edit

Note the account id (any zone's overview page, right column).

### 3. Deploy the email worker first

Terraform's catch-all rule points at the worker by name, and Cloudflare refuses
a rule for a worker that does not exist:

```sh
cd deploy/cloudflare/email-worker
pnpm install --frozen-lockfile
export CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id>
pnpm exec wrangler deploy
```

Its `INBOUND_SECRET` is set in step 6, once Terraform has generated it.

### 4. Terraform

Follow `deploy/terraform/README.md`: create the state bucket, copy
`environments/production/terraform.tfvars.example` to `terraform.tfvars`, set
the Cloudflare account id and anything else you change, then:

```sh
cd deploy/terraform/environments/production
terraform init -backend-config="bucket=opendesk-terraform-state-<account id>" -backend-config="region=us-east-1"
terraform apply
```

This creates the VPC, ALB and certificate, ECR, the ECS cluster and services
(their tasks fail until the first deploy pushes images; that is expected), the
NATS cluster, S3, SES, every secret, the Neon project with its production
branch, and the Cloudflare DNS, Pages projects, Email Routing and zone settings.

### 5. SES production access

New SES accounts are in the sandbox: they can only send to verified addresses.
Once Terraform's DKIM and MAIL FROM records have verified (SES console >
Identities > opendesk.sh shows "Verified", usually within minutes):

- SES console > Account dashboard > Request production access.
- Use case: transactional (account verification, password resets, invitations,
  ticket notifications to agents). Say that bounces and complaints are
  suppressed by the account-level suppression list and the configuration set
  Terraform created, and that the expected volume is low.
- Approval usually takes a day. Until then only verified recipients get mail.

Ticket replies to customers go out through each workspace's own mailbox (Gmail,
Microsoft 365 or SMTP), not SES.

### 6. Secrets

Terraform generated `AUTH_SECRET`, `CREDENTIALS_KEY`, `INBOUND_SECRET`,
`NATS_TOKEN`, `SECRET_KEY_BASE` and the two database URLs into Secrets Manager
as `opendesk/production/<KEY>`. **Never regenerate `CREDENTIALS_KEY`**: it
encrypts every stored mailbox credential.

Give the email worker the inbound secret:

```sh
aws secretsmanager get-secret-value --secret-id opendesk/production/INBOUND_SECRET --query SecretString --output text |
  (cd deploy/cloudflare/email-worker && pnpm exec wrangler secret put INBOUND_SECRET)
```

### 7. OAuth apps

Sign-in and mailbox connections each have a callback on the API:

| purpose | redirect URI |
| --- | --- |
| sign in | `https://api.opendesk.sh/v1/auth/oauth/<provider>/callback` |
| connect a mailbox | `https://api.opendesk.sh/v1/mailboxes/oauth/<provider>/callback` |

**Google** (console.cloud.google.com):
1. Create a project, then APIs & Services > OAuth consent screen: External,
   app name opendesk, support email, the authorized domain `opendesk.sh`, links
   to the privacy policy and terms on opendesk.sh.
2. Enable the Gmail API.
3. Credentials > Create OAuth client ID > Web application, with both redirect
   URIs above (provider `google`).
4. Scopes: `openid email profile` for sign-in; mailbox connections request
   `https://mail.google.com/` (IMAP and SMTP over OAuth), which is **restricted**, so
   publishing the app needs Google's verification and an annual CASA Tier 1
   assessment (opendesk's invariants in AGENTS.md exist for it). Until then the
   app works for up to 100 test users you list on the consent screen.

**Microsoft** (entra.microsoft.com > App registrations > New registration):
1. Supported account types: accounts in any organizational directory and
   personal Microsoft accounts (`MICROSOFT_TENANT=common`).
2. Redirect URIs (Web): both URIs above with provider `microsoft`.
3. Certificates & secrets > New client secret. Note its expiry and set a
   reminder: an expired secret breaks sign-in and every connected mailbox.
4. API permissions (delegated): Microsoft Graph `openid`, `email`, `profile`,
   `offline_access`, `User.Read`, `Mail.Send`, and Office 365 Exchange Online
   `IMAP.AccessAsUser.All` (mailbox sync runs over IMAP).
5. Branding & properties: publisher domain `opendesk.sh` (verify it) so users
   see a verified publisher.

**GitHub** (optional, sign-in only): Settings > Developer settings > OAuth Apps,
callback `https://api.opendesk.sh/v1/auth/oauth/github/callback`.

Then store the secrets and switch them on:

```sh
aws secretsmanager put-secret-value --secret-id opendesk/production/GOOGLE_CLIENT_SECRET --secret-string '<secret>'
aws secretsmanager put-secret-value --secret-id opendesk/production/MICROSOFT_CLIENT_SECRET --secret-string '<secret>'
```

The client ids are not secret: set `google_client_id`, `microsoft_client_id`
(and `github_client_id`) in `terraform.tfvars`, add the secret names to
`optional_secrets`, and `terraform apply`. The same goes for `TURNSTILE_SECRET`
(Cloudflare Turnstile, with `turnstile_site_key`) and `POSTHOG_KEY`.

### 8. Stripe billing

Billing exists only on opendesk Cloud and is on when `STRIPE_SECRET_KEY` is set
(`contracts/billing.md`); a self-hosted instance never has it. In the Stripe
dashboard (test mode first, then the same in live mode):

1. **Products and prices.** A "Pro" product with a recurring per-seat price in
   USD, $19 per month (`STRIPE_PRICE_PRO`), optionally a yearly price on the same
   product (`STRIPE_PRICE_PRO_YEARLY`), and an "AI credits" product with a
   one-time price for a pack of 2,000 credits (`STRIPE_PRICE_CREDITS`). Note the
   `price_...` ids. The app reads amounts from Stripe, so changing a price is a
   new price id, never a code change.
2. **Stripe Tax** (optional, `stripe_tax = true` by default): activate it and add
   your registrations, or set `stripe_tax = false`.
3. **Customer portal** (Settings > Billing > Customer portal): allow updating
   payment methods, changing the seat quantity, cancelling at period end, and
   viewing invoices.
4. **Webhook endpoint** (Developers > Webhooks > Add endpoint):
   - URL: `https://api.opendesk.sh/v1/billing/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.paid`, `invoice.payment_failed`
   - Copy the signing secret (`whsec_...`). The API checks every delivery's
     signature with it and records event ids, so Stripe's retries are harmless.
   Cloudflare proxies `api.opendesk.sh`. If the endpoint's delivery log in Stripe
   shows 403s, a Cloudflare challenge is answering instead of the API: add a WAF
   custom rule that skips the security level and Browser Integrity Check for
   the path `/v1/billing/stripe/webhook` (the signature check is the real gate).
   Stripe retries failed deliveries for three days, which covers a deploy.
5. **API key**: a restricted key is enough (write on Checkout Sessions, Customers,
   Customer portal sessions and Subscriptions; read on Prices, Products and
   Invoices). `sk_live_...` or `rk_live_...`.

Store them and switch billing on:

```sh
for k in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PRICE_PRO STRIPE_PRICE_PRO_YEARLY STRIPE_PRICE_CREDITS; do
  printf '%s: ' "$k"; read -r v
  aws secretsmanager put-secret-value --secret-id "opendesk/production/$k" --secret-string "$v"
done
```

then add the five names to `optional_secrets` in `terraform.tfvars`, `terraform
apply`, and run the Deploy workflow (target `backend`) so the api and worker
pick up the new task definitions. Test end to end in test mode with
`stripe listen --forward-to https://api.opendesk.sh/v1/billing/stripe/webhook`
against a staging copy, or with the dashboard's "Send test webhook".

### 9. AI providers

The Cloud runs Anthropic for generation and Voyage for embeddings
(`contracts/ai.md`; models in `ai_model`, `ai_fast_model`, `embeddings_model`).
Create an Anthropic API key (console.anthropic.com, an organization with a
spending limit) and a Voyage key (dash.voyageai.com), then:

```sh
aws secretsmanager put-secret-value --secret-id opendesk/production/ANTHROPIC_API_KEY --secret-string '<key>'
aws secretsmanager put-secret-value --secret-id opendesk/production/VOYAGE_API_KEY --secret-string '<key>'
```

Add `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` to `optional_secrets` and apply.
Each one switches its part on (`AI_PROVIDER=anthropic`,
`EMBEDDINGS_DRIVER=voyage`) only when it is listed, so a task never starts with
a provider and no key. Without Voyage, search falls back to Postgres full-text
search. Neon supports the `vector` extension that semantic search uses.

### 10. GitHub configuration

In the `production` environment, from `terraform output`:

| kind | name | value |
| --- | --- | --- |
| variable | `AWS_REGION` | `us-east-1` |
| variable | `AWS_DEPLOY_ROLE_ARN` | `github_deploy_role_arn` |
| variable | `ECS_MIGRATE_NETWORK` | `migrate_network_configuration` |
| variable | `CLOUDFLARE_ACCOUNT_ID` | your account id |
| variable | `WEB_POSTHOG_KEY`, `WEB_POSTHOG_HOST`, `TURNSTILE_SITE_KEY` | browser-side keys (optional) |
| secret | `CLOUDFLARE_API_TOKEN` | the token from step 2 |

At repository level (CI runs on PRs, outside the environment):

| kind | name | value |
| --- | --- | --- |
| variable | `NEON_PROJECT_ID` | `neon_project_id` |
| secret | `NEON_API_KEY` | a Neon API key |

Branch protection on `main`: require the **CI status** check and "require
branches to be up to date" (the migration duplicate check depends on it).

### 11. First deploy

Run the Deploy workflow (Actions > Deploy > Run workflow, target `all`), or
push to `main`. It builds arm64 images into ECR tagged with the commit SHA, runs
`opendesk migrate` as a one-off task on the direct Neon URL, rolls the api,
worker and gateway services, and deploys the three Pages projects and the email
worker. Check:

```sh
curl -fsS https://api.opendesk.sh/healthz
curl -fsS https://api.opendesk.sh/readyz     # database and NATS connected
```

### 12. First release

Tag `v0.1.0` and push the tag. Release builds multi-arch images to
`ghcr.io/useopendesk/{opendesk,realtime}` (make the packages public in the org's
package settings after the first run), creates the GitHub release with the
installer and the self-host files, and redeploys opendesk.sh so
`/install.sh` is that release's installer.

## How CI and deploys work

- **ci.yml** runs on every PR and push: Go (gofmt, vet, race tests against
  Postgres 17, govulncheck), migrations (no duplicate versions), web
  (typecheck, lint, test, build, pnpm audit), site and docs builds, realtime
  (format, compile with warnings as errors, credo, sobelow, deps.audit, tests),
  both images built and scanned by Trivy (HIGH and CRITICAL with a fix fail
  the build) and then the root compose brought up and checked through Caddy
  (`scripts/selfhost-smoke.sh`), the installer checks, Terraform fmt and
  validate, the email worker's tests, and a Neon branch per PR
  (`preview/pr-<n>`, from production) with the migrations applied twice.
  `neon-cleanup.yml` deletes the branch when the PR closes.
- **deploy.yml** (main): images, migrate, services, Pages, email worker.
  Migrations run before any service moves, so a migration must work with both
  the old and the new code (add, backfill, then remove in a later deploy).
- **release.yml** (tags `v*`): GHCR images with SBOM and provenance,
  attestations, the GitHub release, and the site refresh.
- **security.yml** (weekly): govulncheck, pnpm audit, mix deps.audit and
  sobelow, Trivy on the published images.

Rollback: re-run the Deploy workflow of an earlier commit (Actions > Deploy >
that run > Re-run). Its images are still in ECR (the last 30 are kept), so the
build step is skipped. A migration is not rolled back automatically.

## Self-hosting operations

### Install

```sh
curl -fsSL https://opendesk.sh/install.sh | sh
# or, answering up front (cloud-init, Ansible, agents):
curl -fsSL https://opendesk.sh/install.sh | sh -s -- --domain desk.example.com --email you@example.com --yes
```

Before running it, point the domain's DNS (an A and/or AAAA record) at the
machine and open ports 80 and 443. The installer:

1. checks for Docker, and on Linux offers to install it with Docker's own
   script (downloaded to a file, run with sudo only after you say yes);
2. asks for the domain (and an email for certificate notices) unless given;
3. generates every secret and writes `/opt/opendesk/.env` (mode 0600);
4. pins the newest release in `.env`, downloads that release's
   `docker-compose.yml`, `Caddyfile`, `env.template` and `opendesk-ctl`, and
   checks each against the release's `SHA256SUMS`;
5. pulls the images, starts the stack and waits for the first boot's migrations.

Flags: `--domain`, `--email`, `--dir` (default `/opt/opendesk`), `--version`,
`--no-start`, `--wizard` (also asks about SMTP, attachment storage, inbound
mail, AI and sign-ups), `--ai-key`, `--ai-url`, `--ai-model`, `--ollama`,
`--no-ai`, `--yes`, `--dry-run`, `--help`. Each has an `OPENDESK_*`
variable. Running it again keeps every secret and every setting you changed in
`.env`; it only moves the version pin when you pass `--version`.

To verify it before running it:

```sh
curl -fsSLO https://opendesk.sh/install.sh
curl -fsSLO https://opendesk.sh/install.sh.sha256
sha256sum -c install.sh.sha256
less install.sh && sh install.sh
```

After installing, sign up at your domain: the first account owns the
workspace. Then set `SIGNUP_ENABLED=false` in `.env` if the instance is
private, and `docker compose up -d`.

What runs:

| service | what | exposed |
| --- | --- | --- |
| caddy | automatic HTTPS; `/socket*` to realtime, the rest to opendesk | 80, 443 (and 443/udp for HTTP/3) |
| opendesk | API, workers, web app, embedded NATS on the internal network (token required) | internal only |
| realtime | the gateway, joined to opendesk's NATS | internal only |
| postgres | Postgres 17 with pgvector (semantic search), volume `postgres-data` | internal only |
| s3 (profile `minio`) | S3-compatible attachment storage | internal only |
| smtp-inbound (profile `smtp-inbound`) | publishes the built-in SMTP receiver | 25 |
| ollama, ollama-init (profile `ollama`) | local models for the AI features | internal only |

Everything is configured in `/opt/opendesk/.env`; `env.template` (the same as
`deploy/self-host/.env.template`) documents each setting. After editing it:
`cd /opt/opendesk && docker compose up -d`.

### Day two with opendesk-ctl

```sh
cd /opt/opendesk
./opendesk-ctl status                  # containers, health, version
./opendesk-ctl logs                    # all services; or: logs opendesk | realtime | postgres | caddy
./opendesk-ctl backup                  # into ./backups/<UTC time>/
./opendesk-ctl backup /mnt/backups     # or anywhere else
./opendesk-ctl restore backups/20261011T090000Z
./opendesk-ctl upgrade                 # back up, then move to the newest release
./opendesk-ctl upgrade v1.4.2          # or a specific one
```

The same, by hand:

**Back up.** Three things, all needed for a restore:

```sh
cd /opt/opendesk
docker compose exec -T postgres pg_dump -U opendesk -d opendesk -Fc > db.dump
docker cp "$(docker compose ps -q opendesk)":/data - | gzip > data.tar.gz   # attachments, NATS store
cp .env env                                                                 # CREDENTIALS_KEY lives here
```

A database dump without the `.env` it was taken with restores an instance
whose mailbox credentials cannot be decrypted. Keep backups off the machine,
and private: the `.env` copy holds every secret. To schedule it, a root crontab
line such as `17 3 * * * /opt/opendesk/opendesk-ctl backup /var/backups/opendesk`
works, plus whatever prunes old directories there.

**Restore.**

```sh
cd /opt/opendesk
cp <backup>/env .env                          # if this is a new machine
docker compose up -d postgres --wait
docker compose stop opendesk realtime caddy
docker compose exec -T postgres pg_restore -U opendesk -d opendesk --clean --if-exists --no-owner --single-transaction < <backup>/db.dump
gunzip -c <backup>/data.tar.gz | docker run --rm -i --volumes-from "$(docker compose ps -aq opendesk)" alpine:3.22 \
  sh -c 'find /data -mindepth 1 -delete && tar -xf - -C / && chown -R 65532:65532 /data'
docker compose up -d
```

**Upgrade.** Migrations run when opendesk boots, so an upgrade is a new pin,
a pull and a restart. `opendesk-ctl upgrade` takes a backup first, then runs the
target release's installer (checked against its published checksum), which
also brings that release's `docker-compose.yml` and `Caddyfile`. By hand:

```sh
cd /opt/opendesk
sed -i 's/^OPENDESK_VERSION=.*/OPENDESK_VERSION=v1.4.2/' .env
docker compose pull && docker compose up -d
```

Releases do not skip migrations, so upgrading across several versions at once
is fine. Downgrading is not supported once a newer version's migrations ran;
restore the backup taken before the upgrade instead.

**Logs.** `docker compose logs -f --tail=200 opendesk`. Container logs rotate
at 10 MB, five files per service. Request logs never contain query strings,
tokens or bodies, and Caddy's access log drops `?token=`, `Authorization` and
`Cookie`.

### Options

**Platform email.** Out of the box, verification and reset emails are printed
to `docker compose logs opendesk`. For real delivery set `MAIL_DRIVER=smtp` and
the `SMTP_*` values in `.env` (any provider: Postmark, SES SMTP, Mailgun, your
own server) and `MAIL_FROM`.

**Attachments on S3.** AWS S3 or Cloudflare R2: `STORAGE_DRIVER=s3`,
`S3_BUCKET`, `S3_REGION` (`auto` for R2), `S3_ENDPOINT` (R2:
`https://<account>.r2.cloudflarestorage.com`), and the two keys. On the same
machine, the `minio` profile runs an S3-compatible store (RustFS; MinIO no
longer publishes images):

```sh
# .env
COMPOSE_PROFILES=minio
STORAGE_DRIVER=s3
S3_ENDPOINT=https://files.desk.example.com
S3_FORCE_PATH_STYLE=true
S3_BUCKET=opendesk
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=opendesk
S3_SECRET_ACCESS_KEY=<openssl rand -hex 24>
```

Downloads are presigned URLs that browsers open directly, so the endpoint must
be reachable from outside: add a site to the Caddyfile and point
`files.desk.example.com` at the machine.

```
files.desk.example.com {
	reverse_proxy s3:9000
}
```

(`S3_ENDPOINT=http://s3:9000` works for a machine only you use on a LAN.)

**Receiving mail directly.** Forwarding addresses are `<token>@INBOUND_DOMAIN`.
To receive them on this machine: an MX record for `INBOUND_DOMAIN` pointing at
it, port 25 open (many VPS providers block it until asked),
`INBOUND_SMTP_ADDR=:2525` and `smtp-inbound` in `COMPOSE_PROFILES`. Or keep
port 25 closed and have any relay that can POST raw messages (the Cloudflare
worker in `deploy/cloudflare/email-worker` works for a domain on Cloudflare)
deliver to `https://<domain>/v1/inbound/email?to=<rcpt>` with the
`OD-Inbound-Secret` header set to `INBOUND_SECRET`.

**AI.** Optional, and off without a provider. Self-hosted instances have no
plans, limits or credits; nothing about Stripe applies. Three ways:

- **Anthropic:** `OPENDESK_AI_KEY=sk-ant-... sh install.sh`, or in `.env`
  `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. Pass keys as variables rather
  than `--ai-key`, so they stay out of shell history.
- **Any OpenAI-compatible endpoint** (OpenAI, Azure OpenAI, vLLM, LM Studio, an
  Ollama you already run): `--ai-url http://10.0.0.5:11434/v1 --ai-model <name>`,
  or `AI_PROVIDER=openai`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `AI_MODEL`.
- **Fully local, in this stack:** `--ollama` (or `ollama` in `COMPOSE_PROFILES`
  with the settings the template lists). `ollama-init` pulls `AI_MODEL`
  (default `llama3.1:8b`, about 5 GB) and `nomic-embed-text` for semantic search
  into the `ollama-data` volume on first start; follow it with
  `docker compose logs -f ollama-init`. An 8B model wants 8 GB of free RAM and
  answers slowly on CPU; for a GPU, install the NVIDIA container toolkit and
  add to the `ollama` service in a `docker-compose.override.yml`:

  ```yaml
  services:
    ollama:
      deploy:
        resources:
          reservations:
            devices: [{ driver: nvidia, count: all, capabilities: [gpu] }]
  ```

Semantic search uses pgvector, which the bundled `pgvector/pgvector:pg17`
image has. With an external Postgres without the extension, search falls back
to full-text search.

**Behind another proxy.** Set `OPENDESK_DOMAIN=:80`, `HTTP_PORT` to a free
port, and `OPENDESK_URL` / `OPENDESK_GATEWAY_URL` to the public https / wss
URLs; the outer proxy terminates TLS and must pass WebSocket upgrades on
`/socket`.

### Troubleshooting

- **No certificate.** `docker compose logs caddy`. DNS must resolve to this
  machine and ports 80 and 443 must be reachable from the internet; an ACME
  rate limit clears within an hour.
- **opendesk restarts at boot.** `docker compose logs opendesk`: it refuses to
  start without `AUTH_SECRET` (>= 32 bytes), `CREDENTIALS_KEY` or `NATS_TOKEN`,
  rather than starting with weak ones.
- **"password authentication failed" on a reinstall.** The `postgres-data`
  volume keeps the password of the install that created it; put that install's
  `.env` back. The installer stops before writing anything when it finds such a
  volume without a `.env`.
- **Realtime updates do not arrive.** `docker compose logs realtime` should
  say `NATS connected to opendesk:4222`; `CHECK_ORIGINS` must contain the URL
  people open (it defaults to `OPENDESK_URL`).

### Try it from a checkout

```sh
make selfhost-env               # .env with fresh secrets for https://localhost
docker compose up -d --build    # builds both images from this checkout
open https://localhost          # Caddy's local CA; the browser asks once
make selfhost-smoke             # the CI check: throwaway project, checks through Caddy, torn down
```

## Cost notes (hosted, us-east-1, monthly, before traffic)

| item | sizing | about |
| --- | --- | --- |
| Fargate ARM64, api ×2, worker ×1, gateway ×2 | 0.5 vCPU, 1 GB each | $72 |
| Fargate ARM64, NATS ×3 | 0.25 vCPU, 0.5 GB, 30 GB ephemeral each | $25 |
| Public IPv4 addresses | ~8 tasks + the ALB's 2 | $36 |
| Application Load Balancer | 1, low LCU | $20 |
| Neon | production branch at 0.5 CU always on, scales to 4 | $40 to $60, plus storage |
| Secrets Manager | ~13 secrets | $5 |
| KMS, CloudWatch Logs (30-day retention), ECR | | $5 to $10 |
| S3 attachments, SES | $0.023 per GB stored; $0.10 per 1,000 emails | usage |
| Anthropic, Voyage | per token; bounded by plan credits (`contracts/billing.md`) | usage |
| Stripe | per charge, plus Billing and Tax fees (see Stripe's pricing page) | usage |
| Cloudflare Pages, Email Routing, DNS, proxy | free plan; Workers free tier covers the email worker | $0 |
| **Total** | | **about $200 to $230** |

Where it goes from there:

- **Autoscaling** adds api tasks at $14 a month each; the gateway scales on CPU
  too. One gateway task holds tens of thousands of idle sockets.
- **NATS** on Synadia Cloud (`nats_mode = "external"`) removes the three tasks
  and their IPs. That needs NATS credentials-file support in the Go client,
  which takes only a token today.
- **Fargate Spot** for the worker cuts its cost by about 70%; River retries
  interrupted jobs.
- A NAT Gateway, if fixed egress IPs are ever required, adds about $33 per AZ
  plus $0.045 per GB, and removes most of the IPv4 charge.
- Compute Savings Plans take about 20% to 50% off Fargate once the size is stable.

Self-hosting needs one machine with 2 vCPU and 4 GB of RAM (about $10 to $25 a
month at most providers) for a team of dozens; Postgres is the part that grows.
