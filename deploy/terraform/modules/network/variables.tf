variable "name" {
  description = "Name prefix, e.g. opendesk-production."
  type        = string
}

variable "region" {
  description = "AWS region, used for the S3 gateway endpoint service name."
  type        = string
}

variable "cidr" {
  description = "VPC CIDR block."
  type        = string
  default     = "10.40.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones (and public subnets)."
  type        = number
  default     = 3

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 6
    error_message = "An ALB needs at least two availability zones."
  }
}
