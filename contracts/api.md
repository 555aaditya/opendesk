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
- Workspace-scoped routes need `OD-Workspace: <id>` (agents) or an API key. An `OD-Workspace` the caller is not a member of (or that no longer exists) is treated as absent: `400 workspace_required`, the same answer either way.
- PATCH bodies: an omitted or `null` member is left unchanged. Clear an optional reference with `""`
  (mailbox `team_id`, KB article `collection_id`) unless the route documents `null` (ticket PATCH, contact `company_id`).
- Idempotency: `Idempotency-Key` header (1..255 printable ASCII) on authenticated POST routes, kept 24h per
  workspace and principal. A retry with the same key, route and body replays the stored response with
  `Idempotent-Replayed: true`; a different body or route is `422 idempotency_key_reused`, a retry while the first
  is running `409 idempotency_in_progress`. `5xx`, `429`, streamed and >1 MiB responses are not stored. Not
  applied to `/v1/auth/*`, `/v1/me/password`, `/v1/me/passkeys/register/*`, `/v1/realtime/token`, inbound, Stripe, widget and public routes.
- Rate limits: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers.
- Roles: `owner` > `admin` > `agent` > `viewer`. Viewers read only. Settings routes
  (mailboxes, members, api keys, webhooks, automations, sla, business hours, assignment, triage, widget settings, labels, label groups, custom fields, workspace images) need `admin`.
- API key scopes: `tickets:read`, `tickets:write`, `contacts:read`, `contacts:write`,
  `kb:read`, `kb:write`, `settings:read`, `settings:write`, `realtime`.

## Resource shapes

