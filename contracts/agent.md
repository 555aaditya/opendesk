# The AI agent (widget), its tools and knowledge

When `settings.ai.widget_answers` is on, the AI is a conversational agent in the chat widget. It
answers visitors from the workspace's knowledge, uses the tools the workspace connects (its own MCP
servers), hands off to the team when it should, and is metered on real usage
(`contracts/billing.md`). This file is the contract for the agent, its tools (MCP connections),
knowledge sources, guardrails, playground and reports, and for opendesk's own MCP server.

Owners: the agent loop, guardrails, actions, ratings, playground and reports live in `internal/ai`
(`widget*.go`, `agent*.go`); MCP connections in `internal/ai/mcp`; knowledge sources in
`internal/ai/knowledge`; the opendesk MCP server in `internal/core/mcpserver`.

## Identity

The agent speaks to visitors under the workspace's bot name (`settings.widget.bot_name`, default
"Ollie") and picture (`widget_bot` image, default the Ollie mark). In the web app its messages,
activities and actions are always Ollie's.

## When it answers

- Every visitor message in a chat conversation the agent is handling gets one reply. It handles a
  conversation while the ticket is open or pending, unassigned, not spam, not handed off and no team
  member has replied. It runs as a job (`ai.widget_answer`, scheduled 1.5 s after the message so a
  burst of quick messages gets one reply about all of them), never in the request. A job whose
  message is no longer the latest visitor message does nothing.
- After `settings.ai.widget_max_replies` replies in one conversation it hands off.
- It stays silent and the conversation waits for the team, as without the agent, when: AI is off,
  credits are out (`no_credits`), the workspace's monthly agent cap is reached
  (`widget_monthly_cap`), or the provider fails after retries.

## What it knows

Each reply is a tool-using model loop (at most 6 model turns per reply) with:
- the conversation: the latest 30 public messages (12,000 characters);
- the top 6 passages for the visitor's latest messages from published KB articles **and** ready
  knowledge sources (below), retrieved up front (embeddings, FTS fallback, the looser draft threshold);
- `widget_instructions`, `widget_blocked_topics`, the workspace's `tone`, `reply_language` and
  `instructions`, the workspace name, the bot name;
- the visitor: name, whether the session is verified (`user_hash`), and the current page URL when the
  widget reports it.

All of it is in data blocks. The agent answers only from that and from tool results: small talk,
clarifying questions and grounded answers. It never invents prices, policies, order details or
promises; it declines blocked topics politely; it offers a person when it cannot help.

Built-in tools (always offered):

| tool | does |
| --- | --- |
| `search_knowledge` `{query}` | more passages from KB articles and knowledge sources (top 6) |
| `handoff_to_human` `{reason}` | ends the agent's part: the reply text so far is posted (a short note that a person will follow up), then the conversation is handed off |

Plus the workspace's enabled MCP tools (below), named `<server_slug>__<tool>` (at most 64
characters, `[a-zA-Z0-9_-]`).

## Output and posting

The final text is plain markdown, streamed. Citations are `[n]` markers naming the n-th passage;
they are removed from the posted text and the cited articles and source pages are listed as links
under the reply (no list when nothing was cited).

The reply is a normal outbound chat message (`author.type = "system"`, `ai: true`, from name = the
bot name), added under the ticket lock only if nothing changed while the model ran (a new visitor
message, an assignee, a team reply, a handoff); otherwise it is discarded. Activity `ai_answered`
(`actor_type = "ai"`, data `{message_id, sources, tools: [tool names called]}`) records each reply.

Streaming: while generating, the job publishes live events (`contracts/realtime.md`, "Live events")
to the visitor and to agents watching the ticket: `ai.reply.started`, `ai.reply.delta` chunks (raw
markdown with `[n]` markers; clients hide them), `ai.reply.tool` while a tool runs, and
`ai.reply.ended` with the posted `message_id` (or `null`), `handoff` and `action_id`. The posted
message also arrives as a normal `message.created` (the source of truth); live events are a preview
and are never replayed.

## Handoff

- A visitor asking for a person ("talk to a human", and the same in a few languages) hands off
  without a model call; the agent calling `handoff_to_human`, or Jev's `needs_human` at 0.8 or above,
  hands off with a short reply.
