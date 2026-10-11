# AI

opendesk's AI runs through one provider interface (`internal/ai`). Providers:
`anthropic` (default on Cloud: `AI_MODEL=claude-sonnet-5-5`, `AI_FAST_MODEL=claude-haiku-4-5-20251001`),
`openai` (any OpenAI-compatible endpoint via `OPENAI_BASE_URL`: OpenAI, Azure, Ollama,
vLLM, LM Studio, so self-hosters can run fully local), or `none`. Embeddings (semantic
search, answer retrieval): `voyage`, `openai`, or `none` (falls back to Postgres FTS).

When the provider is `none`, `GET /v1/ai/config` reports `enabled: false` and the web app
hides AI controls; every other AI route answers `404 ai_disabled`.

Every call: `d.Plan.Reserve` → model → `d.Plan.Spend` (see `contracts/billing.md`). Prompts carry
only the data the feature needs. Customer content is sent to the configured provider only;
provider responses are not used for training (Anthropic API default). No prompt or completion
text is logged; usage rows store counts only. Workspace admins can turn AI features off
(`settings.ai`).

Untrusted content (customer emails, chat, KB) is always placed in delimited data blocks and the
system prompt instructs the model to treat it as data. Model output is sanitized with the
same bluemonday rich-text policy before it is shown or stored, and AI never sends a message to a
customer by itself except the widget answer bot (opt-in, labelled as AI, with a handoff button).

## Workspace settings (`settings.ai`)

```ts
interface AISettings {
  enabled: boolean                 // master switch, default true when the instance has AI
  auto_triage: boolean             // run triage on new tickets, default false
  triage_fields: ("priority" | "labels")[] // what triage may change, default both (set through /v1/triage)
  assign_after_triage: boolean     // assign a ticket after auto-triage, attributed to ai (contracts/api.md "Triage"), default false
  auto_summarize: boolean          // keep a summary on tickets with 5+ messages, default false
  widget_answers: boolean          // answer bot in the chat widget, default false
  assistant: boolean               // Ollie, the assistant panel, default true
  tone: string                     // "friendly" | "professional" | "concise" | free text up to 200 chars
  reply_language: "customer" | "workspace"  // reply in the customer's language (default) or the workspace's
  instructions: string             // extra guidance for drafts, up to 2,000 chars
}
```

`PATCH /v1/ai/settings` merges the given keys into `settings.ai` (others are kept), answers
`422 validation_failed` for an unknown `reply_language`, a `tone` over 200 characters or
containing `<`, `>` or control characters, or `instructions` over 2,000 characters (control
characters other than newline and tab are stripped), and writes the audit entry
`ai.settings_updated` with the changed keys (not their values). `reply_language: "workspace"`
means English unless `instructions` name another language.

## Endpoints (owner area: ai)

| method | path | min role | credits | body → response |
| --- | --- | --- | --- | --- |
| GET | `/v1/ai/config` | viewer | 0 | `{enabled, provider, models: {default, fast}, embeddings: boolean, features: AISettings, costs: Record<string, number>, assistant_name: "Ollie"}` |
| PATCH | `/v1/ai/settings` | admin | 0 | `Partial<AISettings>` → `AISettings` |
| POST | `/v1/tickets/{id}/ai/draft` | agent | 3 | `{instructions?: string, tone?: string}` → `{body_html, body_text, sources: KBSource[]}`; uses the thread, contact, saved replies and the top KB matches |
| POST | `/v1/tickets/{id}/ai/summary` | viewer | 1 | `{}` → `{summary: string, key_points: string[], sentiment: Sentiment, updated_at}`; stored on the ticket (`custom.ai_summary`) and published as `ticket.updated` |
| POST | `/v1/tickets/{id}/ai/ask` | viewer | 2 | `{question: string}` → `{answer_html, sources: KBSource[]}` (copilot) |
| POST | `/v1/tickets/{id}/ai/triage` | agent | 1 | `{apply: boolean}` → `Triage`; `apply` sets tags/priority with `automation`-style activities attributed to `ai` |
| POST | `/v1/ai/rewrite` | agent | 1 | `{html: string, mode: "friendlier"\|"more_formal"\|"shorter"\|"longer"\|"fix_grammar"\|"simplify", instructions?: string}` → `{html}` |
| POST | `/v1/ai/translate` | agent | 1 | `{html?: string, text?: string, target: string /* BCP 47 */}` → `{html?, text?, source_language}` |
| POST | `/v1/kb/articles/ai/draft` | agent | 5 | `{ticket_ids?: string[] /* at most 10 */, topic?: string /* up to 300 chars */}` → `{title, body_html, excerpt}` (not saved) |
| GET | `/v1/ai/search` | viewer | 0 | `?q` semantic search over tickets and articles (embeddings), FTS fallback → same shape as `/v1/search` |

