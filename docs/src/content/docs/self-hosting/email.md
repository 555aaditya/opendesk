---
title: Email setup
description: Inbound forwarding, outbound replies and platform email on a self-hosted opendesk.
---

opendesk handles three kinds of email, each configured separately.

| Kind | What | Configured by |
| --- | --- | --- |
| Inbound, mailbox connections | IMAP, Google and Microsoft mailboxes are read directly | each mailbox (nothing to set on the server, except [OAuth apps](/self-hosting/oauth-apps/)) |
| Inbound, forwarding | Mail forwarded to `<token>@INBOUND_DOMAIN` | `INBOUND_DOMAIN`, plus a receiver below |
| Outbound replies | Replies to customers | each mailbox: SMTP, Google or Microsoft |
| Platform email | Verification, password reset, invitations | `MAIL_DRIVER` and friends |

## Inbound forwarding

Forwarding mailboxes get an address `<token>@INBOUND_DOMAIN`. Choose a domain you control, such as `in.desk.example.com`, and set:

```sh
INBOUND_DOMAIN=in.desk.example.com
```

Then pick one way to receive that mail.

### Option A: Cloudflare Email Worker

If the domain is on Cloudflare, Email Routing can receive mail and hand it to a worker that posts it to opendesk. This is how the hosted service works, and it needs no open port 25.

1. Set `INBOUND_SECRET` to a long random value (`openssl rand -hex 24`).
2. In Cloudflare, enable **Email Routing** for the inbound domain. Cloudflare adds the MX records.
3. Deploy the worker in `deploy/cloudflare/email-worker` with `wrangler`, setting its `INBOUND_SECRET` secret to the same value and its `INBOUND_URL` variable to `https://desk.example.com/v1/inbound/email`.
4. Add a **catch-all** routing rule that sends every address to the worker.

The worker posts each raw message to `POST /v1/inbound/email?to=<recipient>` with the `OD-Inbound-Secret` header. It retries briefly on network errors and `5xx`; if the API stays unreachable, Email Routing treats it as a temporary failure and the sending server retries later, so mail is not lost. Unknown addresses and oversized messages bounce with a short reason.

### Option B: the built-in SMTP receiver

opendesk can receive mail itself:

1. Set `INBOUND_SMTP_ADDR=:25` (or another port with a port forward from 25).
2. Open port 25 to the server. Many cloud providers block it by default; check yours.
3. Add an `MX` record for the inbound domain pointing at the server:

   ```
   in.desk.example.com.  MX  10  desk.example.com.
   ```

The installer's `--wizard` can set this up.

### Option C: your own pipeline

Anything that can make an HTTPS request can deliver mail: post the raw RFC 822 message to `/v1/inbound/email?to=<recipient>` with `OD-Inbound-Secret`. See [Mailboxes API](/api/resources/mailboxes/#inbound-email).

Redelivery is safe: each raw message is stored once per mailbox, keyed by its `Message-ID`.

## Outbound replies

Replies to customers go out **through the customer's own mailbox**: SMTP, Gmail or Microsoft, as set on each mailbox. This keeps replies in the mailbox's Sent folder, authenticated by the domain's own SPF, DKIM and DMARC, and from the address the customer wrote to. opendesk does not need to be a trusted sender for your customers' domains.

Failed sends are retried, up to 8 attempts, and the message shows its delivery status in the ticket.

The `system` outbound option sends replies through platform email instead. Use it only when a mailbox cannot send for itself.

## Platform email

Verification, password reset and invitation emails come from `MAIL_FROM` through `MAIL_DRIVER`:

| Driver | Use |
| --- | --- |
| `log` | Default. Prints emails to the opendesk log. Fine for trying it out; read reset links with `opendesk-ctl logs opendesk`. |
| `smtp` | Any SMTP provider: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_TLS`. |
| `ses` | Amazon SES in `SES_REGION`, with AWS credentials from the standard environment (variables, profile or instance role). |

```sh
MAIL_DRIVER=smtp
MAIL_FROM=opendesk <notifications@desk.example.com>
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_TLS=starttls
```

Set up SPF and DKIM for the `MAIL_FROM` domain with your provider so these emails reach inboxes.
