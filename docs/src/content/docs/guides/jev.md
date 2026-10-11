---
title: Jev, the assistant
description: Ask Jev about your queue, let it find tickets and pull numbers, and approve the changes it prepares.
---

Jev is opendesk's assistant: the violet blob in the top bar. Ask it about your queue in plain words. It reads tickets, customers, help articles, views, reports and the team's workload, explains what it finds, and prepares changes for you. **Nothing changes until you approve it.**

Open Jev with the blob in the header or <kbd>⌘</kbd> <kbd>J</kbd> (<kbd>Ctrl</kbd> <kbd>J</kbd> on Windows and Linux). <kbd>Esc</kbd> closes it.

## What you can ask

- "Summarize this ticket" or "Who should take this?" on an open ticket. Jev knows which page and ticket you are looking at.
- "What needs my attention right now?", "Which tickets breach SLA in the next hour?"
- "Show unassigned tickets older than a day and suggest assignees."
- "Label all billing tickets from this week."
- "Draft a reply to this customer", "Add an internal note with what we know so far."
- "How are we doing this week?" for volume, response times, SLA and CSAT.
- "Draft a help article from recently solved tickets about the most common question."

Type <kbd>/</kbd> in the message box for quick asks. Ticket numbers in Jev's answers, like #123, open the ticket.

## Approving changes

When Jev wants to change something, it shows an approval card with exactly what will happen: each field before and after, the tickets it covers, or the full text of a reply or note. A reply that will reach a customer is marked so.

- **Approve** (<kbd>⌘</kbd> <kbd>Enter</kbd>) makes the change with your permissions, once.
- **Deny** leaves everything as it is; Jev asks what you want instead.
- Sending a new message instead skips the change.

Jev can change assignee, status, priority, labels and fields, add notes, send replies you approved, save help article drafts and personal views, and (for admins) save automations, switched off for you to review. Bulk changes cover at most 50 tickets per approval, and the tickets are fixed when Jev proposes the change, so a ticket that arrives later is not swept in.

Jev works with your own role: a viewer can ask questions but not make changes, and only admins can draft automations.

## Who did it

Everything the AI does in opendesk is shown as Jev: changes you approved in the assistant, auto-triage, widget answers and AI automation actions. A ticket's timeline reads "Jev set priority to High" with Jev's mark, and the audit log records the change as made by the AI on your behalf.

## Tips

Now and then Jev offers a short tip under the blob, such as "3 tickets breach SLA within the hour". Tips come from simple counts, not the AI, and cost nothing. They appear at most every 20 minutes, never while the panel is open, and you can pause them for a week.

## Conversations

Conversations are private to you. Open past ones from the history button, rename or delete them, or start a new chat. The panel can sit docked beside your work or float anywhere you drag it.

## Credits and settings

Each answer uses 2 credits per model turn (see [Cloud plans and billing](/guides/billing/)). Admins can turn Jev off for the workspace in **Settings → AI**. On a self-hosted instance Jev needs an AI provider that supports tool use (Anthropic, or an OpenAI-compatible endpoint with tools); see [AI on a self-hosted instance](/self-hosting/ai/).
