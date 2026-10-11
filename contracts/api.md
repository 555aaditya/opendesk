# REST API (`api.opendesk.sh/v1`)

The web app uses exactly this public API. The Go server (huma v2) generates the
OpenAPI 3.1 spec at `GET /v1/openapi.json`; that spec is the source of truth once
it exists, and this file is the contract the parts are built against.

## Conventions

- JSON, `snake_case`, timestamps RFC 3339 UTC, ids are UUID strings.
- Errors: RFC 9457 problem+json `{ "status", "title", "detail", "code"?, "errors"? }`.
  `code` is a stable machine string (`invalid_credentials`, `mfa_required`, `forbidden`,
  `not_found`, `conflict`, `rate_limited`, `validation_failed`).
- Responses carry no `$schema` member, so a client can send an object it read back as a PATCH
  body; request bodies refuse unknown members (`422 validation_failed`).
- Lists: `?limit=` (default 50, max 100) and `?cursor=`; response
  `{ "data": [...], "next_cursor": "..." | null }`.
- Workspace-scoped routes need `OD-Workspace: <id>` (agents) or an API key.
- PATCH bodies: an omitted or `null` member is left unchanged. Clear an optional reference with `""`
  (mailbox `team_id`, KB article `collection_id`) unless the route documents `null` (ticket PATCH, contact `company_id`).
- Idempotency: `Idempotency-Key` header on POST create routes (24h).
- Rate limits: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers.
- Roles: `owner` > `admin` > `agent` > `viewer`. Viewers read only. Settings routes
  (mailboxes, members, api keys, webhooks, automations, sla, widget settings) need `admin`.
- API key scopes: `tickets:read`, `tickets:write`, `contacts:read`, `contacts:write`,
  `kb:read`, `kb:write`, `settings:read`, `settings:write`, `realtime`.

## Resource shapes

