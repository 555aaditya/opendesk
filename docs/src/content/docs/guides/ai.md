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
| Triage | Decides priority, severity, labels, team, sentiment, language and a category for a ticket, and applies what it is confident about. |
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

Triage reads a new ticket and decides its priority, severity, labels, team, the customer's sentiment (`positive`, `neutral`, `negative` or `frustrated`), the language and a category. Ollie decides using Jev, TypeSafe's decision model, when the instance has a TypeSafe key, and with the configured AI model otherwise. With Jev, each decision has a confidence: decisions under the workspace threshold become suggestions an agent accepts or dismisses. Applied changes appear in the ticket's activity, attributed to Ollie. Automations can run triage with the `ai_triage` action, match its result with `sentiment` and `severity` conditions, and ask Ollie a yes or no question with an `ai_decide` condition. See [Triage and assignment](/guides/triage-and-assignment/) and [Automations](/guides/automations/).

## Chat answers

When chat answers are on and your knowledge base has published articles, the widget can answer a visitor's message using only those articles. The answer is labelled as AI, cites its articles and offers **Talk to a person**. If no article is relevant, the bot does not answer and the conversation stays with your team. With Jev, Ollie checks each retrieved article for whether it answers the visitor's question, and whether the visitor needs a person, before writing anything. A visitor who asks for a person hands the conversation to the team, which notifies the assignee or team.

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
| `ai_decide` automation conditions (all of one run in one call) | 1 |
| Ask about a ticket | 2 |
| Draft a reply, chat answer | 3 |
| Draft an article | 5 |
| Chat answer relevance check (Jev) | 0 |

Triage asks every question in one call, so it costs 1 credit however many fields it decides.

Self-hosted instances have no credit limits: they use their own provider key. See [Cloud plans and billing](/guides/billing/).

## Your own provider key

Owners and admins can run a workspace's AI on its own key instead, in **Settings > AI > Provider**: an OpenRouter key, an Anthropic key, or any OpenAI-compatible endpoint (base URL and key). The key is checked with a small test call before it's saved, stored encrypted, and never shown again except its last 4 characters. An endpoint's base URL must use HTTPS on a public address.

- Every AI request of the workspace then goes to your provider: drafts, summaries, rewrites, translation, triage, chat answers, email answers and Ollie. Model choices list your provider's models.
- Requests on your key use no credits. They still appear in the usage report, marked as on your key.
- Search embeddings and Jev decisions stay on opendesk; Jev decisions keep their small credit cost.
- If your provider rejects the key or the account runs out of funds, AI features stop working (they never fall back to credits), admins get a notification, and the Provider section shows what happened and when. Replace the key to fix it, or remove it to go back to credits.

## Self-hosting

Set `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_BASE_URL` for any OpenAI-compatible endpoint, including local models through Ollama, vLLM or LM Studio. Add `TYPESAFE_API_KEY` to make decisions with Jev. See [Self-hosting AI](/self-hosting/ai/) and the [configuration reference](/self-hosting/configuration/#ai).
