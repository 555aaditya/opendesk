---
title: IMAP and SMTP
description: Connect any mailbox to opendesk with an IMAP server for incoming mail and SMTP for replies.
---

Use IMAP and SMTP for providers without a one-click connection, such as Fastmail, Zoho, iCloud, a hosting provider or your own mail server.

## Create the mailbox

In **Settings → Mailboxes**, add a mailbox and choose **IMAP** for inbound and **SMTP** for outbound. You need:

| Field | Example |
| --- | --- |
| IMAP host | `imap.example.com` |
| IMAP port | `993` |
| IMAP security | `tls` (port 993), `starttls` (port 143) or `none` |
| IMAP username and password | usually your full address and an app password |
| SMTP host | `smtp.example.com` |
| SMTP port | `465` or `587` |
| SMTP security | `tls` (port 465), `starttls` (port 587) or `none` |
| SMTP username and password | often the same as IMAP |

Click **Test** to check both connections before saving. The test reports inbound and outbound separately, with the provider's error when one fails.

## App passwords

Most providers with two-factor authentication need an **app password** rather than your normal password. Create one in your provider's security settings and use it for both IMAP and SMTP.

For Gmail and Microsoft 365, prefer [Connect Google](/guides/mailboxes/google/) or [Connect Microsoft](/guides/mailboxes/microsoft/): they do not need a password at all.

## Forwarding with SMTP

You can also combine [forwarding](/guides/mailboxes/forwarding/) for incoming mail with SMTP for replies. This avoids giving opendesk read access to the mailbox.

## Security

- Never use security `none` over the internet. It sends your password in the clear.
- Passwords are encrypted at rest with AES-GCM and are never shown again after you save them.