```ts
type User = { id: string; email: string; name: string; avatar_url: string; email_verified: boolean; totp_enabled: boolean; created_at: string };
type UserRef = { id: string; name: string; email: string; avatar_url: string };
type Workspace = { id: string; name: string; slug: string; widget_key: string; settings: WorkspaceSettings; created_at: string };
type WorkspaceSettings = { brand_color?: string; timezone?: string; help_center_enabled?: boolean; help_center_title?: string; csat_enabled?: boolean; auto_assign?: "none" | "round_robin"; locale?: string /* BCP 47 default for customer-facing pages (help center, CSAT, widget); "" = the visitor's browser */ };
type Membership = { workspace: Workspace; role: Role };
type Role = "owner" | "admin" | "agent" | "viewer";
type Member = { user: UserRef; role: Role; created_at: string };
type Invitation = { id: string; email: string; role: Role; expires_at: string; created_at: string; invited_by: UserRef | null };
type Team = { id: string; name: string; member_ids: string[]; created_at: string };

type Contact = { id: string; email: string | null; name: string; phone: string; avatar_url: string; company: CompanyRef | null; external_id: string | null; notes: string; custom: Record<string, unknown>; blocked: boolean; ticket_count: number; created_at: string; updated_at: string };
type ContactRef = { id: string; email: string | null; name: string; avatar_url: string };
type Company = { id: string; name: string; domain: string; notes: string; custom: Record<string, unknown>; contact_count: number; created_at: string; updated_at: string };
type CompanyRef = { id: string; name: string; domain: string };

type TicketStatus = "open" | "pending" | "on_hold" | "solved" | "closed";
type Priority = "low" | "normal" | "high" | "urgent";
type Channel = "email" | "chat" | "api" | "portal";
type Ticket = {
  id: string; number: number; subject: string; status: TicketStatus; priority: Priority; channel: Channel;
  mailbox_id: string | null; contact: ContactRef | null; assignee: UserRef | null; team_id: string | null;
  tags: Tag[]; sla: { policy_id: string; first_response_due_at: string | null; resolution_due_at: string | null; breached: boolean } | null;
  first_responded_at: string | null; solved_at: string | null; snoozed_until: string | null;
  last_message_at: string; last_customer_message_at: string | null; last_message_preview: string; message_count: number;
  spam: boolean; csat: { score: number; comment: string } | null; custom: Record<string, unknown>;
  created_at: string; updated_at: string;
};
type Message = {
  id: string; ticket_id: string; kind: "reply" | "note"; direction: "inbound" | "outbound";
  author: { type: "contact" | "user" | "system" | "api"; user: UserRef | null; contact: ContactRef | null };
  body_html: string; body_text: string; has_quoted: boolean; subject: string;
  from_email: string; from_name: string; to: string[]; cc: string[]; bcc: string[];
  attachments: Attachment[]; delivery_status: "none" | "pending" | "sent" | "failed" | "bounced"; delivery_error: string;
  ai: boolean; // an automatic answer from the widget answer bot (contracts/ai.md)
  created_at: string;
};
type Attachment = { id: string; filename: string; content_type: string; size_bytes: number; inline: boolean; url: string };
type Activity = { id: string; ticket_id: string; actor: { type: string; user: UserRef | null }; type: string; data: Record<string, unknown>; created_at: string };
// activity types: status_changed{from,to} priority_changed{from,to} assigned{from,to} team_changed tagged{tag} untagged{tag} sla_breached{kind} merged{into} csat_received{score}
// AI (actor.type "ai", contracts/ai.md): ai_triaged{category,sentiment,language,priority,via} ai_answered{message_id,article_ids} ai_handoff (actor "ai" or "contact")
type Tag = { id: string; name: string };
type SavedReply = { id: string; title: string; shortcut: string; body_html: string; created_at: string; updated_at: string };
type View = { id: string; name: string; shared: boolean; filters: TicketFilters; position: number };
type TicketFilters = { status?: TicketStatus[]; priority?: Priority[]; assignee?: "me" | "none" | string; team_id?: string; mailbox_id?: string; tag?: string; channel?: Channel; q?: string };
type SlaPolicy = { id: string; name: string; priority: Priority | null; first_response_minutes: number; resolution_minutes: number; enabled: boolean; position: number };
type Automation = { id: string; name: string; trigger: "ticket_created" | "customer_replied" | "agent_replied" | "ticket_updated"; conditions: Condition[]; actions: Action[]; enabled: boolean; position: number; run_count: number };
type Condition = { field: "subject" | "body" | "from_email" | "channel" | "mailbox_id" | "priority" | "status" | "tag" | "sentiment"; op: "contains" | "not_contains" | "equals" | "not_equals" | "eq"; value: string }; // sentiment: equals/not_equals only; eq = equals
type Action = { type: "set_status" | "set_priority" | "assign_user" | "assign_team" | "add_tag" | "remove_tag" | "send_reply" | "add_note" | "mark_spam" | "ai_triage"; value: string };
type Mailbox = {
  id: string; name: string; email: string; display_name: string;
  inbound_kind: "forwarding" | "imap" | "google" | "microsoft"; outbound_kind: "smtp" | "google" | "microsoft" | "system";
  forwarding_address: string; config: { imap_host?: string; imap_port?: number; imap_username?: string; imap_tls?: "tls" | "starttls" | "none"; smtp_host?: string; smtp_port?: number; smtp_username?: string; smtp_tls?: "tls" | "starttls" | "none"; oauth_email?: string };
  team_id: string | null; signature_html: string; auto_reply_enabled: boolean; auto_reply_subject: string; auto_reply_html: string;
  status: "active" | "error" | "disabled"; last_error: string; last_synced_at: string | null; created_at: string;
};
type KbCollection = { id: string; name: string; slug: string; description: string; position: number; article_count: number };
type KbArticle = { id: string; collection_id: string | null; title: string; slug: string; excerpt: string; body_html: string; status: "draft" | "published"; author: UserRef | null; views: number; published_at: string | null; updated_at: string };
type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; last_used_at: string | null; expires_at: string | null; created_at: string; created_by: UserRef | null };
type Webhook = { id: string; url: string; description: string; events: string[]; enabled: boolean; created_at: string };
type WebhookDelivery = { id: string; event_id: string; event_type: string; status: "pending" | "succeeded" | "failed"; attempts: number; response_code: number | null; duration_ms: number | null; created_at: string };
type AuditLog = { id: string; actor: { type: "user" | "api_key" | "system"; user: UserRef | null; api_key_id: string | null }; action: string; entity_type: string; entity_id: string | null; data: Record<string, unknown>; ip: string; created_at: string };
type Notification = { id: string; type: "assigned" | "mentioned" | "customer_replied" | "sla_breached" | "ai_handoff"; ticket: { id: string; number: number; subject: string } | null; data: Record<string, unknown>; read_at: string | null; created_at: string };
// Notification.data: assigned {by, actor_type, actor?: {id, name}}; mentioned {message_id, by, actor?: {id, name}, preview};
// customer_replied {message_id?, preview?, contact?: {id, name}}; sla_breached {kind}; ai_handoff {via: "ai" | "contact", contact?: {id, name}}.
// Mentions in note HTML: <span data-type="mention" data-id="<user_id>">@Name</span> (also data-mention="<user_id>"), or "@<full name or email>" in text.
```

