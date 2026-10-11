---
title: Integrations
description: Connect Linear, GitHub, Jira, Sentry, Slack, Stripe and any MCP server so Ollie can look things up and act there, with your approval.
---

Integrations connect the tools your team already works in. Once one is connected, Ollie can look things up there and, after someone approves, create and update things for you: "open a Linear issue for this ticket", "is this error in Sentry?", "check this customer's invoices in Stripe".

Every integration is the product's own **MCP server** (Model Context Protocol). Products not in the list connect by URL, including internal tools that run an MCP server.

## Connect one

Admins connect integrations in **Settings, Integrations**. The connection is shared by the workspace, so an admin signs in once and everyone's Ollie can use it.

- **Account sign-in** (Linear, Jira and Confluence, Sentry, Notion, Slack and most others) opens the product's own sign-in page and brings you back to opendesk.
- **Access token** (GitHub, Stripe) asks for a token you create in that product. Give it only the access Ollie needs, for example a fine-grained GitHub token for the repositories it may use, or a Stripe restricted key with read access.
- **Add by URL** connects any MCP server that speaks Streamable HTTP or the older HTTP and SSE transport. Choose how it signs in: account sign-in, an access token, or none.

Open a connected integration to see its tools. Each one is marked **Looks up** (runs on its own) or **Asks first** (waits for approval). Switch off any tool you don't want Ollie to use, or switch the whole integration off. **Check for new tools** fetches the list again after the product adds tools.

## Use it on a ticket

On a ticket, Ollie's section shows shortcuts for your connected tools under **In your tools**, such as "Create a Linear issue" or "Find the error in Sentry". You can also just ask Ollie in your own words.

Anything that creates or changes something shows an approval card first, marked **Runs in Linear** (or the product it runs in), with the exact title, fields and text. Nothing happens until the person who asked approves it.

When Ollie creates something from a ticket, it links it back. The ticket's **Linked** section lists what the ticket points to in other tools, and the timeline records "Ollie linked ...". Removing a link leaves the item in the other product as it is.

## Security

- Sign-ins and tokens are stored encrypted and are never shown again, in the app, the API, events or logs.
- opendesk only talks to public https servers, and checks every address a server names (its sign-in pages included) the same way.
- Account sign-in uses OAuth with PKCE. The sign-in is bound to the browser that started it.
- Connecting, changing and disconnecting an integration is recorded in the audit log.
- What a connected product returns is treated as data: it cannot approve changes or change Ollie's instructions.

## Self-hosting

Integrations work the same on a self-host. Most products register opendesk on their own the first time an admin signs in. For a product that only accepts apps registered in advance, register an OAuth app there with the redirect URL `https://<your API URL>/v1/integrations/oauth/callback`, then set:

```bash
MCP_<KEY>_CLIENT_ID=...
MCP_<KEY>_CLIENT_SECRET=...   # if the product issued one
```

`<KEY>` is the integration's key in capitals, for example `MCP_SLACK_CLIENT_ID` (Slack only accepts apps registered in advance; the compose file passes its two variables). For another product, add its two variables to the `opendesk` service's `environment` in `docker-compose.yml`. The API reference for integrations and ticket links is in [the contract](https://github.com/useopendesk/opendesk/blob/main/contracts/integrations.md).
