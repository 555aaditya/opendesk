output "project_id" {
  value = neon_project.this.id
}

output "branch_id" {
  value = neon_project.this.default_branch_id
}

output "endpoint_id" {
  value = neon_project.this.default_endpoint_id
}

output "database_url" {
  description = "Pooled connection string."
  value       = local.pooled
  sensitive   = true
}

output "database_url_direct" {
  description = "Direct connection string."
  value       = local.direct
  sensitive   = true
}
