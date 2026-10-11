output "pages_projects" {
  description = "key => Pages project name."
  value       = { for k, p in cloudflare_pages_project.this : k => p.name }
}

output "pages_subdomains" {
  value = { for k, p in cloudflare_pages_project.this : k => p.subdomain }
}