## Endpoints

### Auth and account (owner: backend-core)
| method | path | body → response |
| --- | --- | --- |
| GET | `/v1/auth/config` | → `{ providers: [{id:"google"|"microsoft"|"github"|"oidc", name}], password_login: bool, signup_enabled: bool, turnstile_site_key: string \| null }` |
| POST | `/v1/auth/register` | `{email,password,name,turnstile_token?,invite_token?}` → `{access_token, expires_in, user}` + refresh cookie. `409 email_taken`. With signup off, only a valid `invite_token` for the same email may register (`403 signup_disabled`); an invite token also marks the email verified |
| POST | `/v1/auth/login` | `{email,password,turnstile_token?}` → `{access_token, expires_in, user}` or `{mfa_required:true, mfa_token}` |
| POST | `/v1/auth/mfa` | `{mfa_token, code}` → `{access_token, expires_in, user, redirect_to?}`. `code` is a 6-digit TOTP code or a recovery code (`xxxx-xxxx-xxxx-xxxx`) |
| POST | `/v1/auth/refresh` | cookie → `{access_token, expires_in, user}` (rotates refresh) |
| POST | `/v1/auth/logout` | → 204, revokes session, closes sockets |
| POST | `/v1/auth/password/forgot` | `{email, turnstile_token?}` → 204 always |
| POST | `/v1/auth/password/reset` | `{token,password}` → 204 |
| POST | `/v1/auth/email/verify` | `{token}` → 204 |
| POST | `/v1/auth/email/resend` | → 204 |
| GET | `/v1/auth/oauth/{provider}/start?redirect_to=` | → 302 to provider. `redirect_to` is the app path to land on after sign-in (e.g. `/inbox/mine`), returned by exchange/link; the callback itself always goes to `/auth/callback` |
| GET | `/v1/auth/oauth/{provider}/callback` | → 302 to `APP_URL/auth/callback?code=<one-time>` or `?error=` |
| POST | `/v1/auth/oauth/exchange` | `{code}` → `{access_token, expires_in, user, redirect_to?}` or `{mfa_required, mfa_token, redirect_to?}` or `{link_required: true, link_token, email, redirect_to?}` when the provider's verified email belongs to an existing password account |
| POST | `/v1/auth/oauth/link` | `{link_token, password}` → same as exchange (tokens or `mfa_required`). Binds the provider identity after the account password is presented; `401 invalid_credentials` on a wrong password (the link token stays usable for 10 min) |
| POST | `/v1/auth/totp/setup` | → `{secret, otpauth_url}` |
| POST | `/v1/auth/totp/enable` | `{code}` → `{recovery_codes: string[]}` |
| POST | `/v1/auth/totp/disable` | `{code}` → 204 |
| GET | `/v1/me` | → `{user: User, memberships: Membership[]}` |
| PATCH | `/v1/me` | `{name?, avatar_url?}` → `User` |
| POST | `/v1/me/password` | `{current_password, new_password}` → 204 |
| GET | `/v1/me/sessions` / DELETE `/v1/me/sessions/{id}` | paginated `[{id, user_agent, ip, created_at, last_used_at, current}]` / revoke |
| DELETE | `/v1/me` | `{password?, code?}` → 204. `password` when the account has one, `code` when 2FA is on. Deletes the account and every workspace it solely owns (`409 sole_owner` while owner of a workspace with other members) |

