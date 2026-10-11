---
title: What is opendesk
description: opendesk is an open-source helpdesk with shared email inboxes, live chat, a knowledge base and a public API.
---

opendesk is an open-source helpdesk. It brings your support email, live chat and help center into one shared inbox, and every change shows up live for everyone on the team. It ships as a hosted service at [opendesk.sh](https://opendesk.sh) and as a self-hosted install, and **the two run the same code**.

## What you get

- **Shared inbox.** Every conversation is a ticket with a status, priority, assignee, team, tags and an SLA. Agents reply, add internal notes, merge, snooze and bulk edit. See [Inbox and tickets](/guides/inbox-and-tickets/).
- **Mailboxes.** Bring support addresses in by forwarding, IMAP and SMTP, or by connecting a Google or Microsoft account. Replies go out through your own mailbox, so customers see your address. See [Mailboxes](/guides/mailboxes/).
- **Live chat.** An embeddable widget with optional identity verification, typing indicators and live delivery. See [Live chat widget](/guides/live-chat/).
- **Knowledge base and help center.** Collections and articles, published to a public help center your widget can link to. See [Knowledge base](/guides/knowledge-base/).
- **Automations and SLAs.** Rules that run on ticket events, and response and resolution targets per priority. See [Automations](/guides/automations/) and [SLA policies](/guides/sla-policies/).
- **Reports and CSAT.** Volume, response times, resolution times, SLA breaches and satisfaction scores. See [Reports](/guides/reports/).
- **AI, optional.** Draft replies, summaries, triage, translation and chat answers from your knowledge base, with any Anthropic or OpenAI-compatible provider, including local models. See [AI features](/guides/ai/).
- **A public API.** The web app uses exactly the documented REST API, plus signed webhooks and a realtime socket. See [API overview](/api/).

## How it is built

| part | what it does | hosted at |
| --- | --- | --- |
| API and workers | One Go binary. Serves the REST API, runs background jobs, relays events. `OPENDESK_ROLE` selects `all`, `api` or `worker`. | `api.opendesk.sh` |
| Realtime gateway | An Elixir and Phoenix service that pushes events, presence and typing over WebSockets. It holds no database connection. | `gateway.opendesk.sh` |
| Web app | A React app, plus the help center and the chat widget. | `app.opendesk.sh` |
| Postgres | The only datastore. Neon in the cloud, stock Postgres when self-hosted. | |

Every change that someone else should see is written as an **event** in the same database transaction as the change. A relay publishes events to NATS, the gateway pushes them to browsers, and webhooks deliver them to your endpoints. Background jobs run on Postgres. There is no Redis and no Kafka.

When you self-host, NATS runs embedded in the opendesk binary, and the whole stack (opendesk, the realtime gateway and Postgres) sits behind Caddy on one domain.

## Next steps

- [Quickstart (Cloud)](/getting-started/quickstart-cloud/)
- [Quickstart (self-host)](/getting-started/quickstart-self-host/)
