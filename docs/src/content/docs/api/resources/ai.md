---
title: AI
description: Draft, summarize, ask, triage, rewrite, translate and search with the AI endpoints.
---

When no AI provider is configured, `GET /v1/ai/config` reports `enabled: false` and every other AI route returns `404 ai_disabled`. On Cloud, routes that cost credits return `402 no_credits` when the workspace has none left.

| Method | Path | Min role | Credits | Description |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/ai/config` | viewer | 0 | Provider, models and settings |
| `PATCH` | `/v1/ai/settings` | admin | 0 | Update workspace AI settings |
| `POST` | `/v1/tickets/{id}/ai/draft` | agent | 3 | Draft a reply |
| `POST` | `/v1/tickets/{id}/ai/summary` | viewer | 1 | Summarize a ticket |
| `POST` | `/v1/tickets/{id}/ai/ask` | viewer | 2 | Ask about a ticket |
| `POST` | `/v1/tickets/{id}/ai/triage` | agent | 1 | Triage, optionally applying the result |
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
  "costs": { "summarize": 1, "rewrite": 1, "translate": 1, "triage": 1, "copilot": 2, "draft_reply": 3, "answer": 3, "kb_draft": 5, "assistant": 2 },
  "assistant_name": "Jev"
}
```

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
- `triage` takes `{ apply }` and returns `{ tags, priority, sentiment, language, category, summary, applied }`. With `apply: true` it sets the tags and priority.

Sentiment is `positive`, `neutral`, `negative` or `frustrated`. Languages are BCP 47 tags.

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