### Workspace (owner: backend-core)
| method | path | notes |
| --- | --- | --- |
| POST | `/v1/workspaces` | `{name}` → `Workspace` (caller becomes owner; seeds default views, tags, SLA) |
| GET/PATCH | `/v1/workspace` | current workspace (`OD-Workspace`) `{name?, settings?}` |
| DELETE | `/v1/workspace` | owner + MFA, `{confirm_name}` → 204, removes all workspace data |
| POST | `/v1/workspace/transfer` | owner + MFA, `{user_id}` |
| POST | `/v1/workspace/widget-secret/rotate` | admin → `{secret}` (shown once) |
| GET | `/v1/members` · PATCH/DELETE `/v1/members/{user_id}` | `{role}` |
| GET/POST | `/v1/invitations` · DELETE `/v1/invitations/{id}` | `{email, role}` |
| POST | `/v1/invitations/accept` | `{token}` → `Membership` (no workspace header) |
| GET | `/v1/invitations/lookup?token=` | → `{workspace_name, email, role}` public |
| CRUD | `/v1/teams`, `/v1/teams/{id}` | `{name, member_ids}` |
| CRUD | `/v1/api-keys`, `/v1/api-keys/{id}` | admin users only (not API keys). create `{name, scopes, expires_at?}` → `ApiKey & {secret}` (`secret` shown once; `prefix` is `od_live_` + 8 chars); PATCH `{name}`; DELETE revokes |
| CRUD | `/v1/webhooks`, `/v1/webhooks/{id}` | `{url, description, events, enabled}` create → `Webhook & {secret}`. `events: ["*"]` (or `[]`) is every event, including types added later; a list may use `resource.*` |
| GET | `/v1/webhooks/{id}/deliveries` | list |
| POST | `/v1/webhooks/{id}/test` | sends `webhook.test` → 202 `WebhookDelivery` |
| GET | `/v1/audit-logs` | admin, list, optional `?action=&entity_type=` |
| GET | `/v1/events?since=<seq>&limit=` | `limit` default 500, max 1000 → `{data: Envelope[], latest_seq, resync: bool}`. Members, and API keys with `realtime` or `tickets:read` |
| POST | `/v1/realtime/token` | → `{token, url, expires_at}` (users and keys with `realtime`) |
| GET | `/v1/notifications?unread=` · POST `/v1/notifications/read` | `{ids?: string[], all?: bool}` → 204. Rows are created by helpdesk (assigned, mentioned, customer_replied, sla_breached, ai_handoff) with a `notification.created` event to `user:<uid>` |

Core notes:
- App links in system email: `/verify?token=`, `/reset?token=`, `/invite?token=` on `APP_URL`.
- `401` with `code: "unauthenticated"` means the access token is missing or expired (refresh and retry); other
  401 codes (`invalid_credentials`, `invalid_code`) answer the request itself and must not trigger a refresh.
