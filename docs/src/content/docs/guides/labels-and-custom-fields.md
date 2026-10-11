---
title: Labels and custom fields
description: Sort tickets, contacts and companies with coloured labels, and record structured details with custom fields.
---

**Labels** are short coloured names you put on tickets, contacts and companies, like `Bug`, `VIP` or `Churn risk`. **Custom fields** record details your team needs every time, like the product area, the app version or a company's renewal date.

Admins set both up in **Settings → Labels** and **Settings → Custom fields**. Agents apply labels and fill in fields. Viewers see them.

## Labels

Each label has a name, a colour from the palette and an optional description that explains when to use it. A label can be limited to tickets, contacts or companies, so the picker only offers it where it makes sense.

New workspaces start with:

| Label | Colour | Group |
| --- | --- | --- |
| Question | blue | Type |
| Problem | orange | Type |
| Bug | red | Type |
| Feature request | violet | Type |
| Billing | green | Type |
| VIP | amber | |
| Feedback | teal | |

Rename, recolour or delete any of them. Renaming a label keeps the automations and views that use it working.

### Groups

Groups keep a long list of labels tidy, for example `Type`, `Product area` or `Account health`. Drag groups and the labels inside them to set the order they appear in everywhere.

Make a group **exclusive** when a record should have only one of its labels. The default `Type` group is exclusive: a ticket is a question or a bug, not both. Choosing `Bug` on a ticket marked `Question` swaps the label instead of adding a second one. The same rule holds for bulk edits, automations and AI triage.

### Who can create labels

By default anyone who applies a label can type a new name to create it. To keep the list curated, set **Who can create labels** to **Admins only** in **Settings → Labels**. Agents then pick from the existing labels, and an admin adds new ones.

### Merge and archive

Two labels that mean the same thing can be **merged**. Everything that carried the old label gets the one you keep, automations and views switch over, and the old label is deleted.

**Archive** a label you no longer want offered. It stays on the records that have it, but it no longer appears in pickers.

The labels list shows how many tickets, contacts and companies use each label.

## Custom fields

Add fields for tickets, contacts or companies. Each field has a name, a type and an optional description shown as a hint:

| Type | Holds |
| --- | --- |
| Text, Long text | free text |
| Number | a number, like affected users or ARR |
| Single select, Multi select | options you define, each with a colour |
| Date | a calendar date, like a renewal or follow-up date |
| Checkbox | yes or no |
| URL, Email | a link or an address |
| Member | someone in the workspace, like an escalation owner |

Fields appear in the ticket sidebar and on contact and company pages, in the order you set. Archive a field to hide it from forms while keeping its values. Deleting a field removes its values.

### Required to solve

Turn on **Required to solve** for a ticket field, like `Resolution`, and the team must fill it in before solving or closing a ticket. If it's empty, opendesk asks for it first. Automations and auto-close aren't held back by required fields.

### Filters, views and automations

Filter the inbox by any field, like `Product area is Sync or Export` or `Affected users at least 10`, and save the filter as a [view](/guides/saved-replies-and-views/). Sort a list by a field to bring the biggest or the soonest to the top. Search also matches the text in fields.

[Automations](/guides/automations/) can check a ticket's fields or its contact's fields, and the **Set field** action fills one in, for example setting `Product area` to `Billing` for mail to the billing mailbox.

## Related

- [Labels and custom fields API](/api/resources/labels-fields/)
- [Automations](/guides/automations/)
- [Teams and roles](/guides/teams-and-roles/)
