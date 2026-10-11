output "identity" {
  value = aws_sesv2_email_identity.this.email_identity
}

output "identity_arn" {
  value = aws_sesv2_email_identity.this.arn
}

output "configuration_set_name" {
  value = aws_sesv2_configuration_set.this.configuration_set_name
}

output "configuration_set_arn" {
  value = aws_sesv2_configuration_set.this.arn
}