- OAuth: `start` sets an `od_oauth` binding cookie (Path=`/v1/auth/oauth`) and an `oauth_state` JWT (`data.flow = "login"`).
  Callback errors: `access_denied`, `invalid_state`, `invalid_request`, `provider_error`, `provider_unavailable`,
  `email_unverified`, `signup_disabled`, `server_error`. A first sign-in needs a provider-verified email (GitHub: verified
  primary; Microsoft: personal account or the `xms_edov` claim).
- Owner-level operations (`DELETE /v1/workspace`, `/v1/workspace/transfer`, `/v1/workspace/widget-secret/rotate`,
  `/v1/auth/totp/disable`) answer `403 mfa_required` when 2FA is on but this session did not pass it, and
  `403 reauth_required` when the session is older than 12 hours (sign in again).
- Member rules: owners change and remove anyone but themselves; admins manage agents and viewers; only the owner grants
  `admin`; `owner` moves only by transfer. `DELETE /v1/members/{own id}` leaves (owner: `409 owner_cannot_leave`).
- `POST /v1/invitations/accept` needs the signed-in user's email to equal the invited one (`403 invitation_email_mismatch`).
- Role and list endpoints for API keys: workspace/members/teams read `settings:read`; writes `settings:write`.

### Helpdesk (owner: backend-helpdesk)
| method | path | notes |
| --- | --- | --- |
| GET | `/v1/tickets` | filters: `status` (csv), `priority` (csv), `assignee` (`me`/`none`/uuid), `team_id`, `mailbox_id`, `tag`, `channel`, `contact_id`, `view_id`, `q`, `spam`, `sort` (`last_message_at`/`created_at`/`priority`/`due`), `order` |
| GET | `/v1/tickets/counts` | → `{ unassigned, mine, open, pending, on_hold, solved, spam, views: {<view_id>: n} }` |
| POST | `/v1/tickets` | `{subject, contact_id? , contact?: {email,name}, channel?: "email"\|"api", mailbox_id?, body_html, kind?: "reply"\|"note", priority?, assignee_id?, team_id?, tags?: string[], status?}`; an email ticket with a reply is sent to the contact |
| GET | `/v1/tickets/{id}` | id is uuid, or `#<number>` / numeric number |
| PATCH | `/v1/tickets/{id}` | `{subject?, status?, priority?, assignee_id?, team_id?, snoozed_until?, spam?, tags?: string[] /* replaces */, add_tags?: string[], remove_tags?: string[], custom?}`. Setting `snoozed_until` without a `status` moves the ticket to `on_hold`; a status change that is not `on_hold` clears the snooze |
| DELETE | `/v1/tickets/{id}` | soft delete |
| POST | `/v1/tickets/bulk` | `{ids, patch: {...PATCH body}}` or `{ids, delete: true}` |
| POST | `/v1/tickets/{id}/merge` | `{into_id}` |
| GET | `/v1/tickets/{id}/messages` | ascending, all |
| POST | `/v1/tickets/{id}/messages` | `{kind: "reply"\|"note", body_html, cc?, bcc?, attachment_ids?, status?: TicketStatus}` → `Message` |
| GET | `/v1/tickets/{id}/activities` | ascending |
| GET | `/v1/messages/{id}/original` | → `{full_html}` quoted history / raw view |
| CRUD | `/v1/contacts`, `/v1/contacts/{id}` | list supports `q`, `company_id` |
| GET | `/v1/contacts/{id}/tickets` | list |
| CRUD | `/v1/companies`, `/v1/companies/{id}` | |
| CRUD | `/v1/tags`, `/v1/tags/{id}` | |
| CRUD | `/v1/saved-replies` | |
| CRUD | `/v1/views` | `{name, filters, shared}` |
| CRUD | `/v1/sla-policies` | |
| CRUD | `/v1/automations` | |
| CRUD | `/v1/kb/collections`, `/v1/kb/articles` | articles list supports `collection_id`, `status`, `q` |
| GET | `/v1/search?q=` | → `{tickets: Ticket[], contacts: Contact[], articles: KbArticle[]}` (5 each) |
| GET | `/v1/reports/overview?from=&to=` | → `{created, solved, open_now, first_response_p50_minutes, resolution_p50_minutes, csat_avg, csat_count, sla_breached, by_day: [{date, created, solved}], by_channel: {...}, by_agent: [{user, solved, first_response_p50_minutes}]}` |
| POST | `/v1/attachments` | multipart `file` → `Attachment` (unattached, linked when sent) |
| GET | `/v1/attachments/{id}` | → 302 to signed URL or streamed (`?token=` for img tags) |

