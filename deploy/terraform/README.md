# opendesk Terraform

Everything the hosted service runs on: AWS (ECS Fargate, ALB, S3, SES, Secrets
Manager, KMS, ECR, Cloud Map), Cloudflare (DNS, Pages, Email Routing, zone
security) and Neon (Postgres). The architecture and the full first-time runbook
are in [`deploy/README.md`](../README.md); this file is the Terraform-specific part.

## Layout

```
environments/production/   the root: wiring, variables, outputs, backend
modules/
  network/       VPC, public subnets, IGW, S3 gateway endpoint (no NAT Gateway)
  alb/           one ALB for api + gateway, ACM cert validated through Cloudflare
  ecs-service/   a Fargate task definition (+ service, roles, logs, autoscaling)
  nats/          three-node JetStream cluster on ECS, or an external NATS
  s3/            private attachments bucket
  ses/           domain identity, DKIM, MAIL FROM, DMARC, configuration set
  secrets/       Secrets Manager entries, generated and operator-supplied
  neon/          project, production branch (no autosuspend), connection strings
  cloudflare/    DNS, Pages projects and domains, Email Routing, zone settings
  github-oidc/   the role deploy.yml assumes (no long-lived AWS keys)
```

Names other tooling depends on: cluster `opendesk-production`; services and task
families `opendesk-api`, `opendesk-worker`, `opendesk-gateway`,
`opendesk-nats-{1,2,3}`; one-off family `opendesk-migrate`; ECR repositories
`opendesk/opendesk` and `opendesk/realtime`; secrets `opendesk/production/<KEY>`;
Pages projects `opendesk-site`, `opendesk-docs`, `opendesk-app`; Email Worker
`opendesk-inbound-email`.

## Credentials

Terraform reads them from the environment only:

```sh
export AWS_PROFILE=opendesk-admin        # or an SSO session
export CLOUDFLARE_API_TOKEN=...          # Zone: DNS, Zone Settings, Email Routing; Account: Pages, Email Routing
export NEON_API_KEY=...
```

## Bootstrap order

1. **State bucket** (once, by hand):

   ```sh
   ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
   aws s3api create-bucket --bucket opendesk-terraform-state-$ACCOUNT --region us-east-1
   aws s3api put-bucket-versioning --bucket opendesk-terraform-state-$ACCOUNT \
     --versioning-configuration Status=Enabled
   aws s3api put-public-access-block --bucket opendesk-terraform-state-$ACCOUNT \
     --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
   ```

2. **Deploy the Email Worker once** (`cd deploy/cloudflare/email-worker && npx wrangler deploy`).
   The catch-all rule points at it by name. If you skip this, the first apply
   fails on the catch-all; deploy the worker and apply again.

3. **Apply:**

   ```sh
   cd deploy/terraform/environments/production
   cp terraform.tfvars.example terraform.tfvars   # fill in
   terraform init -backend-config="bucket=opendesk-terraform-state-$ACCOUNT" -backend-config="region=us-east-1"
   terraform apply
   ```

   The services are created with the `bootstrap` image tag, which does not exist
   yet, so their tasks fail until step 5. That is expected.

4. **Operator secrets.** For each of `GOOGLE_CLIENT_SECRET`,
   `MICROSOFT_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`, `TURNSTILE_SECRET`,
   `POSTHOG_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`,
   `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_CREDITS`, `ANTHROPIC_API_KEY` and
   `VOYAGE_API_KEY` you use:

   ```sh
   aws secretsmanager put-secret-value --secret-id opendesk/production/GOOGLE_CLIENT_SECRET --secret-string '...'
   ```

   then add the key to `optional_secrets` in `terraform.tfvars` and apply again.
   They are opt-in because a task that references a secret with no value does
   not start.

5. **GitHub configuration** from the outputs (`terraform output`):
   `AWS_DEPLOY_ROLE_ARN` = `github_deploy_role_arn`, `ECS_MIGRATE_NETWORK` =
   `migrate_network_configuration`, `NEON_PROJECT_ID` = `neon_project_id`. Then
   run the deploy workflow: it pushes images, runs `opendesk-migrate` and updates
   the services.

## Day two

- **Deploys never go through Terraform.** `deploy.yml` registers a new revision
  of each family from the latest one, with only the image changed. The services
  ignore `task_definition` and `desired_count`, so `terraform apply` after a
  deploy changes neither. An apply that changes a task definition (new env or
  secret) registers a new revision, which the next deploy builds on.
- **Images are immutable and tagged by commit SHA.** The repositories keep the
  last 30.
- **Secrets never rotate on their own.** A new `CREDENTIALS_KEY` makes every
  stored mailbox credential unreadable; never taint `random_id.credentials_key`.
- **NATS as a service:** `nats_mode = "external"` and `external_nats_url` remove
  the three NATS services; put the provider's token in
  `opendesk/production/NATS_TOKEN`.
- **R2 instead of S3:** see the header of `modules/s3/main.tf`.

## Checks

```sh
terraform fmt -check -recursive deploy/terraform
for d in deploy/terraform/environments/* deploy/terraform/modules/*; do
  (cd "$d" && terraform init -backend=false -input=false >/dev/null && terraform validate)
done
```
