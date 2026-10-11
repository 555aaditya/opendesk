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
| `severity` | `sev1` to `sev4`, or `none` for no severity (`equals`, `not_equals`) |
| `ai_decide` | a yes or no question Ollie answers about the ticket (below) |
| `tag` | a label on the ticket |
| `field.<key>` | one of the ticket's [custom fields](/guides/labels-and-custom-fields/#custom-fields) |
| `contact.field.<key>` | one of the contact's custom fields |

Operators are `contains`, `not_contains`, `equals` and `not_equals`. When AI triage has run, a `sentiment` condition can also match its result (`positive`, `neutral`, `negative`, `frustrated`). Custom field conditions use the operators of the field's type, like `gte` for numbers or `any` for selects, and `set` or `not_set` to check whether it's filled in. An automation with no conditions runs for every ticket on its trigger.

## Actions

Actions apply in order:

| Action | Value |
| --- | --- |
| `set_status` | a status |
| `set_priority` | a priority |
| `set_severity` | `sev1` to `sev4`, or empty to clear |
| `assign_user` | a member |
| `assign_team` | a team |
| `add_tag`, `remove_tag` | a label. In an exclusive group, adding one replaces the group's other label |
| `set_field` | a ticket custom field and its value (empty clears it) |
| `send_reply` | reply text sent to the customer |
| `add_note` | an internal note |
| `mark_spam` | marks the ticket as spam |
| `ai_triage` | runs [AI triage](/guides/ai/#triage) (1 credit on Cloud) |

## Ask Ollie a question

An `ai_decide` condition asks Ollie a yes or no question about the ticket, written by an admin, and matches on the probability of yes: `gt` holds when it is above the value, `lt` when it is below (a value from 0.01 to 0.99). For example, field `ai_decide`, question "Is the customer at risk of churning?", operator `gt`, value `0.7`.

- The question is 3 to 300 characters of plain text. An automation can have at most 3.
- Ollie decides using Jev when the instance has a TypeSafe key, else with the configured AI model.
- Every `ai_decide` question of one trigger run is asked in one call, for 1 credit on Cloud. The answers are reused for the rest of the run.
- When there is no decision engine, AI is off, credits ran out or the call fails, the condition does not hold and the automation does not run.

## Order and status

Automations run in their listed **position**. Each one can be enabled or disabled, and shows how many times it has run. Managing automations needs the `admin` role.

## Examples

- **Urgent keywords.** Trigger `ticket_created`, condition `subject contains "outage"`, actions `set_priority urgent` and `assign_team On call`.
- **Billing routing.** Trigger `ticket_created`, condition `mailbox_id equals billing@`, action `assign_team Billing`.
- **Major incidents.** Trigger `ticket_updated`, condition `severity equals sev1`, actions `assign_team On call` and `add_note`.
- **Churn risk.** Trigger `customer_replied`, condition `ai_decide gt 0.7` with the question "Is the customer at risk of churning?", action `add_tag churn-risk`.
- **Reopen on reply.** Trigger `customer_replied`, condition `status equals pending`, action `set_status open`.

## Related

- [SLA policies](/guides/sla-policies/)
- [Automations API](/api/resources/automations-sla/)
