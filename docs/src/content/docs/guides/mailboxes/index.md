---
title: Mailboxes
description: Bring your support email into opendesk with forwarding, IMAP and SMTP, or a Google or Microsoft connection.
---

A **mailbox** is a support address, such as `support@example.com`, connected to your workspace. Mail that arrives becomes tickets, and replies go out through the same address.

Each mailbox has two halves: how mail comes **in** and how replies go **out**.

| Inbound | How it works | Setup |
| --- | --- | --- |
| Forwarding | Your provider forwards mail to a unique opendesk address. | [Forwarding](/guides/mailboxes/forwarding/) |
| IMAP | opendesk reads new mail from the mailbox. | [IMAP and SMTP](/guides/mailboxes/imap-smtp/) |
| Google | You sign in with Google once; opendesk reads Gmail. | [Connect Google](/guides/mailboxes/google/) |
| Microsoft | You sign in with Microsoft once; opendesk reads Outlook. | [Connect Microsoft](/guides/mailboxes/microsoft/) |

| Outbound | How it works |
| --- | --- |
| SMTP | Replies are sent through your provider's SMTP server. |
| Google | Replies are sent through the connected Gmail account. |
| Microsoft | Replies are sent through the connected Microsoft account. |
| System | Replies are sent by opendesk's own mail service. Use this only when you cannot connect your mailbox. |

## Why replies go out through your mailbox

Sending through your own mailbox keeps replies in your Sent folder, signs them with your domain's SPF and DKIM, and means customers see and trust the address they wrote to. It also keeps your deliverability in your hands.

## Mailbox settings

- **Name** and **display name**: the sender name customers see.
- **Team**: tickets from this mailbox go to a team.
- **Signature**: appended to every reply.
- **Auto-reply**: an optional acknowledgement sent to the customer when a new ticket arrives. Auto-replies are marked as automatic, so other autoresponders ignore them.

## Testing and status

**Test** checks both halves and reports each one separately. A mailbox is `active`, `error` or `disabled`. When a connection fails, the mailbox shows the last error and when it last synced. If a provider revokes access, reconnect the mailbox in settings.

## Security

Passwords and OAuth tokens are encrypted at rest with AES-GCM. Connecting or disconnecting a mailbox is recorded in the audit log. Managing mailboxes needs the `admin` role.
