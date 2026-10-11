variable "name" {
  type = string
}

variable "org_id" {
  description = "Neon organization id (required for accounts created after orgs were introduced)."
  type        = string
  default     = null
}

variable "region" {
  description = "Neon region; keep it in the ECS region."
  type        = string
  default     = "aws-us-east-1"
}

variable "pg_version" {
  type    = number
  default = 17
}

variable "database_name" {
  type    = string
  default = "opendesk"
}

variable "role_name" {
  type    = string
  default = "opendesk"
}

variable "min_cu" {
  type    = number
  default = 0.5
}

variable "max_cu" {
  type    = number
  default = 4
}

variable "history_retention_seconds" {
  description = "Point-in-time restore window."
  type        = number
  default     = 604800
}

variable "protect_branch" {
  description = "Protect the production branch (paid plans)."
  type        = bool
  default     = true
}

variable "branch_suspend_timeout_seconds" {
  description = "Autosuspend for computes on other branches (PR previews)."
  type        = number
  default     = 300
}
