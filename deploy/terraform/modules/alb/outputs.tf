output "alb_arn" {
  value = aws_lb.this.arn
}

output "dns_name" {
  value = aws_lb.this.dns_name
}

output "security_group_id" {
  value = aws_security_group.alb.id
}

output "api_target_group_arn" {
  value = aws_lb_target_group.api.arn
}

output "gateway_target_group_arn" {
  value = aws_lb_target_group.gateway.arn
}

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}

output "certificate_arn" {
  value = aws_acm_certificate_validation.this.certificate_arn
}
