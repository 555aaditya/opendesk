---
title: SLA policies
description: Set first response and resolution targets per priority, and see breaches before they happen.
---

An **SLA policy** sets how quickly your team should respond to and resolve tickets. opendesk tracks each ticket against its policy and flags it when a target is missed.

## Policies

Each policy has:

- a **name**
- a **priority** it applies to, or any priority
- a **first response** target, in minutes
- a **resolution** target, in minutes
- a **business hours** switch: count only the minutes your workspace is open ([business hours](/guides/triage-and-assignment/#business-hours))
- an **enabled** switch and a **position**

New workspaces start with a default policy that you can edit.

## How targets are applied

When a ticket is created, or its priority changes, opendesk applies the matching policy and sets the ticket's **first response due** and **resolution due** times. The ticket shows a countdown, and you can sort the inbox by what is due soonest.

- The first response target is met by the first agent reply.
- The resolution target is met when the ticket is solved.

When a target passes unmet, the ticket is marked **breached**, an activity is added to its timeline, and the assignee receives a [notification](/guides/notifications/). Breaches are counted in [reports](/guides/reports/).

Managing SLA policies needs the `admin` role.

## Related

- [Automations](/guides/automations/)
- [SLA policies API](/api/resources/automations-sla/)