- Visitor `POST /v1/widget/conversations/{id}/handoff` (visitor auth, `204`, idempotent; the widget
  offers "Talk to a person" while the agent is handling the conversation) marks the ticket for a
  human: `custom.ai_handoff = true`, `custom.ai_handoff_at`, activity `ai_handoff`, notification type
  `ai_handoff` to the assignee, else the ticket's team, else every non-viewer member, and
  `ticket.updated` with `["custom"]`. The widget learns of a handoff from `ai.reply.ended` or from
  `ai_handoff` on the conversation.

## Visitor actions (confirm before acting)

An MCP tool whose policy is `confirm` is never run by the model alone. When the agent calls it, the
loop stops and the reply is posted with an action card the visitor confirms or declines:

```ts
// On Message (contracts/api.md), public, set only on the agent's messages that carry one:
ai_action: { id: string; title: string /* from the tool's title, else its name */; summary: string /* the agent's one-line description of what will happen */;
  status: "pending" | "confirmed" | "declined" | "expired" | "failed"; tool: string /* display name */ } | null
```

- `POST /v1/widget/conversations/{id}/actions/{action_id}` (visitor auth) `{decision: "confirm" |
  "decline"}` → `204`. It claims the pending action atomically (`409 action_not_pending` after;
  actions expire after 15 minutes or when the visitor writes again). Confirm runs the tool with the
  stored arguments, then the agent continues with the result as a new reply; decline continues with
  "the visitor declined". Either way the action's message is updated (`message.updated`, public, on
  the contact topic too) with the new status. Audit `ai.action` (tool and status, not arguments).
- Arguments are stored encrypted (`d.Box`) in `ai_widget_actions` and never shown to the visitor
  beyond the summary.

## Ratings

Visitors may rate each agent reply: `POST /v1/widget/conversations/{id}/messages/{message_id}/rating`
(visitor auth) `{rating: "up" | "down" | null}` → `204` (null clears). Only `ai: true` messages of
that conversation (`404` otherwise). Stored on the message as `ai_rating` (the visitor sees their own
rating, agents see it in the thread) and published as `message.updated` (public, on the contact
topic too).

## Guardrails (`settings.ai`, `PATCH /v1/ai/settings`)

```ts
widget_blocked_topics: string[]   // at most 20, each 2..100 chars of plain text: topics the agent declines
widget_monthly_cap: number        // credits per calendar month (UTC) the agent may use (features answer, answer_check, agent tools); 0 = no cap; 0..1,000,000
widget_collect_email: boolean     // when the visitor has no email, the agent asks for one before handing off, default true
```

The cap counts usage rows of the agent's features this month. Reaching it stops the agent (silent,
the team takes over) and sends one notification `ai_cap_reached` per month to owners and admins.

## Playground (admin)

`POST /v1/ai/agent/playground` tests the agent without a visitor or a ticket.

```ts
// Body
{ messages: { role: "visitor" | "agent"; text: string }[] /* 1..40, the last is the visitor's, each up to 4,000 chars */;
  settings?: Partial<Pick<AISettings, "widget_model" | "widget_instructions" | "widget_blocked_topics" | "tone" | "reply_language" | "instructions">> /* unsaved drafts */;
  visitor?: { name?: string; email?: string; verified?: boolean; user_id?: string } }
```

It answers `text/event-stream`: `delta {text}`, `tool {name, status: "running" | "done" | "error",
summary}`, `sources {sources: Source[]}`, then `done {text_html, sources, handoff: boolean, action:
{tool, title, summary} | null, credits: number}`, or `error` (problem JSON). Read-only MCP tools run
for real (with the given visitor in `_meta`); any other tool is not run and comes back as `action`.
Metered as feature `playground` (typical 3 credits per reply, counted toward nothing else).
Rate limited to 30 per user per minute.

```ts
interface Source { kind: "article" | "page" | "file" | "snippet"; id: string; title: string; url: string | null }
```

## Report (admin)

`GET /v1/ai/agent/report?from&to` (admin, `settings:read`; same range rules as `/v1/billing/usage`, default the last
30 days) →

