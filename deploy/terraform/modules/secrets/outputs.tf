output "arns" {
  description = "Secret key => ARN (never the values)."
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}

output "generated_keys" {
  value = ["AUTH_SECRET", "CREDENTIALS_KEY", "INBOUND_SECRET", "NATS_TOKEN", "SECRET_KEY_BASE"]
}

output "manual_keys" {
  value = local.manual
}