`{id}` is a ticket uuid, `#123` (URL-encoded `%23123`) or `123`. API keys need the scope
of the data the route reads or writes: `tickets:read` (summary, ask, search),
`tickets:write` (draft, triage, rewrite, translate), `kb:write` (KB draft),
`settings:read` / `settings:write` (config, settings). `/v1/ai/search` returns only the
sections the key can read.

Errors, all `application/problem+json`:

| status | code | when |
| --- | --- | --- |
| 404 | `ai_disabled` | the instance has no AI provider |
| 403 | `ai_off` | `settings.ai.enabled` is false |
| 402 | `no_credits` | `d.Plan.Reserve` refused; the model was not called |
| 503 | `ai_busy` | the provider is rate limited or overloaded after retries |
| 502 | `ai_unavailable` | the provider failed or timed out |
| 502 | `ai_bad_output` | the model returned output that failed validation |
| 422 | `ai_refused` | the model declined the request |

A failed call costs nothing: credits are spent only after the feature succeeded, and a
usage row (`ai_usage`, counts only) is written with every spend. Without billing (self-host)
usage rows are still written; there is no balance. Each successful call also sends the
analytics event `ai_feature_used {feature, model}` (no content).

Streaming: `draft`, `ask` and `rewrite` also accept `Accept: text/event-stream` and stream
`event: delta` `{text}` chunks, then `event: done` with the full JSON response. Credits are
spent once, at `done`. Delta text is the raw model text (markdown for draft and ask, HTML
for rewrite) for a live preview only; render and insert the sanitized `done` payload. An
error before the first event is a normal problem+json response with its status (so `402
no_credits` arrives as JSON even on a streaming request); an error after the stream started
is `event: error` with the problem object as data, and the stream ends.

```ts
type Sentiment = "positive" | "neutral" | "negative" | "frustrated"
interface Triage { tags: string[]; suggested_tags: string[]; priority: "low" | "normal" | "high" | "urgent";
  sentiment: Sentiment; language: string /* BCP 47, "und" when unknown */; category: Category;
  summary: string /* one line, at most 300 chars */; applied: boolean }
type Category = "question" | "problem" | "bug" | "billing" | "account" | "feature_request" | "feedback"
  | "sales" | "shipping" | "refund" | "cancellation" | "spam" | "other"
interface KBSource { article_id: string; title: string; url: string /* {APP_URL}/help/{workspace slug}/articles/{slug} */ }
```

Triage output is validated, never trusted: `tags` are at most 3 of the workspace's existing
tags (canonical names); `suggested_tags` are at most 2 new, cleaned, lowercase names; an
unknown priority becomes `normal`, sentiment `neutral`, category `other`, language `und`.
`apply` (and auto-triage, and the automation action) only ever **raises** priority, so AI
never lowers a person's choice. Applying adds the tags, sets `custom.ai_sentiment`,
`custom.language`, `custom.ai_category`, `custom.ai_triaged_at`, and logs activities with
`actor_type = "ai"` (`tagged`, `priority_changed`, `ai_triaged`). Only the explicit API
`apply` creates `suggested_tags` as tags (never when `settings.label_creation` is `"admins"`; labels whose `applies_to` lacks tickets are skipped, and an exclusive label group keeps one label, the last applied, contracts/api.md); auto-triage and the automation action store them
in `custom.ai_suggested_tags` for an agent to accept.

A summary also sets `custom.ai_sentiment`. `custom.ai_summary` is
`{text, key_points, sentiment, updated_at, message_count}`.

Messages and tickets also get `language` detection for free when triage runs
(`custom.language`), which the web app uses for a "Translate" affordance.

## Ollie (the assistant)

The AI has one name, **Ollie**, exposed once as `assistant_name` in `GET /v1/ai/config`
(`ai.AssistantName` in Go). The web app and emails read it from there. Everything the AI
does is attributed to Ollie: the assistant, auto-triage, widget answers and AI automation
actions. Activities with `actor_type = "ai"` render as "Ollie set priority to High" with the
Ollie mark as the actor avatar; when the AI acted for a person (`actor.user` set), the line
still names Ollie.

Ollie is an agent loop over tool use (Anthropic tool use; OpenAI-compatible `tools` as the
fallback; a provider without tool support answers `501 ai_unsupported`). It needs a signed-in
user (`kind = user`; API keys get `403`), viewer or above, AI on and `settings.ai.assistant`
on (`403 assistant_off`). Conversations belong to one user in one workspace.

