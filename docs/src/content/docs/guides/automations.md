---
title: Automations
description: Rules that act on tickets when they are created, updated or replied to.
---

An **automation** is a rule: when a trigger fires and every condition matches, its actions run in order. Use automations to route, tag, prioritize and acknowledge tickets without anyone touching them.

## Triggers

| Trigger | Fires when |
| --- | --- |
| `ticket_created` | A new ticket arrives on any channel. |
| `customer_replied` | The customer sends a new message on a ticket. |
| `agent_replied` | An agent sends a reply. |
| `ticket_updated` | A ticket's fields change. |

## Conditions

All conditions must match. Each condition compares a field with a value.

| Field | Examples |
| --- | --- |
| `subject`, `body` | text of the ticket or message |
| `from_email` | the sender's address |
| `channel` | `email`, `chat`, `api`, `portal` |
| `mailbox_id` | the mailbox it arrived on |
| `priority`, `status` | current values |
| `tag` | a tag on the ticket |

Operators are `contains`, `not_contains`, `equals` and `not_equals`. When AI triage has run, a `sentiment` condition can also match its result (`positive`, `neutral`, `negative`, `frustrated`). An automation with no conditions runs for every ticket on its trigger.

## Actions

Actions apply in order:

| Action | Value |
| --- | --- |
| `set_status` | a status |
| `set_priority` | a priority |
| `assign_user` | a member |
| `assign_team` | a team |
| `add_tag`, `remove_tag` | a tag |
| `send_reply` | reply text sent to the customer |
| `add_note` | an internal note |
| `mark_spam` | marks the ticket as spam |
| `ai_triage` | runs [AI triage](/guides/ai/#triage) (1 credit on Cloud) |

## Order and status

Automations run in their listed **position**. Each one can be enabled or disabled, and shows how many times it has run. Managing automations needs the `admin` role.

## Examples

- **Urgent keywords.** Trigger `ticket_created`, condition `subject contains "outage"`, actions `set_priority urgent` and `assign_team On call`.
- **Billing routing.** Trigger `ticket_created`, condition `mailbox_id equals billing@`, action `assign_team Billing`.
- **Reopen on reply.** Trigger `customer_replied`, condition `status equals pending`, action `set_status open`.

## Related

- [SLA policies](/guides/sla-policies/)
- [Automations API](/api/resources/automations-sla/)
