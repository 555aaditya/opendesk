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

When AI is on, Ollie can triage every new ticket. In one call it decides:

| Decision | What Ollie may do with it |
| --- | --- |
| Priority (low, normal, high, urgent) | Raise the priority. Ollie never lowers it |
| Severity (Sev 1 to Sev 4) | Set the severity, or raise it. Ollie never lowers it |
| Labels | Add a label, and a label from your exclusive **Type** group when you have one |
| Team | Set the team of a ticket that has none |
| Category, sentiment, language | Always recorded on the ticket |
| Spam | Only ever suggested, never applied |

Choose which of priority, severity, labels and team Ollie may change. By default it may change priority, severity and labels.

### Severity

Severity is the business impact of a ticket, separate from how soon it needs an answer:

| Severity | Meaning |
| --- | --- |
| Sev 1 | Critical: the product is down or data is at risk for many customers |
| Sev 2 | Major: a key feature is broken for a customer, with no workaround |
| Sev 3 | Minor: something is wrong but there is a workaround |
| Sev 4 | Low: a question, cosmetic issue or request with no impact |

A ticket can have no severity. Filter, sort, build views and write automations on it like priority.

### Confidence and suggestions

Ollie decides using Jev, TypeSafe's decision model, when your instance has a TypeSafe key. Jev gives each decision a confidence. Ollie applies a decision only when its confidence is at or above the workspace **confidence threshold** (0.5 to 0.99, default 0.7). Below it, the decision appears as a suggestion in the ticket sidebar: accept it with one click, or dismiss it. Setting the field yourself also clears the suggestion.

Changes Ollie makes show on the timeline as Ollie, for example "Ollie set severity to Sev 2", with the confidence in the details. Without a TypeSafe key, Ollie triages with the configured AI model, which has no calibrated confidence: its decisions apply as before, without a threshold. **Settings, Triage** shows which engine is in use.

Turn on **Assign after triage** to route each ticket once Ollie has triaged it. It uses the assignment mode of the team Ollie picked, or of the ticket, or load balancing when the mode is off. The activity shows the assignment by Ollie, via triage.

## Business hours

Set opening hours for each day (up to 3 ranges), holidays, and the workspace timezone. An [SLA policy](/guides/sla-policies/) set to **Business hours** counts only open minutes: a 4 hour first response target on a ticket that arrives at 16:00 on a Friday, with hours of 9:00 to 17:00 Monday to Friday, is due at 12:00 on Monday.

## Setup checklist

New workspaces show a checklist: connect a mailbox, invite a teammate, upload your photo, install the chat widget, publish a help article, set up triage and assignment, create a label, and try Ollie. Each step ticks itself off when it is done. Anyone can hide it for themselves.

See the [API reference](/api/resources/pictures-assignment/).
