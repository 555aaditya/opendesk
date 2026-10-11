variable "bucket_name" {
  type = string
}

variable "kms_key_arn" {
  type = string
}

variable "cors_origins" {
  description = "Origins allowed to use presigned URLs, e.g. https://app.opendesk.sh."
  type        = list(string)
}

variable "noncurrent_days" {
  type    = number
  default = 30
}
