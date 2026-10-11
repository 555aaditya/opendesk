output "url" {
  description = "NATS_URL for clients: a comma-separated list of every node."
  value       = local.url
}

output "security_group_id" {
  value = aws_security_group.nats.id
}

output "service_names" {
  value = [for n in module.node : n.service_name]
}

output "task_role_arns" {
  value = [for n in module.node : n.task_role_arn]
}

output "execution_role_arns" {
  value = [for n in module.node : n.execution_role_arn]
}
