# Credentials come from the environment, never from files in the repo:
#   AWS:        the usual AWS_PROFILE / SSO session
#   Cloudflare: CLOUDFLARE_API_TOKEN (Zone DNS, Zone Settings, Email Routing,
#               Pages, Account read)
#   Neon:       NEON_API_KEY

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.name
      Environment = local.env
      ManagedBy   = "terraform"
    }
  }
}

provider "cloudflare" {}

provider "neon" {}
