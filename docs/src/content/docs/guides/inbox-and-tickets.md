---
title: Inbox and tickets
description: How tickets, messages, notes, statuses and assignment work in the opendesk inbox.
---

Every conversation in opendesk is a **ticket**. Email, chat, the API and the help center portal all create tickets in the same inbox, so the team works one queue.

## Tickets

A ticket has:

- a **number** (`#1042`), unique and increasing within the workspace
- a **subject** and a **channel**: `email`, `chat`, `api` or `portal`
- a **status**: `open`, `pending`, `on_hold`, `solved` or `closed`
- a **priority**: `low`, `normal`, `high` or `urgent`
- an optional **severity**: Sev 1 (critical) to Sev 4 (low impact), shown as a compact chip such as `S2`
- an optional **assignee**, **team**, **mailbox** and **tags**
- the **contact** who wrote in, and their company when known
- an **SLA** with first response and resolution due times, when a policy applies (see [SLA policies](/guides/sla-policies/))
- a **CSAT** score once the customer rates the conversation (see [CSAT](/guides/csat/))

### Statuses

| Status | Meaning |
| --- | --- |
| `open` | Waiting on your team. |
| `pending` | Waiting on the customer. |
| `on_hold` | Waiting on something else, such as another team or a third party. |
| `solved` | Resolved. A new reply from the customer reopens the conversation. |
| `closed` | Finished and kept for the record. |

You can also **snooze** a ticket until a time, mark it as **spam**, **merge** it into another ticket, or delete it.

## Replies and notes

A ticket's timeline holds its messages and activity:

- **Replies** go to the customer. On email tickets they are sent from the ticket's mailbox, with your signature, so the customer sees your support address. Each reply shows its delivery status: pending, sent, failed or bounced.
- **Notes** are internal. Customers never see them, over email or in the chat widget.
- **Activity** records status, priority, severity, assignment, team, tag, SLA, merge and CSAT changes, with who made them.

You can set the status in the same step as sending a reply, for example "send and mark pending". Attachments upload once and are linked to the message when it is sent.

## Assignment

Assign a ticket to a person, a team, or both. Assigning someone notifies them (see [Notifications](/guides/notifications/)). A workspace can also turn on automatic round-robin assignment in its settings, and [automations](/guides/automations/) can assign by rule.

## Working together live

The inbox updates in real time. When a teammate replies, changes a status or assigns a ticket, everyone sees it without refreshing. On an open ticket you can see who else is **viewing** or **replying**, and the customer's typing indicator on chat tickets. This prevents two agents answering the same customer.

## Views and search

The sidebar shows counts for unassigned, mine, open, pending, on hold, solved and spam, plus your [views](/guides/saved-replies-and-views/). Views filter by status, priority, severity, assignee, team, mailbox, tag, channel and text. Global search finds tickets, contacts and articles at once.

## Bulk actions

Select several tickets to change their status, priority, severity, assignee, team or tags in one step, or to delete them.

## Contacts and companies

Every customer is a **contact**, matched by email address, or by your own user id when the chat widget is [verified](/guides/live-chat/identity-verification/). Contacts can belong to a **company**, carry notes and custom fields, and be blocked. A contact's page lists all of their tickets.

## Related

- [Keyboard shortcuts](/guides/keyboard-shortcuts/)
- [Tickets API](/api/resources/tickets/)
