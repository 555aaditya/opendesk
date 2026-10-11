---
title: Triage and assignment
description: Let Ollie triage new tickets, route them to available agents, cap each agent's load and count SLAs in business hours.
---

New tickets can be triaged by Ollie and assigned automatically to whoever is available. All of it lives in **Settings, Triage**.

## Assignment modes

| Mode | What it does |
| --- | --- |
| Off | Tickets stay unassigned until someone picks them up |
| Round robin | Each ticket goes to the next available agent in turn |
| Load balanced | Each ticket goes to the available agent with the fewest open and pending tickets. Ties go round robin |

Set a workspace default, then override it for a team or a mailbox. For each ticket, opendesk uses the rule for its team, else the rule for its mailbox, else the workspace default.

### Who can be assigned

- The pool is the ticket's team, else its mailbox's team, else every owner, admin and agent. Viewers are never assigned.
- An agent must be **online** and under their cap.
- When nobody is eligible, the ticket stays unassigned. It is tried again when the customer replies.

Assignment runs after [automations](/guides/automations/), when a ticket is created and when a customer replies, for tickets that are still unassigned. The ticket's activity shows it as assigned by the system, with the mode.

## Availability

Every member sets themselves **online**, **away** or **offline**. Admins can set it for anyone. Only online agents receive new tickets.

**Auto-away** marks an online agent as away after a set time without activity in the app (10 minutes to 24 hours, off by default). They are back as soon as they use the app again.

### Caps

Admins can cap how many open and pending tickets an agent holds at once (1 to 1000). An agent at the cap is skipped until they solve or hand off a ticket.

## Triage by Ollie

When AI is on, Ollie can triage every new ticket: it records the sentiment, language and category, and can raise the priority and add labels. Choose which of priority and labels Ollie may change.

Turn on **Assign after triage** to route each ticket once Ollie has triaged it. It uses the ticket's assignment mode, or load balancing when the mode is off. The activity shows the assignment by Ollie, via triage.

## Business hours

Set opening hours for each day (up to 3 ranges), holidays, and the workspace timezone. An [SLA policy](/guides/sla-policies/) set to **Business hours** counts only open minutes: a 4 hour first response target on a ticket that arrives at 16:00 on a Friday, with hours of 9:00 to 17:00 Monday to Friday, is due at 12:00 on Monday.

## Setup checklist

New workspaces show a checklist: connect a mailbox, invite a teammate, upload your photo, install the chat widget, publish a help article, set up triage and assignment, create a label, and try Ollie. Each step ticks itself off when it is done. Anyone can hide it for themselves.

See the [API reference](/api/resources/pictures-assignment/).
