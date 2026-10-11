---
title: AI
description: Draft, summarize, ask, triage, rewrite, translate and search with the AI endpoints.
---

When no AI provider is configured, `GET /v1/ai/config` reports `enabled: false` and every other AI route returns `404 ai_disabled`, except triage, which also runs on a decision engine alone. On Cloud, routes that cost credits return `402 no_credits` when the workspace has none left.

| Method | Path | Min role | Credits | Description |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/ai/config` | viewer | 0 | Provider, models and settings |
| `PATCH` | `/v1/ai/settings` | admin | 0 | Update workspace AI settings |
| `POST` | `/v1/tickets/{id}/ai/draft` | agent | 3 | Draft a reply |
| `POST` | `/v1/tickets/{id}/ai/summary` | viewer | 1 | Summarize a ticket |
| `POST` | `/v1/tickets/{id}/ai/ask` | viewer | 2 | Ask about a ticket |
| `POST` | `/v1/tickets/{id}/ai/triage` | agent | 1 | Triage, optionally applying the result |
| `DELETE` | `/v1/tickets/{id}/ai/suggestions/{field}` | agent | 0 | Dismiss Ollie's suggestion for `priority`, `severity`, `labels`, `team` or `spam` |
| `POST` | `/v1/ai/rewrite` | agent | 1 | Rewrite HTML |
| `POST` | `/v1/ai/translate` | agent | 1 | Translate HTML or text |
| `POST` | `/v1/kb/articles/ai/draft` | agent | 5 | Draft an article (not saved) |
| `GET` | `/v1/ai/search?q=` | viewer | 0 | Semantic search, same shape as `/v1/search` |

## Config

```json
{
  "enabled": true,
  "provider": "anthropic",
  "models": { "default": "claude-sonnet-5-5", "fast": "claude-haiku-4-5-20251001" },
  "embeddings": true,
  "features": { "enabled": true, "auto_triage": false, "auto_summarize": false, "widget_answers": false, "assistant": true, "tone": "friendly", "reply_language": "customer", "instructions": "" },
  "costs": { "summarize": 1, "rewrite": 1, "translate": 1, "triage": 1, "decide": 1, "answer_check": 0, "copilot": 2, "draft_reply": 3, "answer": 3, "kb_draft": 5, "assistant": 2 },
  "assistant_name": "Ollie",
  "decisions": { "provider": "typesafe", "model": "jev-latest", "connected": true }
}
```

`decisions` is the decision engine: `typesafe` (Jev by TypeSafe), `llm` (the configured AI model) or `none`.

`PATCH /v1/ai/settings` accepts any subset of `features`. `tone` is `friendly`, `professional`, `concise` or free text up to 200 characters; `instructions` up to 2,000 characters.

## Draft a reply

```sh
curl https://api.opendesk.sh/v1/tickets/1042/ai/draft \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "OD-Workspace: $WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{ "instructions": "Offer a refund", "tone": "friendly" }'
```

```json
{ "body_html": "<p>Hi Ana, ...</p>", "body_text": "Hi Ana, ...", "sources": [{ "article_id": "...", "title": "Refund policy", "url": "https://..." }] }
```

## Summary, ask and triage

- `summary` returns `{ summary, key_points, sentiment, updated_at }` and stores it on the ticket, published as `ticket.updated`.
- `ask` takes `{ question }` and returns `{ answer_html, sources }`.
- `triage` takes `{ apply }` and returns `{ tags, suggested_tags, priority, severity, team_id, sentiment, language, category, summary, applied, decisions, suggestions }`. With `apply: true` it applies every decision regardless of confidence: labels, and priority and severity, which are only ever raised. `summary` is empty on Jev, which does not write text.

Sentiment is `positive`, `neutral`, `negative` or `frustrated`. Languages are BCP 47 tags.

## Decisions

Ollie decides triage using Jev, TypeSafe's decision model, when the instance has a TypeSafe key, and with the configured AI model otherwise. Every question is asked in one call:

| Key | Type | Applied to |
| --- | --- | --- |
| `priority` | Score: low, normal, high, urgent | `priority`, only raised |
| `severity` | Score: sev4, sev3, sev2, sev1 | `severity`, set or only raised |
| `category` | Choice | `custom.ai_category` |
| `type_label` | Choice over the labels of an exclusive group named "Type" | that label |
| `label` | Choice over the other ticket labels | that label |
| `sentiment` | Choice | `custom.ai_sentiment` |
| `language` | Choice over common BCP 47 tags | `custom.language` |
| `spam` | Yes or no | a suggestion only |
| `needs_human` | Yes or no | recorded |
| `team` | Choice over the workspace's teams | `team_id`, when empty |
| `sla_risk` | Score | recorded, used by Ollie's `sla_at_risk` tip |

A decision applies when the workspace allows the field (`triage_fields`) and its confidence is at or above `triage_threshold` (default 0.7, set through [`/v1/triage`](/api/resources/pictures-assignment/)). Otherwise it is kept as a suggestion. Spam is suggested when its probability is at least 0.8. Decisions from the AI model have no calibrated confidence, record `confidence: null` and apply as before.

The latest run is stored as `custom.ai_decisions`, and pending suggestions as `custom.ai_suggestions`, both published with `ticket.updated`:

```ts
interface Decision { value: string | boolean | number | null; probability: number | null; confidence: number | null; applied: boolean }
interface AIDecisions { engine: "jev" | "llm"; model: string; model_version?: string; threshold: number; decided_at: string;
  fields: Partial<Record<"priority" | "severity" | "category" | "type_label" | "label" | "sentiment" | "language"
    | "spam" | "needs_human" | "team" | "sla_risk", Decision>> }
interface Suggestion { value: string | string[] | boolean; confidence: number | null; probability: number | null; model: string; decided_at: string }
type AISuggestions = Partial<Record<"priority" | "severity" | "labels" | "team" | "spam", Suggestion>>
```

Accept a suggestion by setting the field with `PATCH /v1/tickets/{id}`, which removes it. Dismiss it with `DELETE /v1/tickets/{id}/ai/suggestions/{field}`. A new triage run replaces them. Activities of applied decisions are attributed to `ai`, with data `{ via, model: "jev", confidence }`.

## Rewrite and translate

```sh
curl https://api.opendesk.sh/v1/ai/rewrite \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "OD-Workspace: $WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{ "html": "<p>we cant do that</p>", "mode": "more_formal" }'
```

Modes: `friendlier`, `more_formal`, `shorter`, `longer`, `fix_grammar`, `simplify`. `translate` takes `{ html?, text?, target }` and returns `{ html?, text?, source_language }`.

## Streaming

`draft`, `ask` and `rewrite` stream when you send `Accept: text/event-stream`. The response is a series of `delta` events carrying text chunks, then one `done` event carrying the same JSON the non-streaming call returns. Credits are spent once, at `done`.

```
event: delta
data: {"text":"Hi Ana, "}

event: delta
data: {"text":"thanks for your patience."}

event: done
data: {"body_html":"<p>Hi Ana, thanks for your patience.</p>","body_text":"Hi Ana, thanks for your patience.","sources":[]}
```

```sh
curl -N https://api.opendesk.sh/v1/tickets/1042/ai/draft \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "OD-Workspace: $WORKSPACE_ID" \
  -H "Content-Type: application/json" -d '{}'
```

## Widget handoff

A visitor can ask for a person after an AI answer with `POST /v1/widget/conversations/{id}/handoff` (visitor token). See [AI features](/guides/ai/#chat-answers).
