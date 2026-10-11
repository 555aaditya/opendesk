variable "github_repo" {
  description = "owner/name of the repository allowed to deploy."
  type        = string
}

variable "role_name" {
  type    = string
  default = "opendesk-github-deploy"
}

variable "create_oidc_provider" {
  description = "false when the account already has the GitHub OIDC provider."
  type        = bool
  default     = true
}

variable "existing_oidc_provider_arn" {
  type    = string
  default = null
}

variable "cluster_name" {
  type = string
}

variable "service_names" {
  type = list(string)
}

variable "migrate_family" {
  type = string
}

variable "migrate_log_group_arn" {
  type = string
}

variable "ecr_repository_arns" {
  type = list(string)
}

variable "pass_role_arns" {
  description = "Task and execution roles the new task definition revisions reference."
  type        = list(string)
}