### Public, no auth (owner: backend-helpdesk)
| method | path | notes |
| --- | --- | --- |
| GET | `/v1/public/help/{workspace_slug}` | `{title, collections: KbCollection[], featured: KbArticle[], locale}` published only |
| GET | `/v1/public/help/{workspace_slug}/collections/{slug}` | `{collection, articles}` |
| GET | `/v1/public/help/{workspace_slug}/articles/{slug}` | `KbArticle`, increments views |
| GET | `/v1/public/help/{workspace_slug}/search?q=` | `KbArticle[]` |
| GET/POST | `/v1/public/csat/{token}` | GET → `{workspace_name, brand_color, ticket: {number, subject}, score: number \| null, comment, locale}`; POST `{score: 1..5, comment?}` records the score and answers the same survey object |

### Widget (owner: backend-helpdesk; `Authorization: Visitor <token>` except session)
| method | path | notes |
| --- | --- | --- |
| GET | `/v1/widget/config?key=<widget_key>` | `{workspace_name, brand_color, greeting, help_center_url, require_email, locale}` |
| POST | `/v1/widget/session` | `{key, visitor_token?, email?, name?, user_id?, user_hash?}` → `{visitor_token, contact: ContactRef, ws_token, gateway_url}`; `user_hash` = hex HMAC-SHA256(widget_secret, user_id) marks the session verified |
| GET | `/v1/widget/conversations` | visitor's chat tickets `{id, subject, status, last_message_preview, last_message_at, ai_handoff}` (`ai_handoff`: the visitor asked for a person, contracts/ai.md) |
| POST | `/v1/widget/conversations` | `{body}` → conversation + first message |
| GET | `/v1/widget/conversations/{id}/messages` | public messages only (no notes) |
| POST | `/v1/widget/conversations/{id}/messages` | `{body, attachment_ids?}` |
| POST | `/v1/widget/conversations/{id}/handoff` | → 204; ask for a person after an AI answer (contracts/ai.md) |
| POST | `/v1/widget/attachments` | multipart |
| GET/PATCH | `/v1/widget/settings` | admin, agent-side: `{greeting, require_email, enabled, allowed_origins}` (stored in workspace settings.widget) |

### Email (owner: backend-email)
| method | path | notes |
| --- | --- | --- |
| CRUD | `/v1/mailboxes`, `/v1/mailboxes/{id}` | create `{name, email, display_name?, inbound_kind, outbound_kind, config, password?, smtp_password?, team_id?}` |
| POST | `/v1/mailboxes/{id}/test` | → `{inbound: {ok, error}, outbound: {ok, error}}` |
| POST | `/v1/mailboxes/oauth/{provider}/start` | `{mailbox_id?, name, email?}` → `{url}` (google, microsoft) |
| GET | `/v1/mailboxes/oauth/{provider}/callback` | → 302 `APP_URL/settings/mailboxes?connected=<id>` |
| POST | `/v1/inbound/email` | header `OD-Inbound-Secret`, query `to=<rcpt>`, body raw RFC 822 → 202 (Cloudflare Email Worker / SES) |

### System
`GET /healthz` (liveness), `GET /readyz` (db + nats), `GET /v1/openapi.json`, `GET /docs` (API reference UI).
