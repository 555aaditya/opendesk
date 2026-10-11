variable "name" {
  description = "Name prefix for every resource."
  type        = string
  default     = "opendesk"
}

variable "aws_region" {
  description = "AWS region. Keep Neon in the same one (neon_region)."
  type        = string
  default     = "us-east-1"
}

variable "neon_region" {
  type    = string
  default = "aws-us-east-1"
}

variable "neon_org_id" {
  type    = string
  default = null
}

variable "neon_min_cu" {
  type    = number
  default = 0.5
}

variable "neon_max_cu" {
  type    = number
  default = 4
}

# ── Domains ───────────────────────────────────────────────────────────────

variable "domain" {
  description = "Apex domain: the marketing site, and the platform mail sender."
  type        = string
  default     = "opendesk.sh"
}

variable "subdomains" {
  description = "Hostname labels under the apex."
  type = object({
    app     = optional(string, "app")
    docs    = optional(string, "docs")
    api     = optional(string, "api")
    gateway = optional(string, "gateway")
    inbound = optional(string, "in")
    mail    = optional(string, "mail")
  })
  default = {}
}

variable "cloudflare_account_id" {
  type = string
}

variable "cloudflare_zone_name" {
  description = "Zone that holds every hostname."
  type        = string
  default     = "opendesk.sh"
}

variable "cloudflare_zone_id" {
  description = "Set to skip the zone lookup by name."
  type        = string
  default     = null
}

variable "manage_zone_settings" {
  type    = bool
  default = true
}

variable "restrict_alb_to_cloudflare" {
  type    = bool
  default = true
}

variable "dmarc_rua" {
  type    = string
  default = ""
}

# ── Deploys ───────────────────────────────────────────────────────────────

variable "github_repo" {
  type    = string
  default = "opendesk/opendesk"
}

variable "create_github_oidc_provider" {
  type    = bool
  default = true
}

variable "existing_github_oidc_provider_arn" {
  type    = string
  default = null
}

variable "image_tag" {
  description = "Tag for the initial task definitions. deploy.yml registers later revisions."
  type        = string
  default     = "bootstrap"
}

variable "cpu_architecture" {
  description = "ARM64 or X86_64; deploy.yml must build images for it."
  type        = string
  default     = "ARM64"
}

variable "enable_execute_command" {
  type    = bool
  default = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# ── Sizes ─────────────────────────────────────────────────────────────────

variable "api" {
  type = object({
    cpu    = optional(number, 512)
    memory = optional(number, 1024)
    min    = optional(number, 2)
    max    = optional(number, 6)
  })
  default = {}
}

variable "worker" {
  type = object({
    cpu    = optional(number, 512)
    memory = optional(number, 1024)
    min    = optional(number, 1)
    max    = optional(number, 2)
  })
  default = {}
}

variable "gateway" {
  type = object({
    cpu    = optional(number, 512)
    memory = optional(number, 1024)
    min    = optional(number, 2)
    max    = optional(number, 4)
  })
  default = {}
}

variable "alb_idle_timeout" {
  type    = number
  default = 600
}

variable "alb_deletion_protection" {
  type    = bool
  default = true
}

# ── NATS ──────────────────────────────────────────────────────────────────

variable "nats_mode" {
  description = "cluster = three JetStream nodes on ECS; external = external_nats_url (e.g. Synadia Cloud)."
  type        = string
  default     = "cluster"
}

variable "external_nats_url" {
  type    = string
  default = ""
}

variable "nats_image" {
  type    = string
  default = "nats:2.15-alpine"
}

# ── Application settings (non-secret) ─────────────────────────────────────

variable "posthog_host" {
  type    = string
  default = "https://us.i.posthog.com"
}

variable "google_client_id" {
  type    = string
  default = ""
}

variable "microsoft_client_id" {
  type    = string
  default = ""
}

variable "microsoft_tenant" {
  type    = string
  default = "common"
}

variable "github_client_id" {
  type    = string
  default = ""
}

variable "turnstile_site_key" {
  type    = string
  default = ""
}

variable "optional_secrets" {
  description = <<-EOT
    Operator-supplied secrets the tasks should reference, once they have a value
    (GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_SECRET, GITHUB_CLIENT_SECRET,
    TURNSTILE_SECRET, POSTHOG_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_PRO, STRIPE_PRICE_PRO_YEARLY, STRIPE_PRICE_CREDITS,
    ANTHROPIC_API_KEY, VOYAGE_API_KEY). See modules/secrets.
  EOT
  type        = set(string)
  default     = []

  validation {
    condition = alltrue([for s in var.optional_secrets : contains([
      "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_SECRET", "GITHUB_CLIENT_SECRET", "TURNSTILE_SECRET", "POSTHOG_KEY",
      "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO", "STRIPE_PRICE_PRO_YEARLY", "STRIPE_PRICE_CREDITS",
      "ANTHROPIC_API_KEY", "VOYAGE_API_KEY",
    ], s)])
    error_message = "optional_secrets may only list the operator-supplied secrets."
  }
}

# AI (contracts/ai.md). The provider is switched on only once its key is in
# optional_secrets, so a task never starts with a provider and no key.
variable "ai_model" {
  description = "AI_MODEL for the anthropic provider."
  type        = string
  default     = "claude-sonnet-5-5"
}

variable "ai_fast_model" {
  description = "AI_FAST_MODEL for the anthropic provider."
  type        = string
  default     = "claude-haiku-4-5-20251001"
}

variable "embeddings_model" {
  description = "EMBEDDINGS_MODEL for the voyage driver; empty uses the app's default."
  type        = string
  default     = ""
}

# Billing (contracts/billing.md). On when STRIPE_SECRET_KEY is in optional_secrets.
variable "stripe_tax" {
  description = "STRIPE_TAX: let Stripe Tax compute tax at checkout."
  type        = bool
  default     = true
}