```ts
{ from: string; to: string;
  conversations: number          // chat conversations the agent replied in
  replies: number
  resolved: number               // of those, solved or closed with no team member reply
  handoffs: number
  ratings: { up: number; down: number }
  credits: number                // features answer, answer_check and agent tools
  by_day: { date: string; conversations: number; replies: number; resolved: number; handoffs: number }[]
  tools: { tool: string; calls: number; errors: number }[]
  gaps: { question: string; count: number }[]  // up to 20 recent visitor questions the agent handed off or could not answer, newest first (first 200 chars)
}
```

## MCP connections (company tools)

A workspace connects its own remote MCP servers; their tools become the agent's tools. Transport:
MCP Streamable HTTP (protocol `2025-06-18` or newer, negotiated), falling back to the legacy
HTTP+SSE transport. Admin only (`settings:write` for API keys).

```ts
interface McpServer {
  id: string; name: string /* 1..60 */; slug: string /* from name, unique per workspace, used in tool names */
  url: string                    // https (http only on a development instance)
  enabled: boolean
  auth: { kind: "none" | "bearer" | "header" | "oauth"; header_name?: string; has_secret: boolean;
          oauth?: { connected: boolean; scopes: string[]; expires_at: string | null } }
  status: "connected" | "needs_auth" | "error" | "connecting"
  error: string | null           // a fixed, safe message (never the server's body)
  server_info: { name: string; version: string } | null
  tools: McpTool[]
  last_synced_at: string | null; created_at: string; updated_at: string
}
interface McpTool {
  name: string; title: string | null; description: string /* up to 1,000 chars shown */
  input_schema: Record<string, unknown>
  read_only: boolean             // from annotations.readOnlyHint
  destructive: boolean           // annotations.destructiveHint
  enabled: boolean               // default: true for read-only tools, false otherwise
  policy: "auto" | "confirm"     // default: auto for read-only tools, confirm otherwise
  verified_only: boolean         // offered only in verified widget sessions, default false
}
```

| method | path | body → response |
| --- | --- | --- |
| GET | `/v1/ai/mcp-servers` | → `{data: McpServer[]}` |
| POST | `/v1/ai/mcp-servers` | `{name, url, auth: {kind, token? /* bearer */, header_name?, header_value? /* header */}}` → `McpServer` (connects and lists tools; an OAuth-protected server answers `status: "needs_auth"`) |
| PATCH | `/v1/ai/mcp-servers/{id}` | `{name?, url?, enabled?, auth?, tools?: Record<string, Partial<Pick<McpTool, "enabled" \| "policy" \| "verified_only">>>}` → `McpServer` |
| DELETE | `/v1/ai/mcp-servers/{id}` | → 204 (revokes OAuth tokens when the server supports revocation) |
| POST | `/v1/ai/mcp-servers/{id}/sync` | → `McpServer` (reconnect, list tools again; tool settings are kept by name) |
| POST | `/v1/ai/mcp-servers/{id}/oauth/start` | → `{url}`: the authorization URL (browser redirect) |
| GET | `/v1/ai/mcp-servers/oauth/callback` | `?state&code` → 302 `APP_URL/settings/ai/tools?connected=<id>` or `?error=<code>` |
| POST | `/v1/ai/mcp-servers/{id}/tools/{name}/test` | `{arguments: object, visitor?: {...}}` → `{content: string, is_error: boolean, ms: number}` (runs the tool once, any policy) |

- Secrets (bearer token, header value, OAuth client secret, access and refresh tokens) are encrypted
  with `d.Box` and never returned. `header_name` must be a valid token and not a hop-by-hop or
  `Host`/`Cookie`/`Content-*` header.
- OAuth follows the MCP authorization spec: protected resource metadata (RFC 9728) from the 401
  `WWW-Authenticate` or `/.well-known/oauth-protected-resource`, authorization server metadata
  (RFC 8414 / OIDC discovery), dynamic client registration (RFC 7591) when no client is configured,
  authorization code with PKCE (S256) and the `resource` parameter (RFC 8707), redirect URI
  `API_URL/v1/ai/mcp-servers/oauth/callback`, state bound to the server, the admin and the workspace
  (10 minutes, single use). Access tokens refresh automatically; a failed refresh sets `needs_auth`.
- Every outbound request (server, metadata, token endpoints) uses the SSRF guard (`internal/netsafe`):
  https, no private, loopback or link-local targets (re-checked per redirect, at most 3), except on a
  development instance. Calls time out after 20 s (listing 15 s); responses over 1 MB are refused;
  tool output given to the model is the text content, truncated to 8,000 characters, inside a
  `<tool_output>` data block.
