---
title: Forwarding
description: Forward your support address to opendesk from Gmail, Google Workspace, Microsoft 365 or any provider.
---

Forwarding is the simplest way to bring mail in. When you create a forwarding mailbox, opendesk gives it a unique address such as `acme-x7k2@in.opendesk.sh`. You forward your support address to it, and every message becomes a ticket.

Pair forwarding with an outbound method ([SMTP](/guides/mailboxes/imap-smtp/), Google or Microsoft) so replies leave from your own address.

:::note
Copy the forwarding address from the mailbox's settings page. Self-hosted instances use their own inbound domain (`INBOUND_DOMAIN`), see [Email setup](/self-hosting/email/).
:::

## Gmail

1. In Gmail, open **Settings** (the gear) → **See all settings** → **Forwarding and POP/IMAP**.
2. Click **Add a forwarding address** and paste your opendesk forwarding address. Click **Next**, then **Proceed**.
3. Gmail sends a confirmation email to that address. It arrives in opendesk as a ticket. Open it and either click the confirmation link or copy the code.
4. Back in Gmail, enter the code if asked, then choose **Forward a copy of incoming mail to** your opendesk address.
5. Choose what Gmail does with its own copy (keep it is fine) and click **Save Changes**.

To forward only some mail, skip step 4 and create a filter instead: **Create a filter** with your criteria, then **Forward it to** the opendesk address.

## Google Workspace

Each user can set up forwarding the same way as Gmail above. For a shared address, an administrator can route mail at the domain level instead, without a mailbox login:

1. In the [Google Admin console](https://admin.google.com), go to **Apps → Google Workspace → Gmail → Routing**.
2. Under **Routing**, click **Configure** (or **Add another rule**).
3. Under **Email messages to affect**, choose **Inbound** (and **Internal, receiving** if colleagues email support too).
4. Under **For the above types of messages, do the following**, choose **Modify message**, then under **Envelope recipient** check **Add more recipients**, click **Add**, and enter the opendesk forwarding address.
5. Under **Options**, limit the rule to your support address with an envelope filter (**Only affect specific envelope recipients**, single recipient `support@example.com`).
6. Save. Changes can take up to an hour to apply.

Administrators can also restrict who may set up automatic forwarding under **Gmail → End User Access → Automatic forwarding**. Make sure it is allowed for the support user if you use per-user forwarding.

## Microsoft 365 and Outlook

Microsoft 365 blocks automatic forwarding to external addresses by default. An administrator must allow it first.

### Allow external forwarding (administrator)

1. Open the [Microsoft Defender portal](https://security.microsoft.com) → **Email & collaboration → Policies & rules → Threat policies → Anti-spam policies**.
2. Open **Anti-spam outbound policy (Default)**, or create a custom outbound policy that applies only to your support mailbox (recommended).
3. Under **Forwarding rules**, set **Automatic forwarding rules** to **On - Forwarding is enabled**. Save.

### Forward the mailbox

Either set forwarding on the mailbox (administrator):

1. In the [Microsoft 365 admin center](https://admin.microsoft.com), go to **Users → Active users** (or **Teams & groups → Shared mailboxes** for a shared mailbox) and select the mailbox.
2. Open the **Mail** tab → **Email forwarding** → **Manage email forwarding**.
3. Turn on **Forward all emails sent to this mailbox**, enter the opendesk forwarding address, and choose whether to keep a copy. Save.

Or create a rule in Outlook on the web (user):

1. Open **Settings → Mail → Rules → Add new rule**.
2. Name it, add the condition **Apply to all messages** (or narrower conditions).
3. Add the action **Forward to** (or **Redirect to**) and enter the opendesk forwarding address. Save.

**Redirect** keeps the original sender, which opendesk needs to know who wrote in. Both work, since opendesk reads the original headers, but redirect is the cleaner choice.

## Any other provider

Look for "forwarding" or "redirect" in your provider's mail settings or admin panel, and forward to your opendesk address. Most providers send a confirmation message first; it appears in opendesk as a ticket.

## Troubleshooting

- **Nothing arrives.** Check the forwarding rule is enabled and points at the exact address from the mailbox settings. In Microsoft 365, check the outbound spam policy allows forwarding.
- **The wrong person is the sender.** Use redirect rather than forward where your provider offers both.
- **Duplicates.** Each raw message is stored once, keyed by its Message-ID, so redelivery of the same message does not create a second ticket.
