variable "name" {
  description = "Configuration set name."
  type        = string
}

variable "domain" {
  description = "Sending domain, e.g. opendesk.sh."
  type        = string
}

variable "mail_from_subdomain" {
  type    = string
  default = "mail"
}

variable "cloudflare_zone_id" {
  type = string
}

variable "manage_dmarc" {
  description = "Create the _dmarc record (turn off if the zone already has one)."
  type        = bool
  default     = true
}

variable "dmarc_policy" {
  type    = string
  default = "quarantine"

  validation {
    condition     = contains(["none", "quarantine", "reject"], var.dmarc_policy)
    error_message = "dmarc_policy must be none, quarantine or reject."
  }
}

variable "dmarc_rua" {
  description = "Optional address for aggregate DMARC reports."
  type        = string
  default     = ""
}