- Each tool call sends `_meta: {"opendesk/visitor": {verified, user_id?, email?, name?, contact_id,
  conversation_id}, "opendesk/workspace": {id, name}}`. Only `verified: true` sessions carry
  `user_id`/`email` from the verified identity; MCP servers should trust identity only from there,
  never from tool arguments. Tools with `verified_only` are not offered in unverified sessions.
- Changes are audit-logged (`ai.mcp_server_created`, `_updated`, `_deleted`, `_connected`,
  `_disconnected`; never secrets) and publish `ai_mcp_server.created` / `.updated` / `.deleted`
  (agents, data `{mcp_server: McpServer}` / `{mcp_server_id}`).
- At most 10 servers per workspace and 64 enabled tools in total, counted over every server
  (`422 limit_reached`). Tool lists are re-synced hourly (periodic `ai.mcp_sync`, which publishes
  `ai_mcp_server.updated` only when something changed) and on demand. A new read-only tool starts
  enabled only while the workspace is under the tool limit.
- The slug is set at creation from the name: lowercase letters, digits and `_`, at most 24
  characters, `_2`, `_3`… when taken. `POST` answers `201`.
- Errors: `422 invalid_url`, `422 unknown_tool` (a tool name in a PATCH that the server does not
  list); `oauth/start` answers `409 not_oauth`, `403` for API keys (it needs a person in a
  browser), and `422` `discovery_failed`, `pkce_unsupported`, `registration_unsupported` or
  `registration_failed`. The callback's `?error=` is one of `oauth_state`, `access_denied`,
  `forbidden`, `not_found`, `provider_error`, `internal`.
- A server with no auth that answers `401` with a Bearer challenge (or none) becomes `kind:
  "oauth"`, `needs_auth`. `connecting` is not visible: creating a server connects before saving.
- The OAuth `state` is single use and is also bound to the starting browser by an HttpOnly cookie
  (`od_mcp_oauth`, path `/v1/ai/mcp-servers/oauth`), so `oauth/start` is called with credentials.
  The callback checks that the user is still an admin, the server URL is unchanged, and the
  RFC 9207 `iss` when sent. Requests to registration, token and revocation endpoints never follow
  redirects; credentials are sent only to the server's own origin. Audit entries record the URL's
  host only.
- Tool calls are metered only through the model turns around them. Each call of a visitor
  conversation is recorded in `ai_tool_calls` (tool display name, ok, duration; never arguments or
  results) for the report; playground calls are not recorded.

## Knowledge sources

Besides KB articles, the agent (and drafts and copilot) answer from knowledge sources:

```ts
interface KnowledgeSource {
  id: string; kind: "website" | "file" | "snippet"; name: string /* 1..100 */
  status: "pending" | "syncing" | "ready" | "error"; error: string | null
  enabled: boolean                       // used for answers, default true
  website?: { url: string; max_pages: number /* 1..500, default 100 */; include: string[]; exclude: string[] /* path prefixes, at most 20 each */; recrawl: "off" | "weekly" }
  file?: { filename: string; content_type: string; size_bytes: number }
  snippet?: { question: string /* 3..300 */; answer: string /* 1..4,000, markdown */ }
  doc_count: number; char_count: number; last_synced_at: string | null; created_at: string; updated_at: string
}
interface KnowledgeDoc { id: string; title: string; url: string | null; chars: number; updated_at: string }
```

| method | path | body → response |
| --- | --- | --- |
| GET | `/v1/ai/knowledge` | `?kind` → `{data: KnowledgeSource[]}` |
| POST | `/v1/ai/knowledge` | `{kind: "website", name?, website}` or `{kind: "snippet", name?, snippet}` → `KnowledgeSource` (a website starts syncing) |
| POST | `/v1/ai/knowledge/files` | multipart `file` (PDF, DOCX, TXT, Markdown, HTML, CSV; 20 MB) and `name?` → `KnowledgeSource` |
| GET | `/v1/ai/knowledge/{id}` | → `KnowledgeSource` |
| PATCH | `/v1/ai/knowledge/{id}` | `{name?, enabled?, website?, snippet?}` → `KnowledgeSource` |
| DELETE | `/v1/ai/knowledge/{id}` | → 204 (documents and embeddings removed) |
| POST | `/v1/ai/knowledge/{id}/sync` | → `KnowledgeSource` (re-crawl or re-extract; `409` while syncing) |
| GET | `/v1/ai/knowledge/{id}/docs` | `?cursor&limit` → `{data: KnowledgeDoc[], next_cursor}` |
| DELETE | `/v1/ai/knowledge/{id}/docs/{doc_id}` | → 204 (excluded from future crawls of that source) |