```ts
// Pictures (see "Profile pictures and logos"). avatar_url is null when there is no picture: show initials.
type AvatarSource = "upload" | "oauth" | "gravatar" | "domain" | "widget";
type User = { id: string; email: string; name: string; avatar_url: string | null; avatar_source: AvatarSource | null; email_verified: boolean; totp_enabled: boolean; created_at: string };
type UserRef = { id: string; name: string; email: string; avatar_url: string | null };
type Workspace = { id: string; name: string; slug: string; widget_key: string; settings: WorkspaceSettings; avatar_url: string | null /* workspace logo */; avatar_source: "upload" | null;
  images: { help_center_logo: string | null; help_center_favicon: string | null; widget_avatar: string | null; widget_launcher: string | null }; created_at: string };
type WorkspaceSettings = { brand_color?: string; timezone?: string; help_center_enabled?: boolean; help_center_title?: string; csat_enabled?: boolean;
  auto_assign?: AssignMode /* the workspace default; see "Assignment" */; locale?: string /* BCP 47 default for customer-facing pages (help center, CSAT, widget); "" = the visitor's browser */;
  gravatar?: boolean /* default false: look up contact pictures on Gravatar (sends a hash of the contact's email to Gravatar) */;
  domain_logos?: boolean /* default true: fetch company logos from the company's website */;
  label_creation?: "anyone" | "admins" /* default "anyone": applying an unknown label name creates it; "admins": only admins (and keys with settings:write) may, others get 422 unknown_label */;
  status_labels?: Partial<Record<TicketStatus, DisplayOverride>>; priority_labels?: Partial<Record<Priority, DisplayOverride>> /* display only; the API values never change */ };
type DisplayOverride = { label?: string /* 1..40, no < > */; color?: LabelColor };
type Membership = { workspace: Workspace; role: Role };
type Role = "owner" | "admin" | "agent" | "viewer";
type Member = { user: UserRef & { avatar_source: AvatarSource | null }; role: Role;
  availability: Availability /* what the member set */; presence: Availability /* availability, or "away" when auto-away applies */;
  max_open_tickets: number | null /* auto-assignment cap on open + pending tickets; null = no cap */; open_tickets: number;
  last_seen_at: string | null; created_at: string };
type Availability = "online" | "away" | "offline";
type Invitation = { id: string; email: string; role: Role; expires_at: string; created_at: string; invited_by: UserRef | null };
type Team = { id: string; name: string; member_ids: string[]; created_at: string };

type Contact = { id: string; email: string | null; name: string; phone: string; avatar_url: string | null; avatar_source: AvatarSource | null; company: CompanyRef | null; external_id: string | null; notes: string; custom: Record<string, unknown>; tags: TagRef[]; fields: FieldValues; blocked: boolean; ticket_count: number; created_at: string; updated_at: string };
type ContactRef = { id: string; email: string | null; name: string; avatar_url: string | null };
type Company = { id: string; name: string; domain: string; avatar_url: string | null /* logo */; avatar_source: "upload" | "domain" | null; notes: string; custom: Record<string, unknown>; tags: TagRef[]; fields: FieldValues; contact_count: number; created_at: string; updated_at: string };
type CompanyRef = { id: string; name: string; domain: string; avatar_url: string | null };

type TicketStatus = "open" | "pending" | "on_hold" | "solved" | "closed";
type Priority = "low" | "normal" | "high" | "urgent";
type Severity = "sev1" | "sev2" | "sev3" | "sev4"; // business impact, sev1 the most severe; a ticket may have none
type Channel = "email" | "chat" | "api" | "portal";
type Ticket = {
  id: string; number: number; subject: string; status: TicketStatus; priority: Priority; severity: Severity | null; channel: Channel;
  mailbox_id: string | null; contact: ContactRef | null; assignee: UserRef | null; team_id: string | null;
  tags: TagRef[]; fields: FieldValues; sla: { policy_id: string; first_response_due_at: string | null; resolution_due_at: string | null; breached: boolean } | null;
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
// activity types: status_changed{from,to} priority_changed{from,to} severity_changed{from: Severity | null, to: Severity | null} assigned{from,to,via?: "round_robin"|"load_balanced"|"triage"} (actor "system", or "ai" for via "triage") team_changed tagged{tag} untagged{tag} sla_breached{kind} merged{into} csat_received{score}
// field_changed{key, name, from, to} (one per custom field; from/to are FieldValue | null)
// AI (actor.type "ai", contracts/ai.md): ai_triaged{category,sentiment,language,priority,severity,via,model?,engine?}; AI changes carry {via, model?: "jev", confidence?: number} ai_answered{message_id,article_ids} ai_handoff (actor "ai" or "contact")

// Labels ("tags" in the API). See "Labels and custom fields" below.
type LabelColor = "gray" | "red" | "orange" | "amber" | "yellow" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "purple" | "pink" | "rose";
type LabelScope = "tickets" | "contacts" | "companies";
type Tag = {
  id: string; name: string; color: LabelColor; description: string; group_id: string | null; position: number;
  archived: boolean; applies_to: LabelScope[]; usage: { tickets: number; contacts: number; companies: number };
  created_at: string; updated_at: string;
};
type TagRef = { id: string; name: string; color: LabelColor; group_id: string | null }; // embedded in tickets, contacts, companies
type TagGroup = { id: string; name: string; color: LabelColor | null; exclusive: boolean; position: number; tag_count: number; created_at: string; updated_at: string };

// Custom fields. Values live under `fields` on Ticket, Contact and Company, keyed by CustomField.key.
type FieldEntity = "ticket" | "contact" | "company";
type FieldType = "text" | "long_text" | "number" | "select" | "multi_select" | "date" | "checkbox" | "url" | "email" | "user";
type FieldOption = { id: string; label: string; color: LabelColor };
type CustomField = {
  id: string; entity: FieldEntity; key: string; name: string; type: FieldType; options: FieldOption[];
  required_on_solve: boolean; description: string; position: number; archived: boolean; created_at: string; updated_at: string;
};
type FieldValue = string | number | boolean | string[];
type FieldValues = Record<string, FieldValue>; // only keys with a value; a cleared field is absent
type FieldFilter = { key: string; op: FieldOp; value: string };
type FieldOp = "eq" | "ne" | "contains" | "not_contains" | "gt" | "gte" | "lt" | "lte" | "any" | "all" | "none" | "set" | "not_set";

type SavedReply = { id: string; title: string; shortcut: string; body_html: string; created_at: string; updated_at: string };
type View = { id: string; name: string; shared: boolean; filters: TicketFilters; position: number };
type TicketFilters = { status?: TicketStatus[]; priority?: Priority[]; severity?: (Severity | "none")[] /* "none": no severity */; assignee?: "me" | "none" | string; team_id?: string; mailbox_id?: string; tag?: string; channel?: Channel; q?: string; fields?: FieldFilter[] /* max 20, ANDed */ };
type SlaPolicy = { id: string; name: string; priority: Priority | null; first_response_minutes: number; resolution_minutes: number;
  business_hours: boolean /* count only open business hours (default false) */; enabled: boolean; position: number };

// Triage, assignment and setup (see "Triage, assignment and onboarding").
type AssignMode = "none" | "round_robin" | "load_balanced";
type AssignmentRule = { target_type: "mailbox" | "team"; target_id: string; mode: AssignMode };
type Assignment = { mode: AssignMode /* = settings.auto_assign */; rules: AssignmentRule[]; auto_away_minutes: number /* 0 = off */ };
type TriageField = "priority" | "severity" | "labels" | "team";
type DecisionEngine = { provider: "typesafe" | "llm" | "none"; model: string /* "jev-latest", or the LLM fast model */; connected: boolean };
type TriageSettings = { auto_triage: boolean; fields: TriageField[]; assign_after_triage: boolean;
  threshold: number /* 0.5..0.99, default 0.7: confidence at or above it applies a decision, below it leaves a suggestion */;
  engine: DecisionEngine; available: boolean /* triage can run: AI or a decision engine is configured and AI is on for the workspace */ };
type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type BusinessHours = { enabled: boolean; timezone: string /* the workspace timezone */; schedule: Record<Weekday, { start: string; end: string }[]> /* "HH:MM", 24h */; holidays: { date: string /* YYYY-MM-DD */; name: string }[] };
type OnboardingStepId = "connect_mailbox" | "invite_teammate" | "upload_photo" | "install_widget" | "publish_article" | "setup_triage" | "create_label" | "try_ollie";
type OnboardingStep = { id: OnboardingStepId; title: string; description: string; done: boolean; href: string /* app path */; requires: "admin" | "agent" };
type Onboarding = { steps: OnboardingStep[]; done_count: number; total: number; dismissed: boolean };
type Automation = { id: string; name: string; trigger: "ticket_created" | "customer_replied" | "agent_replied" | "ticket_updated"; conditions: Condition[]; actions: Action[]; enabled: boolean; position: number; run_count: number };
type Condition = {
  field: "subject" | "body" | "from_email" | "channel" | "mailbox_id" | "priority" | "severity" | "status" | "tag" | "sentiment" | "ai_decide" | `field.${string}` | `contact.field.${string}`;
  op: "contains" | "not_contains" | "equals" | "not_equals" | "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "any" | "all" | "none" | "set" | "not_set";
  value: string;
  question?: string; // ai_decide only: a yes/no question, 3..300 characters of plain text
}; // severity: equals/not_equals with a Severity or "none"; ai_decide: gt/lt with value a probability 0.01..0.99 (contracts/ai.md "Automations"); sentiment: equals/not_equals only; eq = equals, ne = not_equals. field.<key>: a ticket custom field, contact.field.<key>: the ticket contact's; ops per field type (below)
type Action = { type: "set_status" | "set_priority" | "set_severity" /* value Severity, or "" to clear */ | "assign_user" | "assign_team" | "add_tag" | "remove_tag" | "send_reply" | "add_note" | "mark_spam" | "ai_triage" | "set_field"; value: string; field?: string /* set_field: the ticket field key */ };
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
| GET | `/v1/auth/config` | → `{ providers: [{id:"google"|"microsoft"|"github"|"oidc", name}], password_login: bool, signup_enabled: bool, passkeys: bool, turnstile_site_key: string \| null }`. `passkeys` is true when passkey sign-in is available |
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
| POST | `/v1/auth/passkey/login/begin` | `{}` → `{options: PublicKeyCredentialRequestOptionsJSON, passkey_token}`. Discoverable (no `allowCredentials`), so no email is needed and conditional UI works. `passkey_token` is single use, 5 min |
| POST | `/v1/auth/passkey/login/finish` | `{passkey_token, credential: AuthenticationResponseJSON}` → same as `/v1/auth/login` (`{access_token, expires_in, user}` + refresh cookie). A user-verified passkey is a complete multi-factor sign-in (the session counts as having passed 2FA); without user verification an account with 2FA on answers `{mfa_required:true, mfa_token}`. `401 invalid_credentials` for every refused attempt (unknown passkey, bad signature, spent or wrong token, sign counter not advancing) |
| POST | `/v1/auth/totp/setup` | → `{secret, otpauth_url}` |
| POST | `/v1/auth/totp/enable` | `{code}` → `{recovery_codes: string[]}` |
| POST | `/v1/auth/totp/disable` | `{code}` → 204 |
| GET | `/v1/me` | → `{user: User, memberships: Membership[]}` |
| PATCH | `/v1/me` | `{name?, avatar_url?}` → `User`. `avatar_url` is a picture to copy: an https URL fetched and processed server-side (asynchronously; `member.updated` follows), `""` removes the picture |
| PUT | `/v1/me/avatar` | multipart `file` (PNG, JPEG, GIF or WebP, at most 5 MB) → `User` with `avatar_source: "upload"`. Audit `user.avatar_updated` |
| DELETE | `/v1/me/avatar` | → `User` with no picture; the next Google or GitHub sign-in brings the provider picture back. Audit `user.avatar_removed` |
| POST | `/v1/me/heartbeat` | → 204. Marks the user seen (auto-away). The app sends it every 5 minutes while a tab is visible |
| POST | `/v1/me/password` | `{current_password, new_password}` → 204 |
| GET | `/v1/me/sessions` / DELETE `/v1/me/sessions/{id}` | paginated `[{id, user_agent, ip, created_at, last_used_at, current}]` / revoke |
| GET | `/v1/me/passkeys` | paginated `Passkey[]`, newest first. `Passkey = {id, name, created_at, last_used_at: string \| null, backed_up: bool}` |
| POST | `/v1/me/passkeys/register/begin` | `{}` → `{options: PublicKeyCredentialCreationOptionsJSON, passkey_token}` (resident key required, user verification preferred, no attestation, the account's passkeys in `excludeCredentials`). Same gate as owner-level operations (`403 mfa_required`, `403 reauth_required`); `409 passkey_limit` at 25 passkeys |
| POST | `/v1/me/passkeys/register/finish` | `{passkey_token, credential: RegistrationResponseJSON, name?}` → 201 `Passkey`. `name` defaults to `"Passkey"`. `400 invalid_passkey` when the token is spent, expired or from another session, or the credential does not verify; `409 passkey_exists` |
| PATCH | `/v1/me/passkeys/{id}` | `{name}` → `Passkey` |
| DELETE | `/v1/me/passkeys/{id}` | → 204 |
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
| PATCH | `/v1/members/{user_id}/availability` | `{availability?: Availability, max_open_tickets?: number \| null /* 1..1000, null clears */}` → `Member`. `user_id` may be `me`. Members set their own `availability`; admins set anyone's and `max_open_tickets` (viewers cannot be assigned, so theirs is refused). Publishes `member.updated` |
| PUT/DELETE | `/v1/workspace/images/{slot}` | admin. `slot`: `logo` (the workspace `avatar_url`), `help_center_logo`, `help_center_favicon`, `widget_avatar`, `widget_launcher`. PUT multipart `file` (image, 5 MB) → `Workspace`; DELETE → `Workspace`. Audit `workspace.image_updated` / `workspace.image_removed`; publishes `workspace.updated` |
| GET | `/v1/images/{id}?s=256\|64` | public. The processed PNG behind every `avatar_url` (`s` defaults to 256). Ids are unguessable and immutable: `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` |
| GET | `/v1/onboarding` | members → `Onboarding`, computed from the workspace's real state (below) |
| POST | `/v1/onboarding/dismiss` | → 204. Hides the checklist for this member; `GET` still answers, with `dismissed: true` |
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
- Passkeys: the relying party ID is the host of `APP_URL` and the accepted origin is `APP_URL`'s scheme and host. Options and
  responses use the WebAuthn JSON forms (base64url without padding), as `@simplewebauthn/browser` sends and expects. The
  user handle is the user id's 16 bytes. Passkey ids from other accounts answer `404`. Adding and removing a passkey is
  audit-logged (`passkey.added`, `passkey.removed`); a passkey sign-in logs `login` with `method: "passkey"`, a refused one
  `login.failed`. Deleting the account deletes its passkeys.
- Member rules: owners change and remove anyone but themselves; admins manage agents and viewers; only the owner grants
  `admin`; `owner` moves only by transfer. `DELETE /v1/members/{own id}` leaves (owner: `409 owner_cannot_leave`).
- `POST /v1/invitations/accept` needs the signed-in user's email to equal the invited one (`403 invitation_email_mismatch`).
- Role and list endpoints for API keys: workspace/members/teams read `settings:read`; writes `settings:write`.

### Helpdesk (owner: backend-helpdesk)
| method | path | notes |
| --- | --- | --- |
| GET | `/v1/tickets` | filters: `status` (csv), `priority` (csv), `severity` (csv of `sev1`..`sev4` and `none`), `assignee` (`me`/`none`/uuid), `team_id`, `mailbox_id`, `tag`, `channel`, `contact_id`, `view_id`, `q`, `spam`, `field.<key>` / `field.<key>[<op>]` (custom fields, below), `sort` (`last_message_at`/`created_at`/`priority`/`severity` (sev1 first, none last)/`due`/`field.<key>`), `order` |
| GET | `/v1/tickets/counts` | → `{ unassigned, mine, open, pending, on_hold, solved, spam, views: {<view_id>: n} }` |
| POST | `/v1/tickets` | `{subject, contact_id? , contact?: {email,name}, channel?: "email"\|"api", mailbox_id?, body_html, kind?: "reply"\|"note", priority?, severity?, assignee_id?, team_id?, tags?: string[], fields?: FieldValues, status?}`; an email ticket with a reply is sent to the contact |
| GET | `/v1/tickets/{id}` | id is uuid, or `#<number>` / numeric number |
| PATCH | `/v1/tickets/{id}` | `{subject?, status?, priority?, severity? /* null clears */, assignee_id?, team_id?, snoozed_until?, spam?, tags?: string[] /* replaces */, add_tags?: string[], remove_tags?: string[], custom?, fields?: Record<string, FieldValue \| null> /* merged; null clears */}`. A status of `solved` or `closed` with an empty `required_on_solve` field is `422 field_required`. Setting `snoozed_until` without a `status` moves the ticket to `on_hold`; a status change that is not `on_hold` clears the snooze. Changing `priority`, `severity`, `team_id`, `spam` or labels removes Ollie's pending suggestion for that field (`custom.ai_suggestions`, contracts/ai.md) |
| DELETE | `/v1/tickets/{id}` | soft delete |
| POST | `/v1/tickets/bulk` | `{ids, patch: {...PATCH body}}` or `{ids, delete: true}` |
| POST | `/v1/tickets/{id}/merge` | `{into_id}` |
| GET | `/v1/tickets/{id}/messages` | ascending, all |
| POST | `/v1/tickets/{id}/messages` | `{kind: "reply"\|"note", body_html, cc?, bcc?, attachment_ids?, status?: TicketStatus}` → `Message` |
| GET | `/v1/tickets/{id}/activities` | ascending |
| GET | `/v1/messages/{id}/original` | → `{full_html}` quoted history / raw view |
| CRUD | `/v1/contacts`, `/v1/contacts/{id}` | list supports `q`, `company_id`, `tag`, `field.<key>`. Write bodies also take `tags?: string[]` (replaces), `add_tags?`, `remove_tags?` (names, as for tickets) and `fields?` (merged; null clears) |
| GET | `/v1/contacts/{id}/tickets` | list |
| CRUD | `/v1/companies`, `/v1/companies/{id}` | list supports `q`, `tag`, `field.<key>`; write bodies take `tags?`, `add_tags?`, `remove_tags?`, `fields?` as contacts |
| PUT/DELETE | `/v1/contacts/{id}/avatar`, `/v1/companies/{id}/avatar` | agent (`contacts:write`). PUT multipart `file` (image, 5 MB) → `Contact` / `Company` with `avatar_source: "upload"`, which automatic sources never replace. DELETE removes it and looks up the automatic sources again. Audit `contact.avatar_updated` / `company.avatar_updated` (and `_removed`); publishes `contact.updated` / `company.updated` |
| POST | `/v1/contacts/{id}/avatar/refresh`, `/v1/companies/{id}/avatar/refresh` | agent → 202. Looks the automatic sources up again now (no effect on an upload) |
| GET | `/v1/tags` | `?q=&group_id=<uuid\|none>&archived=true\|false\|any` (default `any`) `&applies_to=tickets\|contacts\|companies` → `{data: Tag[], next_cursor: null}` (all of them, ordered by group position, then position, then name) |
| POST | `/v1/tags` | admin. `{name, color?, description?, group_id?, applies_to?, position?}` → 201 `Tag`. `color` defaults to a palette colour picked from the name, `applies_to` to all three, `position` to the end. `409 conflict` on a name taken (case-insensitive) |
| GET | `/v1/tags/{id}` | → `Tag` |
| PATCH | `/v1/tags/{id}` | admin. `{name?, color?, description?, group_id? /* null ungroups */, position?, archived?, applies_to?}` → `Tag`. A rename also rewrites automations and views that name the label |
| DELETE | `/v1/tags/{id}` | admin → 204; removes the label from every ticket, contact and company |
| POST | `/v1/tags/{id}/merge` | admin. `{into: string /* tag id */}` → the `into` `Tag`. Moves every use onto `into` (respecting `into`'s exclusive group), rewrites automations and views, deletes this label |
| POST | `/v1/tags/reorder` | admin. `{ids: string[]}` → `{data: Tag[]}`; sets `position` to each id's index (max 1000 ids, all in the workspace) |
| CRUD | `/v1/tag-groups`, `/v1/tag-groups/{id}` | admin writes. `{name, color?: LabelColor \| null, exclusive?: boolean, position?}` → `TagGroup`; list is ordered by position. Delete ungroups its labels. At most 50 groups |
| POST | `/v1/tag-groups/reorder` | admin. `{ids: string[]}` → `{data: TagGroup[]}` |
| GET | `/v1/custom-fields` | `?entity=ticket\|contact\|company&archived=true\|false\|any` (default `any`) → `{data: CustomField[], next_cursor: null}` ordered by entity, position |
| POST | `/v1/custom-fields` | admin. `{entity, key?, name, type, options?, required_on_solve?, description?, position?}` → 201 `CustomField`. `key` defaults to a slug of `name`; `409 conflict` if the key is taken for that entity |
| GET | `/v1/custom-fields/{id}` | → `CustomField` |
| PATCH | `/v1/custom-fields/{id}` | admin. `{name?, options?, required_on_solve?, description?, position?, archived?}` → `CustomField`. `entity`, `key` and `type` never change (`422`). Removing an option clears it from stored values |
| DELETE | `/v1/custom-fields/{id}` | admin → 204; removes the field's values from every record |
| POST | `/v1/custom-fields/reorder` | admin. `{entity, ids: string[]}` → `{data: CustomField[]}` (that entity's fields) |
| CRUD | `/v1/saved-replies` | |
| CRUD | `/v1/views` | `{name, filters, shared}` |
| CRUD | `/v1/sla-policies` | body takes `business_hours?: boolean` |
| GET/PUT | `/v1/business-hours` | GET members → `BusinessHours`; PUT admin, full `BusinessHours` (`timezone` sets `settings.timezone`) → `BusinessHours`. Audit `business_hours.updated` |
| GET/PATCH | `/v1/assignment` | GET members → `Assignment`; PATCH admin `{mode?, rules? /* replaces */, auto_away_minutes?}` → `Assignment`. Audit `assignment.updated` |
| GET/PATCH | `/v1/triage` | GET members → `TriageSettings`; PATCH admin `{auto_triage?, fields?, assign_after_triage?, threshold?}` → `TriageSettings` (stored in `settings.ai`, contracts/ai.md). Audit `triage.updated` |
| CRUD | `/v1/automations` | |
| CRUD | `/v1/kb/collections`, `/v1/kb/articles` | articles list supports `collection_id`, `status`, `q` |
| GET | `/v1/search?q=` | → `{tickets: Ticket[], contacts: Contact[], articles: KbArticle[]}` (5 each) |
| GET | `/v1/reports/overview?from=&to=` | → `{created, solved, open_now, first_response_p50_minutes, resolution_p50_minutes, csat_avg, csat_count, sla_breached, by_day: [{date, created, solved}], by_channel: {...}, by_severity: Record<Severity \| "none", number> /* tickets created in the range */, by_agent: [{user, solved, first_response_p50_minutes}]}` |
| POST | `/v1/attachments` | multipart `file` → `Attachment` (unattached, linked when sent) |
| GET | `/v1/attachments/{id}` | → 302 to signed URL or streamed (`?token=` for img tags) |

#### Labels and custom fields

Labels are the API's `tags` (routes, body members and event names keep that word).
- Names: 1..50 characters, letters, digits, spaces and `- _ . / : & + #` (no `<`, `>`), unique per workspace ignoring case.
  Descriptions 0..300 characters, no `<` `>` or control characters. Group names 1..50, same rules. At most 1000 labels.
- Applying labels by name (`tags`, `add_tags`, `remove_tags`, the `add_tag` action, AI triage) creates missing labels unless
  `settings.label_creation` is `"admins"`. A label whose `applies_to` lacks the record's kind is `422` (`tags`/`add_tags`); automations
  and triage skip it. Archived labels are hidden from pickers (`?archived=false`) but stay on records and still apply by name.
- **Exclusive groups**: a record holds at most one label of an exclusive group. Adding one removes the others of that group
  (activity `untagged` for each); when one write names several labels of the same exclusive group, the last one named wins. This holds
  for ticket, contact and company writes, bulk, automations and AI triage (enforced in `internal/domain`). Making a group exclusive does
  not rewrite existing records; the rule applies on their next label change.
- `usage` counts the records (not deleted tickets) carrying the label.
- New workspaces get coloured labels plus an exclusive **Type** group: Question (blue), Problem (orange), Bug (red),
  Feature request (violet), Billing (green), and ungrouped VIP (amber) and Feedback (teal).

Custom fields (`/v1/custom-fields`):
- `key`: `^[a-z][a-z0-9_]{0,39}$`, unique per entity, immutable (as are `entity` and `type`). `name` 1..60 and option labels 1..60
  without `<` `>` or control characters; `description` 0..300. At most 100 fields per entity and 200 options per field. Option
  `id` is `^[a-z0-9_-]{1,40}$`, defaulting to a slug of its label; `color` defaults to `gray`.
- Values (`fields` on create and PATCH, merged; `null` clears; unknown keys are `422`): `text` string 0..1000 (single line),
  `long_text` 0..10000, `number` finite JSON number, `select` an option id, `multi_select` option ids (unique), `date` `YYYY-MM-DD`,
  `checkbox` boolean, `url` an http(s) URL up to 2000, `email` an address (lowercased), `user` a workspace member's user id.
  An empty string or empty list clears too. Archived fields keep their values but refuse changes (`422`).
- `required_on_solve` (tickets only): moving a ticket to `solved` or `closed` (PATCH, bulk, a reply with `status`) while the field
  is empty (absent; for `checkbox`, not `true`) answers `422 field_required` with `detail` naming the field and
  `errors: [{location: "body.fields.<key>", message}]` (one per missing field). Archived fields, automations, merges and the
  auto-close job are not held back.
- Filters: `field.<key>=<v>` uses the type's default op (`eq` for text-like, number, date, checkbox; `any` for select, multi_select
  and user), or `field.<key>[<op>]=<v>`. Ops by type: text, long_text, url, email: `eq ne contains not_contains set not_set`
  (case-insensitive); number, date: `eq ne gt gte lt lte set not_set`; checkbox: `eq ne set not_set` (`eq false` also matches unset);
  select, user: `eq ne any none set not_set`; multi_select: `any all none eq ne set not_set` (`eq` = has that option). `any`, `all`
  and `none` take a comma separated list; `user` accepts `me`. Views store the same as `filters.fields`. Unknown keys or ops are `422`.
- Sort: `sort=field.<key>` for text, number, date, checkbox and select (option order) fields; records without a value sort lowest.
- Search: `q` on tickets, contacts and `/v1/search` also matches text-like field values and select option ids.
- Changes log a `field_changed` activity per key on tickets and add `"fields"` to `ticket.updated` `changes`; contact and company
  events carry the new `fields`. Webhooks receive the same objects.
- Roles: definitions (labels, groups, fields) are managed by admins (API keys `settings:write`); everyone reads them (viewers; keys with
  `settings:read`, `tickets:read` or `contacts:read`). Agents apply labels and set values (`tickets:write` for tickets,
  `contacts:write` for contacts and companies). Definition changes are audit-logged (`tag.*`, `tag_group.*`, `custom_field.*`).

Automations: conditions take `field.<key>` (ticket field) and `contact.field.<key>` (the ticket contact's field) with the ops above
(`equals`/`not_equals` are `eq`/`ne`); `set`/`not_set` ignore `value`. The `set_field` action sets ticket field `field` to `value`
written as a string (`"12.5"`, `"true"`, `"2026-10-11"`, comma separated option ids; `""` clears); it is validated when the
automation is saved and skipped at run time if the field was archived or deleted since.

#### Profile pictures and logos

- Every `avatar_url` points at `GET /v1/images/{id}` on this API: pictures from any source are fetched and processed
  server-side and never hot-linked. Processing decodes PNG, JPEG, GIF (first frame) or WebP only (by content, not name or
  header), refuses anything else (SVG, HTML, ICO with bitmap entries), caps input at 5 MB and 4096 px a side (16 Mpx), applies
  EXIF orientation, crops people to a square (logos are fitted, not cropped), resizes to 256 and 64 px and re-encodes PNG
  without metadata. Uploads answer `413 too_large`, `422 unsupported_image` or `422 image_too_large`.
- Sources, highest first. Agents: `upload` > `oauth` (the Google or GitHub picture at sign-in; Microsoft and OIDC sign-ins
  carry none). Contacts: `upload` > `widget` (verified widget sessions) > `gravatar` (only with `settings.gravatar`, looked up
  as `sha256(lowercased email)` with `d=404`). Companies: `upload` > `domain` (with `settings.domain_logos`: the domain's
  `apple-touch-icon`, manifest icons, `<link rel=icon>` and `/favicon.ico` PNG entries; or the logo provider the instance
  configures). A workspace logo is `upload` only.
- Fetches use https only, refuse private, loopback and link-local targets (re-checked on each redirect, at most 3), take at
  most 10 seconds, read at most 5 MB and accept only image content types (HTML for the domain's home page, at most 512 KB).
- Automatic pictures are refreshed every 30 days. A miss (404, nothing usable, an error) is remembered and retried after
  1, 2, 4, 8, 16, then every 30 days. New contacts and companies are looked up within minutes; turning `gravatar` on looks up
  every contact without a picture, turning it off removes Gravatar pictures.

#### Assignment

- Mode per ticket: the rule for its team, else the rule for its mailbox, else `settings.auto_assign`. Modes: `none`,
  `round_robin` (the next eligible agent after the last one picked in that pool), `load_balanced` (the eligible agent with the
  fewest open and pending assigned tickets; ties go round robin).
- Pool: the members of the ticket's team, else of its mailbox's team, else every owner, admin and agent. Viewers are never
  assigned. Eligible: `presence` is `online` and `open_tickets < max_open_tickets` (when set). With nobody eligible the ticket
  stays unassigned.
- It runs in the ticket trigger after automations, on `ticket_created` and on `customer_replied`, for tickets that are
  unassigned, not spam and not solved or closed. The `assigned` activity has actor `system` and `via` the mode.
- `presence` is `away` when `availability` is `online` but `auto_away_minutes` > 0 and the member was not seen (sign-in,
  token refresh, `POST /v1/me/heartbeat`) for that long. `auto_away_minutes`: 0 or 10..1440, default 0.
- Rules: at most 200, one per target, targets must be the workspace's mailboxes and teams (deleting one deletes its rule).

#### Triage

`/v1/triage` is the one place to set up Ollie's triage: `auto_triage` (`settings.ai.auto_triage`), `fields`
(`settings.ai.triage_fields`, default `priority`, `severity` and `labels`: `priority` lets triage raise priority, `severity`
lets it set or raise severity, `labels` lets it add labels, `team` lets it set the team of a ticket that has none; sentiment,
language and category are always recorded), `threshold` (`settings.ai.triage_threshold`, 0.5..0.99, default 0.7) and
`assign_after_triage` (`settings.ai.assign_after_triage`, default false): after Ollie triages a new ticket, it is assigned by
the resolved mode (of the team triage picked, when it picked one), or `load_balanced` when that mode is `none`, with actor
`ai` and `via: "triage"`. A decision whose confidence is below `threshold` is not applied; it is kept as a suggestion an
agent accepts or dismisses (contracts/ai.md "Decisions"). `engine` reports the decision engine: `typesafe` (Jev by
TypeSafe, calibrated confidence), `llm` (the configured AI model's structured output, applied without a confidence gate) or
`none`.

#### Business hours

`BusinessHours` lives in `settings.business_hours`. Up to 3 ranges per day, `start < end`, on the quarter hour (`24:00` ends a
day); up to 100 holidays (closed all day). An SLA policy with `business_hours: true` counts its minutes only while the
workspace is open, in its timezone; with business hours off or an empty week it counts every minute. Due dates are computed
when the policy is applied (ticket created, priority changed).

#### Onboarding

Steps, in order, and when each is done: `connect_mailbox` a mailbox exists; `invite_teammate` another member or a pending
invitation; `upload_photo` the caller has a picture; `install_widget` a widget session was ever opened; `publish_article` a
published article; `setup_triage` auto-assignment is not `none` anywhere or auto-triage is on; `create_label` a label other
than the seeded ones; `try_ollie` any Ollie feature was used in the workspace. Titles are English copy the app may override.

### Public, no auth (owner: backend-helpdesk)
| method | path | notes |
| --- | --- | --- |
| GET | `/v1/public/help/{workspace_slug}` | `{title, collections: KbCollection[], featured: KbArticle[], locale, logo_url: string \| null, favicon_url: string \| null}` published only |
| GET | `/v1/public/help/{workspace_slug}/collections/{slug}` | `{collection, articles}` |
| GET | `/v1/public/help/{workspace_slug}/articles/{slug}` | `KbArticle`, increments views |
| GET | `/v1/public/help/{workspace_slug}/search?q=` | `KbArticle[]` |
| GET/POST | `/v1/public/csat/{token}` | GET → `{workspace_name, brand_color, ticket: {number, subject}, score: number \| null, comment, locale}`; POST `{score: 1..5, comment?}` records the score and answers the same survey object |

### Widget (owner: backend-helpdesk; `Authorization: Visitor <token>` except session)
| method | path | notes |
| --- | --- | --- |
| GET | `/v1/widget/config?key=<widget_key>` | `{workspace_name, brand_color, greeting, help_center_url, require_email, locale, avatar_url: string \| null /* widget_avatar, else the workspace logo */, launcher_icon_url: string \| null}` |
| POST | `/v1/widget/session` | `{key, visitor_token?, email?, name?, user_id?, user_hash?, avatar_url?}` → `{visitor_token, contact: ContactRef, ws_token, gateway_url}`; `user_hash` = hex HMAC-SHA256(widget_secret, user_id) marks the session verified. `avatar_url` (https) is used only on a verified session: it is fetched server-side as the contact's picture (`avatar_source: "widget"`) unless an agent uploaded one |
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
