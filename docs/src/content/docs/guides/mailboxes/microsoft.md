---
title: Connect Microsoft
description: Connect a Microsoft 365 or Outlook.com mailbox to opendesk with Microsoft sign-in.
---

Connecting Microsoft lets opendesk read new mail from a Microsoft 365 or Outlook.com mailbox and send replies through it, without storing a password.

## Connect

1. Open **Settings → Mailboxes** and choose **Connect Microsoft**.
2. Pick the Microsoft account for the support address and accept the permissions.
3. Microsoft returns you to opendesk, and the new mailbox appears as connected.

Some organizations require an administrator to approve new apps. If you see "Need admin approval", ask a Microsoft 365 administrator to grant consent for opendesk.

## What opendesk asks for

| scope | why |
| --- | --- |
| `openid`, `email` | Identify which Microsoft account was connected. |
| `offline_access` | Keep the connection working after you close the browser. |
| `https://outlook.office.com/IMAP.AccessAsUser.All` | Read incoming mail over IMAP (`outlook.office365.com`). |
| `https://graph.microsoft.com/Mail.Send` | Send replies through the mailbox. |
| `https://graph.microsoft.com/User.Read` | Read the account's basic profile. |

Tokens are encrypted at rest with AES-GCM.

### IMAP must be enabled

In Microsoft 365, IMAP can be turned off per mailbox. An administrator can enable it in the [Microsoft 365 admin center](https://admin.microsoft.com) under **Users → Active users**, select the user, **Mail → Manage email apps**, and check **IMAP**.

## Disconnect

Delete the mailbox in opendesk. To revoke access on Microsoft's side, remove opendesk from [My apps](https://myapps.microsoft.com) or, as an administrator, from **Enterprise applications** in Microsoft Entra.

## Self-hosting

On your own instance you register your own Microsoft app. See [Google and Microsoft OAuth](/self-hosting/oauth-apps/).
