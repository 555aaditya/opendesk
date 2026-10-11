---
title: AI features
description: Draft replies, summarize tickets, triage, translate and answer chat visitors from your knowledge base.
---

opendesk's AI features help agents write and understand faster. They are optional: an admin can turn them off for the workspace, and a self-hosted instance only has them when its operator configures a provider.

## Features

| Feature | What it does |
| --- | --- |
| Draft a reply | Writes a reply from the conversation, the contact, your saved replies and the most relevant help articles, citing its sources. You edit it before sending. |
| Summarize | Summarizes a ticket with key points and the customer's sentiment, and keeps it on the ticket. |
| Ask about a ticket | Answers a question about the conversation, with sources. |
| Triage | Suggests tags, priority, sentiment, language and a category for a ticket, and can apply them. |
| Rewrite | Makes a draft friendlier, more formal, shorter or longer, fixes grammar, or simplifies it. |
| Translate | Translates a message or draft into another language. |
| Draft an article | Writes a knowledge base article from a topic or a set of tickets. It is not saved until you save it. |
| Semantic search | Finds tickets and articles by meaning, not only by words. |
| Chat answers | Answers chat visitors from your published articles, with a way to reach a person. |

Drafts, answers and rewrites can stream as they are written.

## Workspace settings

Admins choose:

- whether AI is **enabled** for the workspace
- **auto triage**: triage new tickets automatically, before other automations run
- **auto summarize**: keep a summary on tickets with five or more messages
- **chat answers**: the answer bot in the chat widget
- the **tone** for drafts: friendly, professional, concise, or your own words
- the **reply language**: the customer's language, or the workspace's
- extra **instructions** for drafts, such as policies the AI should follow

Auto triage, auto summarize and chat answers are off by default.

## Triage

Triage reads a new ticket and suggests tags, a priority, the customer's sentiment (`positive`, `neutral`, `negative` or `frustrated`), the language and a category. Applied changes appear in the ticket's activity, attributed to AI. Automations can run triage with the `ai_triage` action and match its result with a `sentiment` condition. See [Automations](/guides/automations/).

## Chat answers

When chat answers are on and your knowledge base has published articles, the widget can answer a visitor's message using only those articles. The answer is labelled as AI, cites its articles and offers **Talk to a person**. If no article is relevant, the bot does not answer and the conversation stays with your team. A visitor who asks for a person hands the conversation to the team, which notifies the assignee or team.

The AI never sends a message to a customer on its own, except these opt-in chat answers.

## How your data is handled

- Each request sends the model only the data that feature needs.
- Customer content goes only to the provider the instance is configured with. Prompts and completions are not logged; usage records store counts only.
- Customer messages and articles are passed to the model as data, never as instructions, and model output is sanitized before it is shown or stored.

## Credits on Cloud

On opendesk Cloud, AI features use credits from a monthly allowance, with optional credit packs. A failed request costs nothing.

| Feature | Credits |
| --- | --- |
| Summarize, rewrite, translate, triage | 1 |
| Ask about a ticket | 2 |
| Draft a reply, chat answer | 3 |
| Draft an article | 5 |

Self-hosted instances have no credit limits: they use their own provider key. See [Cloud plans and billing](/guides/billing/).

## Self-hosting

Set `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_BASE_URL` for any OpenAI-compatible endpoint, including local models through Ollama, vLLM or LM Studio. See [Self-hosting AI](/self-hosting/ai/) and the [configuration reference](/self-hosting/configuration/#ai).
