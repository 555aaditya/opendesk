# Neon Postgres in the same AWS region as ECS (aws-us-east-1 by default), so
# every query stays in-region.
#
# The default branch is "production" with autosuspend disabled: a suspended
# compute adds a cold start to the first request and drops River's and the
# relay's LISTEN sessions. CI creates a short-lived branch per pull request
# from this one (neondatabase/create-branch-action).
#
# DATABASE_URL is the pooled (-pooler, PgBouncer transaction mode) host for
# request handlers; DATABASE_URL_DIRECT is the direct host for migrations,
# River and the event relay, which need session features (LISTEN/NOTIFY).
# Both use sslmode=verify-full: Neon presents a publicly trusted certificate.

resource "neon_project" "this" {
  name                      = var.name
  org_id                    = var.org_id
  region_id                 = var.region
  pg_version                = var.pg_version
  history_retention_seconds = var.history_retention_seconds
  default_branch_protected  = var.protect_branch

  branch {
    name          = "production"
    database_name = var.database_name
    role_name     = var.role_name
  }

  primary_compute {
    autoscaling_limit_min_cu = var.min_cu
    autoscaling_limit_max_cu = var.max_cu
    suspend_timeout_seconds  = -1 # never suspend
  }

  # Applies to computes created later (for example on PR branches): those may suspend.
  suspend_timeout_seconds = var.branch_suspend_timeout_seconds
}

locals {
  ssl    = "sslmode=verify-full"
  direct = "${split("?", neon_project.this.connection_uri)[0]}?${local.ssl}"
  pooled = "${split("?", neon_project.this.connection_uri_pooler)[0]}?${local.ssl}"
}
