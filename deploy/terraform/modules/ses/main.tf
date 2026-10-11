# SES for platform email (verification, password resets, invites, ticket
# notifications) from the apex domain, with Easy DKIM, a custom MAIL FROM
# subdomain so SPF aligns for DMARC, and a configuration set that tracks
# reputation and suppresses addresses that bounce or complain.
#
# New SES accounts start in the sandbox; request production access by hand
# (deploy/README.md). The DNS records live in Cloudflare and are never proxied.

data "aws_region" "current" {}

locals {
  mail_from = "${var.mail_from_subdomain}.${var.domain}"
}

resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = var.name

  delivery_options {
    tls_policy = "REQUIRE"
  }

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

resource "aws_sesv2_email_identity" "this" {
  email_identity         = var.domain
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_sesv2_email_identity_mail_from_attributes" "this" {
  email_identity         = aws_sesv2_email_identity.this.email_identity
  mail_from_domain       = local.mail_from
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

# Easy DKIM always issues three tokens.
resource "cloudflare_dns_record" "dkim" {
  count = 3

  zone_id = var.cloudflare_zone_id
  name    = "${aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  content = "${aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"
  ttl     = 3600
  proxied = false
  comment = "SES Easy DKIM"
}

resource "cloudflare_dns_record" "mail_from_mx" {
  zone_id  = var.cloudflare_zone_id
  name     = local.mail_from
  type     = "MX"
  content  = "feedback-smtp.${data.aws_region.current.region}.amazonses.com"
  priority = 10
  ttl      = 3600
  comment  = "SES custom MAIL FROM"
}

resource "cloudflare_dns_record" "mail_from_spf" {
  zone_id = var.cloudflare_zone_id
  name    = local.mail_from
  type    = "TXT"
  content = "\"v=spf1 include:amazonses.com -all\""
  ttl     = 3600
  comment = "SES custom MAIL FROM"
}

resource "cloudflare_dns_record" "dmarc" {
  count = var.manage_dmarc ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  content = "\"${join("; ", compact(["v=DMARC1", "p=${var.dmarc_policy}", var.dmarc_rua == "" ? "" : "rua=mailto:${var.dmarc_rua}", "adkim=s", "aspf=r"]))}\""
  ttl     = 3600
  comment = "DMARC"
}
