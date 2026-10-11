---
title: Connect Google
description: Connect a Gmail or Google Workspace mailbox to opendesk with Google sign-in.
---

Connecting Google lets opendesk read new mail from a Gmail or Google Workspace mailbox and send replies through it, without storing a password.

## Connect

1. Open **Settings → Mailboxes** and choose **Connect Google**.
2. Sign in with the Google account for the support address and review the permissions.
3. Google returns you to opendesk, and the new mailbox appears as connected.

## What opendesk asks for

| Scope | Why |
| --- | --- |
| `openid`, `email` | Identify which Google account was connected. |
| `https://mail.google.com/` | Read incoming mail over IMAP and send replies through Gmail. |

opendesk requests offline access, so it keeps working after you close the browser. The refresh token is encrypted at rest with AES-GCM.

## How opendesk uses Gmail data

opendesk's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Mail is read only to turn it into tickets in your workspace and to send the replies your team writes. It is not used for advertising, not sold, and not read by people except as needed for security, to comply with the law, or with your permission for support.

## Disconnect

Delete the mailbox in opendesk, and optionally remove opendesk's access in your Google Account under **Security → Your connections to third-party apps and services**. If access is removed in Google first, the mailbox shows an error and asks you to reconnect.

## Self-hosting

On your own instance you register your own Google OAuth client. See [Google and Microsoft OAuth](/self-hosting/oauth-apps/).