| method | path | credits | body → response |
| --- | --- | --- | --- |
| GET | `/v1/assistant/sessions` | 0 | `?limit` → `{data: Session[]}` (the caller's, newest first) |
| POST | `/v1/assistant/sessions` | 0 | `{title?}` → `Session` |
| GET | `/v1/assistant/sessions/{id}` | 0 | → `{session, items: Item[], approval: Approval \| null}` |
| PATCH | `/v1/assistant/sessions/{id}` | 0 | `{title}` → `Session` |
| DELETE | `/v1/assistant/sessions/{id}` | 0 | → 204 |
| POST | `/v1/assistant/sessions/{id}/messages` | 2 per model turn | `{text /* 1..8000 */, context?: PageContext}` → run (below) |
| POST | `/v1/assistant/actions/{id}/decision` | 2 per model turn | `{decision: "approve" \| "deny", token}` → run |
| GET | `/v1/assistant/tips` | 0 | → `{tips: Tip[]}` (counts only, never the model; 30/min, `Cache-Control: private, max-age=60`) |

```ts
interface Session { id: string; title: string; created_at: string; updated_at: string }
interface PageContext { path?: string; page?: "inbox"|"view"|"ticket"|"contacts"|"kb"|"reports"|"settings"|"other";
  folder?: string; view_id?: string; ticket_id?: string; filters?: Record<string, string> }
interface Step { id: string; tool: string; label: string;
  status: "running"|"done"|"error"|"awaiting_approval"|"approved"|"denied"|"expired";
  summary?: string; refs?: Ref[]; action_id?: string }
interface Ref { kind: "ticket"|"contact"|"article"|"view"|"automation"|"member"; id: string; label: string; number?: number }
interface Preview { title: string; summary?: string; changes?: {field: string; from: string; to: string}[];
  body?: string /* markdown, a reply or note */; targets?: Ref[]; total?: number; external?: boolean /* reaches a customer */ }
interface Approval { action_id: string; call_id: string; tool: string; preview: Preview; token: string; expires_at: string }
interface Item { role: "user"|"assistant"; text: string; steps: Step[]; context?: PageContext }
interface Tip { key: string; text: string; prompt: string; severity: "high"|"medium"|"low"; count: number }
```

A run answers `text/event-stream` when asked (`Accept: text/event-stream`), otherwise one
JSON `{session, text, steps, approval, status}`. Events, in order:

| event | data |
| --- | --- |
| `session` | `Session` (messages only; the title is set from the first message) |
| `text` | `{text}`, a delta of Ollie's markdown |
| `tool` | `Step`, sent when a tool starts and again when it ends (same `id`) |
| `approval` | `Approval` |
| `done` | `{status: "complete" \| "awaiting_approval"}` |
| `error` | problem JSON; the stream ends |

Limits: 30 messages per user per minute (`429`), at most 8 model steps and one write
proposal per run, one run per conversation at a time (`409 assistant_busy`). Credits are
checked before anything is stored (`402 no_credits`).

Tools. Reads run directly; writes only propose. Every tool runs **through the public API
in process, as the user**, so it gets exactly the user's role checks, validation, events
and activities:

- read: `search_tickets`, `get_ticket` (with its thread), `search_contacts`, `search_kb`,
  `list_views` (views and queue counts), `get_report`, `list_labels_and_fields`, `list_team`
  (members and open workload).
- write (agent+): `update_ticket` (assignee, status, priority, labels, fields),
  `bulk_update_tickets` (resolved to exact ticket ids when proposed, at most 50),
  `add_note`, `draft_reply` (sent only on approval; `external: true`), `create_kb_draft`
  (saved as a draft), `create_view` (personal); admin: `create_automation_draft` (saved
  disabled). Tools the user's role cannot use are not offered to the model.

Approvals:
- A write is stored as an `assistant_actions` row (`pending`, 15 minutes) and the client
  gets an `assistant_approval` token (`contracts/tokens.md`) bound to the action, the
  user, the sign-in session and the workspace. The token reaches only the browser,
  never the model, so a run cannot approve itself.
- A decision claims the row atomically (`pending` and not expired), so it runs once
  (`409 approval_not_pending` after); a wrong token is `403 approval_invalid`.
- A new message expires a pending proposal; the model is told it was not made.
- An approved write runs with the user's permissions, attributed `actor_type = "ai"` with
  `actor.user` = the user, and is audit-logged as `assistant.action` (tool and status, not
  content) with `data.actor = "ai"`. POSTs carry the idempotency key `assistant-<action id>`.

Data: tool outputs are wrapped in `<tool_output>` data blocks and the page in a
`<page_context>` block, with the same delimiter escaping as every other feature.
Conversations are stored per user (`assistant_sessions`, `assistant_turns`); usage rows
hold counts only.

## Automations

New automation action `{type: "ai_triage", value: ""}` (1 credit) and condition
`{field: "sentiment", op: "eq" | "equals" | "not_equals", value: Sentiment}` (reads
`custom.ai_sentiment`; `eq` is stored as `equals`). When `settings.ai.auto_triage` is on,
triage runs on `ticket_created` before other automations, so a sentiment condition on the
same trigger sees its result. Auto-triage skips spam and already triaged tickets. When AI is
off, credits ran out or the provider fails, auto-triage and the `ai_triage` action are
skipped (logged) and the rest of the automation runs. The action calls the fast model inside
the trigger's transaction.

## Widget answer bot

When `settings.ai.widget_answers` is on and the KB has published articles:
- A visitor's new chat message gets an AI answer built only from published KB articles
  (retrieval by embeddings, FTS fallback). The answer is posted as a reply with
  `author.type = "system"` and `ai: true` (a new `Message` field, `false` for every other
  message), ends with a list of links to the cited articles, and the widget shows a
  "Talk to a person" action under it. If no article is relevant enough, or the model says
  the articles do not answer the question, or it cites no valid article, it does not answer
  and the ticket stays with the team.
- The bot only answers while the conversation is unassigned, open, not spam, not handed
  off, and no team member has replied; it answers each visitor message at most once and at
  most 3 times per conversation. It runs as a job (`ai.widget_answer`), never in the request.
- A visitor asking for a person ("talk to a human", and the same in a few languages), or the
  model judging that a person is needed, hands the conversation off.
- Visitor `POST /v1/widget/conversations/{id}/handoff` (visitor auth, `204`, idempotent)
  marks the ticket for a human: `custom.ai_handoff = true`, `custom.ai_handoff_at`, activity
  `ai_handoff`, notification type `ai_handoff` to the assignee, else the ticket's team,
  else every non-viewer member, and `ticket.updated` with `["custom"]`.
- 3 credits per posted answer (declines and handoffs are free); when credits run out, the
  bot silently stops. Activity `ai_answered` (`actor_type = "ai"`) records each answer.

## Events

`ai.usage` is not an event. Summaries and triage results arrive through `ticket.updated`
(changes include `"custom"`). Bot answers arrive as normal `message.created`.

## Embeddings

Table `ai_embeddings(workspace_id, kind 'article'|'ticket', ref_id, chunk, content_hash,
embedding vector)`, created only when the `vector` extension is available (Neon and the
self-host `pgvector/pgvector:pg17` image have it; on stock Postgres without it, semantic
search uses FTS). A worker (`ai.embed`) indexes published articles on publish and tickets on
solve. Dimension is fixed per model and recorded; a model change triggers a reindex.

Content is split into chunks of about 800 tokens (3,200 characters) with a 400-character
overlap, split at paragraph, then sentence, then word boundaries; at most 40 chunks per article
and 6 per ticket. Article chunks are prefixed with the title. A ticket document is its
subject, stored summary and public messages. `content_hash` is `sha256(model, text)`;
unchanged content is not re-embedded. Unpublishing or deleting an article removes its rows within seconds (an `ai.embed` job); a deleted
ticket's rows go at the next maintenance run. Embedding models: Voyage `voyage-3.5`, OpenAI
`text-embedding-3-small` (or `EMBEDDINGS_MODEL`).

A periodic job (`ai.maintain`, every 5 minutes) removes rows of other models and of deleted
content, enqueues published articles and tickets solved in the last 90 days that are
missing or stale, and, for workspaces with `auto_summarize`, enqueues `ai.summarize` for
tickets with 5+ messages, quiet for 2 minutes, whose summary is older than the last message.

Search uses brute-force cosine distance per workspace (no ANN index; workspaces are small
enough) fused with full-text results by reciprocal rank (k = 60). Without embeddings, KB
retrieval for drafts and the widget uses FTS with keyword coverage thresholds instead of a
similarity threshold.

## Models and prompts

Drafts, summaries, copilot, KB drafts and widget answers use `AI_MODEL`; triage, rewrite
and translate use `AI_FAST_MODEL`. JSON features use structured outputs on Anthropic and
`json_schema` (falling back to `json_object`, then plain) on OpenAI-compatible endpoints.
System prompts are fixed text and cached (Anthropic prompt caching); workspace guidance
(tone, language, instructions) is a second cached system block; ticket data is the user
turn. Data blocks are XML-like tags whose content has `<` and `>` replaced by `‹` and `›`,
so content cannot close or open a block. Requests time out (90 s, 4 min streaming) and are
retried on 429, 5xx and 529 with backoff honouring `Retry-After`.