Admin only for writes, viewer for reads (`settings:read` / `settings:write`); the routes work while
AI is off, so sources can be prepared first. Limits for every workspace: 50 sources, 5,000
documents, 20 million characters (`422 knowledge_limit`). `recrawl` defaults to `weekly`.

A source answers once it has synced at least once (`last_synced_at` set) and is enabled, so a
website stays answerable during its weekly recrawl. Long files are split into documents of 100,000
characters ("name (part n of m)"); page text is cut at 100,000 characters. A document whose
embedding failed stays searchable by full text and is retried by the hourly upkeep job
(`ai.knowledge_maintain`).

- Website crawl (job `ai.knowledge_sync`): same origin as `url` (and its `www.` twin), `robots.txt`
  honoured for user agent `opendeskBot`, `sitemap.xml` first, then links breadth-first, `include` /
  `exclude` path prefixes, at most `max_pages` pages, one request per second per host, 10 s timeout,
  2 MB per page, HTML and plain text only. Each page's main text is extracted (scripts, styles,
  navigation, headers, footers and cookie banners dropped) with its `<title>`. SSRF guarded like
  MCP. User agent `opendeskBot/1.0 (+https://opendesk.sh/bot)`. `recrawl: "weekly"` re-syncs
  weekly (periodic job); unchanged pages (same `content_hash`) are not re-embedded.
- Files are stored like attachments (`internal/storage`), text extracted in the job (PDF text
  layer, DOCX paragraphs, CSV rows as lines); a file with no extractable text ends in `error`
  ("No text found in this file").
- Snippets are one document each (the question as title).
- Documents are chunked and embedded like articles (`ai_embeddings` kind `source`, ref = doc id),
  with an FTS fallback; disabling a source excludes it from retrieval at once. Indexing is not
  charged.
- Status changes publish `ai_knowledge.updated` (agents, `{source: KnowledgeSource}`), plus
  `.created` / `.deleted`. Creating and deleting are audit-logged (`ai.knowledge_created`,
  `ai.knowledge_deleted`).

## opendesk MCP server

opendesk itself is an MCP server, so AI clients (Claude, Cursor, VS Code, any MCP client) can work
the helpdesk: `POST {API_URL}/mcp` (Streamable HTTP, stateless, JSON responses; `GET` and `DELETE`
answer `405`, as the spec allows for a server without sessions). Auth: `Authorization: Bearer <API key>` (`contracts/api.md` API keys); every tool runs
through the public API in process as that key, so it gets exactly the key's scopes, role checks,
validation, events, activities and audit entries. Writes are attributed to the key as usual.

Tools (offered only when the key has the scope):

| tool | scope | does |
| --- | --- | --- |
| `search_tickets` | `tickets:read` | filters (status, assignee, team, label, priority, text, dates), at most 50 |
| `get_ticket` | `tickets:read` | a ticket with its thread (notes included) |
| `reply_to_ticket` | `tickets:write` | a public reply (`body` markdown) |
| `add_note` | `tickets:write` | an internal note |
| `update_ticket` | `tickets:write` | status, priority, severity, assignee, team, labels |
| `create_ticket` | `tickets:write` | a ticket for a contact email |
| `search_contacts` / `get_contact` | `contacts:read` | |
| `search_knowledge` | `kb:read` | KB articles and knowledge sources |
| `create_kb_draft` | `kb:write` | a draft article |
| `get_report` | `tickets:read` | the overview report for a range |

Tool annotations mark read-only and destructive tools. Output is JSON text. No `Mcp-Session-Id` is
issued. The server checks `Origin` (browser requests must come from
`CORS_ORIGINS`), is rate limited like the API, and answers `401` with
`WWW-Authenticate: Bearer` without a valid key. Clients that only speak OAuth (the Claude app's
connectors) connect through the `mcp-remote` bridge with the key as a header.
