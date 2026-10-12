// Resource shapes, exactly as contracts/api.md defines them.

export type Role = "owner" | "admin" | "agent" | "viewer";

/** Where a picture came from (contracts/api.md "Profile pictures and logos"). */
export type AvatarSource = "upload" | "oauth" | "gravatar" | "domain" | "widget";

export type User = {
  id: string;
  email: string;
  name: string;
  /** null when there is no picture: show initials. */
  avatar_url: string | null;
  avatar_source: AvatarSource | null;
  email_verified: boolean;
  totp_enabled: boolean;
  created_at: string;
};
export type UserRef = { id: string; name: string; email: string; avatar_url: string | null };

export type WorkspaceSettings = {
  brand_color?: string;
  timezone?: string;
  help_center_enabled?: boolean;
  help_center_title?: string;
  csat_enabled?: boolean;
  /** The workspace default assignment mode; see Assignment. */
  auto_assign?: AssignMode;
  /** Look up contact pictures on Gravatar. Default false. */
  gravatar?: boolean;
  /** Fetch company logos from the company's website. Default true. */
  domain_logos?: boolean;
  /** Default language (BCP 47) for customer-facing pages when the visitor's browser has no match. */
  locale?: string;
  ai?: AISettings;
  /** "admins": only admins may create labels by applying a new name. Default "anyone". */
  label_creation?: "anyone" | "admins";
  /** Display-only names and colours for the fixed statuses and priorities. */
  status_labels?: Partial<Record<TicketStatus, DisplayOverride>>;
  priority_labels?: Partial<Record<Priority, DisplayOverride>>;
};
export type DisplayOverride = { label?: string; color?: LabelColor };
export type Workspace = {
  id: string;
  name: string;
  slug: string;
  widget_key: string;
  settings: WorkspaceSettings;
  /** The workspace logo. */
  avatar_url: string | null;
  avatar_source: "upload" | null;
  images: WorkspaceImages;
  created_at: string;
};
/** `widget_bot` is the widget agent's picture; null means the Ollie mark. */
export type WorkspaceImageSlot = "help_center_logo" | "help_center_favicon" | "widget_avatar" | "widget_launcher" | "widget_bot";
export type WorkspaceImages = Record<WorkspaceImageSlot, string | null>;
export type Membership = { workspace: Workspace; role: Role };
export type Availability = "online" | "away" | "offline";
export type Member = {
  user: UserRef & { avatar_source: AvatarSource | null };
  role: Role;
  /** What the member set. */
  availability: Availability;
  /** availability, or "away" when auto-away applies. */
  presence: Availability;
  /** Auto-assignment cap on open and pending tickets; null is no cap. */
  max_open_tickets: number | null;
  open_tickets: number;
  last_seen_at: string | null;
  created_at: string;
};
export type Invitation = {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  created_at: string;
  invited_by: UserRef | null;
};
export type Team = { id: string; name: string; member_ids: string[]; created_at: string };

export type CompanyRef = { id: string; name: string; domain: string; avatar_url?: string | null };
export type Contact = {
  id: string;
  email: string | null;
  name: string;
  phone: string;
  avatar_url: string | null;
  avatar_source: AvatarSource | null;
  company: CompanyRef | null;
  external_id: string | null;
  notes: string;
  custom: Record<string, unknown>;
  tags: TagRef[];
  fields: FieldValues;
  blocked: boolean;
  ticket_count: number;
  created_at: string;
  updated_at: string;
};
export type ContactRef = { id: string; email: string | null; name: string; avatar_url: string | null };
export type Company = {
  id: string;
  name: string;
  domain: string;
  /** The company logo. */
  avatar_url: string | null;
  avatar_source: "upload" | "domain" | null;
  notes: string;
  custom: Record<string, unknown>;
  tags: TagRef[];
  fields: FieldValues;
  contact_count: number;
  created_at: string;
  updated_at: string;
};

export type TicketStatus = "open" | "pending" | "on_hold" | "solved" | "closed";
export type Priority = "low" | "normal" | "high" | "urgent";
/** Business impact; sev1 is the most severe. A ticket may have none. */
export type Severity = "sev1" | "sev2" | "sev3" | "sev4";
export type Channel = "email" | "chat" | "api" | "portal";
// Labels ("tags" in the API) and custom fields (contracts/api.md "Labels and custom fields").
export type LabelColor =
  | "gray" | "red" | "orange" | "amber" | "yellow" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "purple" | "pink" | "rose";
export const LABEL_COLORS: LabelColor[] = ["gray", "red", "orange", "amber", "yellow", "lime", "green", "teal", "cyan", "blue", "indigo", "violet", "purple", "pink", "rose"];
export type LabelScope = "tickets" | "contacts" | "companies";
export type TagUsage = { tickets: number; contacts: number; companies: number };
export type Tag = {
  id: string;
  name: string;
  color: LabelColor;
  description: string;
  group_id: string | null;
  position: number;
  archived: boolean;
  applies_to: LabelScope[];
  usage: TagUsage;
  created_at: string;
  updated_at: string;
};
/** A label as embedded in tickets, contacts and companies. */
export type TagRef = { id: string; name: string; color: LabelColor; group_id: string | null };
export type TagGroup = {
  id: string;
  name: string;
  color: LabelColor | null;
  /** At most one label of the group per record; adding one replaces the other. */
  exclusive: boolean;
  position: number;
  tag_count: number;
  created_at: string;
  updated_at: string;
};
export type TagInput = {
  name: string;
  color?: LabelColor;
  description?: string;
  group_id?: string | null;
  position?: number;
  archived?: boolean;
  applies_to?: LabelScope[];
};
export type TagGroupInput = { name: string; color?: LabelColor | null; exclusive?: boolean; position?: number };

export type FieldEntity = "ticket" | "contact" | "company";
export type FieldType = "text" | "long_text" | "number" | "select" | "multi_select" | "date" | "checkbox" | "url" | "email" | "user";
export type FieldOption = { id: string; label: string; color: LabelColor };
export type CustomField = {
  id: string;
  entity: FieldEntity;
  /** Immutable slug; the key under `fields`. */
  key: string;
  name: string;
  type: FieldType;
  options: FieldOption[];
  required_on_solve: boolean;
  description: string;
  position: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
export type CustomFieldInput = {
  entity: FieldEntity;
  key?: string;
  name: string;
  type: FieldType;
  /** `id` and `color` are optional on write (slug of label, gray). */
  options?: { id?: string; label: string; color?: LabelColor }[];
  required_on_solve?: boolean;
  description?: string;
  position?: number;
};
export type CustomFieldPatch = Partial<Pick<CustomFieldInput, "name" | "options" | "required_on_solve" | "description" | "position">> & {
  archived?: boolean;
};
/** text, long_text, url, email, date (YYYY-MM-DD), select (option id), user (user id): string; number; checkbox; multi_select: option ids. */
export type FieldValue = string | number | boolean | string[];
/** Only keys with a value; a cleared field is absent. */
export type FieldValues = Record<string, FieldValue>;
/** A write: null clears a field. */
export type FieldValuesPatch = Record<string, FieldValue | null>;
export type FieldOp = "eq" | "ne" | "contains" | "not_contains" | "gt" | "gte" | "lt" | "lte" | "any" | "all" | "none" | "set" | "not_set";
/** `any`, `all` and `none` take a comma separated list; `set`/`not_set` ignore value. */
export type FieldFilter = { key: string; op: FieldOp; value: string };
export type TicketSla = {
  policy_id: string;
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  breached: boolean;
};
export type Ticket = {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: Priority;
  severity: Severity | null;
  channel: Channel;
  mailbox_id: string | null;
  contact: ContactRef | null;
  assignee: UserRef | null;
  team_id: string | null;
  tags: TagRef[];
  fields: FieldValues;
  sla: TicketSla | null;
  first_responded_at: string | null;
  solved_at: string | null;
  snoozed_until: string | null;
  last_message_at: string;
  last_customer_message_at: string | null;
  /** The customer's first unanswered message; null once anyone (or the AI agent) replied. */
  waiting_since: string | null;
  last_message_preview: string;
  message_count: number;
  spam: boolean;
  csat: { score: number; comment: string } | null;
  custom: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  inline: boolean;
  url: string;
};
export type DeliveryStatus = "none" | "pending" | "sent" | "failed" | "bounced";
export type Message = {
  id: string;
  ticket_id: string;
  kind: "reply" | "note";
  direction: "inbound" | "outbound";
  author: { type: "contact" | "user" | "system" | "api"; user: UserRef | null; contact: ContactRef | null };
  body_html: string;
  body_text: string;
  has_quoted: boolean;
  subject: string;
  from_email: string;
  from_name: string;
  to: string[];
  cc: string[];
  bcc: string[];
  attachments: Attachment[];
  delivery_status: DeliveryStatus;
  delivery_error: string;
  /** A reply from the widget AI agent (contracts/agent.md). */
  ai: boolean;
  /** An action the agent asks the visitor to confirm; set only on agent messages that carry one. */
  ai_action?: AIAction | null;
  /** The visitor's rating of an agent reply (agents only). */
  ai_rating?: "up" | "down" | null;
  created_at: string;
};
/** contracts/agent.md "Visitor actions". */
export type AIActionStatus = "pending" | "confirmed" | "declined" | "expired" | "failed";
export type AIAction = { id: string; title: string; summary: string; status: AIActionStatus; tool: string };
export type ActivityType =
  | "status_changed"
  | "priority_changed"
  /** data: {from, to} with Severity | null. */
  | "severity_changed"
  | "assigned"
  | "team_changed"
  | "tagged"
  | "untagged"
  | "sla_breached"
  | "merged"
  | "csat_received"
  /** data: {key, name, from, to} with FieldValue | null values. */
  | "field_changed"
  | (string & {});
export type Activity = {
  id: string;
  ticket_id: string;
  actor: { type: string; user: UserRef | null };
  type: ActivityType;
  data: Record<string, unknown>;
  created_at: string;
};

export type SavedReply = {
  id: string;
  title: string;
  shortcut: string;
  body_html: string;
  created_at: string;
  updated_at: string;
};
export type TicketFilters = {
  status?: TicketStatus[];
  priority?: Priority[];
  /** "none" matches tickets without a severity. */
  severity?: (Severity | "none")[];
  assignee?: "me" | "none" | string;
  team_id?: string;
  mailbox_id?: string;
  tag?: string;
  channel?: Channel;
  q?: string;
  /** Custom field filters, ANDed (max 20). */
  fields?: FieldFilter[];
};
export type View = { id: string; name: string; shared: boolean; filters: TicketFilters; position: number };
export type SlaPolicy = {
  id: string;
  name: string;
  priority: Priority | null;
  first_response_minutes: number;
  resolution_minutes: number;
  /** Count only the workspace's open business hours. */
  business_hours: boolean;
  enabled: boolean;
  position: number;
};

// Triage, assignment and setup (contracts/api.md "Assignment", "Triage", "Business hours", "Onboarding").
export type AssignMode = "none" | "round_robin" | "load_balanced";
export type AssignmentRule = { target_type: "mailbox" | "team"; target_id: string; mode: AssignMode };
export type Assignment = {
  /** settings.auto_assign */
  mode: AssignMode;
  rules: AssignmentRule[];
  /** 0 is off, else 10..1440. */
  auto_away_minutes: number;
};
export type TriageField = "priority" | "severity" | "labels" | "team";
/** The decision engine behind triage (contracts/api.md). Jev is TypeSafe's decision model. */
export type DecisionEngine = { provider: "typesafe" | "llm" | "none"; model: string; connected: boolean };
export type TriageSettings = {
  auto_triage: boolean;
  fields: TriageField[];
  assign_after_triage: boolean;
  /** 0.5..0.99: decisions at or above it apply, below it they become suggestions. */
  threshold: number;
  engine: DecisionEngine;
  /** Triage can run: AI or a decision engine is configured and AI is on. */
  available: boolean;
};
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type TimeRange = { start: string; end: string };
export type Holiday = { date: string; name: string };
export type BusinessHours = {
  enabled: boolean;
  timezone: string;
  /** "HH:MM", 24h, up to 3 ranges a day. */
  schedule: Record<Weekday, TimeRange[]>;
  holidays: Holiday[];
};
export type OnboardingStepId =
  | "connect_mailbox" | "invite_teammate" | "upload_photo" | "install_widget" | "publish_article" | "setup_triage" | "create_label" | "try_ollie";
export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  done: boolean;
  /** App path that completes the step. */
  href: string;
  requires: "admin" | "agent";
};
export type Onboarding = { steps: OnboardingStep[]; done_count: number; total: number; dismissed: boolean };

export type AutomationTrigger = "ticket_created" | "customer_replied" | "agent_replied" | "ticket_updated";
export type ConditionField =
  | "subject" | "body" | "from_email" | "channel" | "mailbox_id" | "priority" | "severity" | "status" | "tag" | "sentiment" | "ai_decide"
  /** A ticket custom field, or the ticket contact's. */
  | `field.${string}` | `contact.field.${string}`;
/** `eq` is the AI sentiment condition's operator (contracts/ai.md). */
export type ConditionOp = "contains" | "not_contains" | "equals" | "not_equals" | "eq" | "gt" | "lt";
/** Custom field conditions (`field.<key>`, `contact.field.<key>`) take the FieldOp set of their type; `ne` aliases `not_equals`. */
/** ai_decide: op gt/lt, value a probability 0.01..0.99, question a yes/no question (3..300 chars). */
export type Condition = { field: ConditionField; op: ConditionOp; value: string; question?: string };
/** A condition on a custom field, with the operators of its type. */
export type FieldCondition = { field: `field.${string}` | `contact.field.${string}`; op: FieldOp; value: string };
export type ActionType =
  | "set_status"
  | "set_priority"
  /** value: a Severity, or "" to clear. */
  | "set_severity"
  | "assign_user"
  | "assign_team"
  | "add_tag"
  | "remove_tag"
  | "send_reply"
  | "add_note"
  | "mark_spam"
  | "ai_triage"
  | "set_field";
/** set_field: `field` is the ticket field key, `value` its string form ("12.5", "true", "2026-10-11", "a,b"; "" clears). */
export type Action = { type: ActionType; value: string; field?: string };
export type Automation = {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: Condition[];
  actions: Action[];
  enabled: boolean;
  position: number;
  run_count: number;
};

export type TlsMode = "tls" | "starttls" | "none";
export type MailboxConfig = {
  imap_host?: string;
  imap_port?: number;
  imap_username?: string;
  imap_tls?: TlsMode;
  smtp_host?: string;
  smtp_port?: number;
  smtp_username?: string;
  smtp_tls?: TlsMode;
  oauth_email?: string;
};
export type Mailbox = {
  id: string;
  name: string;
  email: string;
  display_name: string;
  inbound_kind: "forwarding" | "imap" | "google" | "microsoft";
  outbound_kind: "smtp" | "google" | "microsoft" | "system";
  forwarding_address: string;
  config: MailboxConfig;
  team_id: string | null;
  signature_html: string;
  auto_reply_enabled: boolean;
  auto_reply_subject: string;
  auto_reply_html: string;
  status: "active" | "error" | "disabled";
  last_error: string;
  last_synced_at: string | null;
  created_at: string;
};

export type KbCollection = {
  id: string;
  name: string;
  slug: string;
  description: string;
  position: number;
  article_count: number;
};
export type KbArticle = {
  id: string;
  collection_id: string | null;
  title: string;
  slug: string;
  excerpt: string;
  body_html: string;
  status: "draft" | "published";
  author: UserRef | null;
  views: number;
  published_at: string | null;
  updated_at: string;
};

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  created_by: UserRef | null;
};
export type Webhook = {
  id: string;
  url: string;
  description: string;
  events: string[];
  enabled: boolean;
  created_at: string;
};
/** A product connected for Ollie over MCP (contracts/integrations.md). */
export type IntegrationStarter = { label: string; prompt: string };
export type IntegrationCategory = "issues" | "docs" | "chat" | "crm" | "payments" | "automation" | "files";
export type IntegrationProvider = {
  key: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  url: string;
  auth: "oauth" | "token";
  token_help?: string;
  token_url?: string;
  starters: IntegrationStarter[];
};
export type IntegrationTool = { name: string; title: string; description: string; read_only: boolean; enabled: boolean };
export type Integration = {
  id: string;
  /** A catalog key, or "custom". */
  provider: string;
  name: string;
  host: string;
  url?: string;
  auth_type: "oauth" | "token" | "none";
  status: "pending" | "connected" | "error";
  enabled: boolean;
  last_error: string;
  tools: IntegrationTool[];
  starters: IntegrationStarter[];
  synced_at: string | null;
  created_at: string;
};
export type TicketLink = {
  id: string;
  ticket_id: string;
  integration_id: string | null;
  /** A catalog key, "custom" or "link". */
  provider: string;
  url: string;
  title: string;
  actor_type: "user" | "ai" | "api";
  created_by: string | null;
  created_at: string;
};
export type WebhookDelivery = {
  id: string;
  event_id: string;
  event_type: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  response_code: number | null;
  duration_ms: number | null;
  created_at: string;
};
export type AuditLog = {
  id: string;
  actor: { type: "user" | "api_key" | "system"; user: UserRef | null; api_key_id: string | null };
  action: string;
  entity_type: string;
  entity_id: string | null;
  data: Record<string, unknown>;
  ip: string;
  created_at: string;
};
export type NotificationType = "assigned" | "mentioned" | "customer_replied" | "sla_breached" | "ai_handoff" | "ai_cap_reached";
/** `ai_cap_reached`: data `{cap}`, ticket null; the widget agent reached `widget_monthly_cap` (once a month, owners and admins). */
export type Notification = {
  id: string;
  type: NotificationType;
  ticket: { id: string; number: number; subject: string } | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

// Lists and envelopes.
export type Page<T> = { data: T[]; next_cursor: string | null };

export type Envelope<D = Record<string, unknown>> = {
  id: string;
  seq: number;
  workspace_id: string;
  type: string;
  visibility: "agents" | "public";
  /** Not sent over the gateway (it pushes the envelope minus topics); present in GET /v1/events. */
  topics?: string[];
  data: D;
  occurred_at: string;
};
export type EventsPage = { data: Envelope[]; latest_seq: number; resync: boolean };

// Auth.
export type AuthProvider = { id: "google" | "microsoft" | "github" | "oidc"; name: string };
export type AuthConfig = {
  providers: AuthProvider[];
  password_login: boolean;
  signup_enabled: boolean;
  turnstile_site_key: string | null;
};
export type TokenResponse = { access_token: string; expires_in: number; user: User; redirect_to?: string };
export type MfaChallenge = { mfa_required: true; mfa_token: string; redirect_to?: string };
/** OAuth exchange: the provider's email belongs to an existing password account. */
export type LinkRequired = { link_required: true; link_token: string; email: string; redirect_to?: string };
export type LoginResponse = TokenResponse | MfaChallenge;
export type ExchangeResponse = TokenResponse | MfaChallenge | LinkRequired;
export type Me = { user: User; memberships: Membership[] };
export type Session = {
  id: string;
  user_agent: string;
  ip: string;
  created_at: string;
  last_used_at: string;
  current: boolean;
};

export type TicketCounts = {
  unassigned: number;
  mine: number;
  open: number;
  pending: number;
  on_hold: number;
  solved: number;
  spam: number;
  views: Record<string, number>;
};

export type SearchResults = { tickets: Ticket[]; contacts: Contact[]; articles: KbArticle[] };

export type ReportsOverview = {
  created: number;
  solved: number;
  open_now: number;
  first_response_p50_minutes: number | null;
  resolution_p50_minutes: number | null;
  csat_avg: number | null;
  csat_count: number;
  sla_breached: number;
  by_day: { date: string; created: number; solved: number }[];
  by_channel: Partial<Record<Channel, number>>;
  /** Tickets created in the range, by severity. */
  by_severity?: Partial<Record<Severity | "none", number>>;
  by_agent: { user: UserRef; solved: number; first_response_p50_minutes: number | null }[];
};

export type MailboxTest = { inbound: { ok: boolean; error: string }; outbound: { ok: boolean; error: string } };

// The chat widget (contracts/api.md "Widget").
export type WidgetTheme = "auto" | "light" | "dark";
export type WidgetRadius = "square" | "soft" | "round";
export type WidgetSettings = {
  enabled: boolean;
  /** Up to 300 chars, plain text with newlines. */
  greeting: string;
  require_email: boolean;
  /** At most 20. */
  allowed_origins: string[];
  /** "#rrggbb", or "" for the workspace brand colour. */
  color: string;
  theme: WidgetTheme;
  position: "right" | "left";
  /** 0..200 px from the side. */
  offset_x: number;
  /** 0..200 px from the bottom. */
  offset_y: number;
  launcher: "icon" | "label";
  /** Up to 24 chars; "" is the translated "Chat with us". */
  launcher_label: string;
  radius: WidgetRadius;
  /** Up to 40 chars; "" is the workspace name. */
  title: string;
  /** Up to 80 chars; "" is the translated reply-time line. */
  subtitle: string;
  show_team: boolean;
  /** At most 4 prompts of 2..60 chars. */
  suggestions: string[];
  sound: boolean;
  /** The AI agent's name for visitors, up to 30 chars; "" is "Ollie". */
  bot_name: string;
};
/** GET /v1/widget/config: what the widget renders. */
export type WidgetConfig = {
  workspace_name: string;
  brand_color: string | null;
  greeting: string;
  help_center_url: string | null;
  require_email: boolean;
  locale: string | null;
  avatar_url: string | null;
  launcher_icon_url: string | null;
  theme: WidgetTheme;
  position: "right" | "left";
  offset_x: number;
  offset_y: number;
  launcher: "icon" | "label";
  launcher_label: string;
  radius: WidgetRadius;
  title: string;
  subtitle: string;
  suggestions: string[];
  sound: boolean;
  team: { name: string; avatar_url: string | null }[];
  ai_answers: boolean;
  bot: { name: string; avatar_url: string | null };
};

/** GET /v1/public/csat/{token}. `locale` is the workspace default ("" when not set). */
export type CsatSurvey = {
  workspace_name: string;
  brand_color: string;
  ticket: { number: number; subject: string };
  score: number | null;
  comment: string;
  locale: string;
};

export type PublicHelpHome = { title: string; collections: KbCollection[]; featured: KbArticle[]; locale?: string; logo_url?: string | null; favicon_url?: string | null };
export type PublicCollection = { collection: KbCollection; articles: KbArticle[] };

export type TicketPatch = {
  subject?: string;
  status?: TicketStatus;
  priority?: Priority;
  /** null clears. */
  severity?: Severity | null;
  assignee_id?: string | null;
  team_id?: string | null;
  snoozed_until?: string | null;
  spam?: boolean;
  /** Replaces the tags, by name. */
  tags?: string[];
  /** Adds these tags, keeping the others. */
  add_tags?: string[];
  remove_tags?: string[];
  custom?: Record<string, unknown>;
  /** Merged into fields; null clears. Solving with an empty required field is 422 field_required. */
  fields?: FieldValuesPatch;
};

export type ReportsRange = { from: string; to: string };

// Billing (contracts/billing.md).
export type Plan = "free" | "pro" | "self_hosted";
export type BillingStatus = "none" | "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "paused";
export type Price = { id: string; unit_amount: number; currency: string; interval: "month" | "year" | null; credits?: number };
export type Billing = {
  plan: Plan;
  billing_enabled: boolean;
  status: BillingStatus;
  interval: "month" | "year";
  seats: number;
  billed_seats: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /** 0 = unlimited. */
  limits: { max_mailboxes: number; max_members: number };
  usage: { mailboxes: number; members: number };
  credits: { unlimited: boolean; monthly: number; used: number; purchased: number; remaining: number; period_end: string };
  prices: { pro_month: Price | null; pro_year: Price | null; credit_pack: Price | null };
};
export type AIFeature =
  | "summarize" | "rewrite" | "translate" | "triage" | "decide" | "answer_check" | "copilot" | "draft_reply" | "answer" | "playground" | "kb_draft" | "assistant";
/**
 * GET /v1/billing/usage (contracts/billing.md). `from`/`to` are RFC 3339; `to` is exclusive.
 * Every credits value is a number with up to 3 decimals.
 */
export type BillingUsage = {
  from: string;
  to: string;
  total_credits: number;
  total_calls: number;
  by_feature: { feature: AIFeature; credits: number; calls: number }[];
  by_day: { date: string; credits: number; calls: number; by_feature?: Partial<Record<AIFeature, number>> }[];
  by_member: { user: UserRef | null; credits: number; calls: number }[];
  /** Older servers omit it. */
  by_model?: { model: string; credits: number; calls: number; input_tokens: number; output_tokens: number }[];
};

// AI (contracts/ai.md).
export type Sentiment = "positive" | "neutral" | "negative" | "frustrated";
export type AISettings = {
  enabled: boolean;
  auto_triage: boolean;
  auto_summarize: boolean;
  widget_answers: boolean;
  /** The assistant panel (Ollie). Default true. */
  assistant: boolean;
  tone: string;
  reply_language: "customer" | "workspace";
  instructions: string;
  /** Drafts, summaries, copilot, KB drafts, Ollie; "" is the instance default. */
  model?: string;
  /** Rewrite, translate, LLM triage and decisions; "" is the instance fast model. */
  fast_model?: string;
  /** The widget agent; "" follows `model`. */
  widget_model?: string;
  /** What the widget agent should know, up to 4,000 chars. */
  widget_instructions?: string;
  /** 1..100, default 20: agent replies in one conversation before it hands off. */
  widget_max_replies?: number;
  /** At most 20 topics of 2..100 chars the agent declines. */
  widget_blocked_topics?: string[];
  /** Credits per calendar month the agent may use; 0 is no cap. */
  widget_monthly_cap?: number;
  /** Ask for an email before handing off when the visitor has none. Default true. */
  widget_collect_email?: boolean;
};
/** A model the instance offers (GET /v1/ai/models). */
export type AIModel = {
  id: string;
  name: string;
  vendor: string;
  context_length: number | null;
  /** Credits per million tokens, markup included; null when the price is unknown. */
  credits_per_mtok: { input: number; output: number } | null;
};
export type AIModels = { data: AIModel[]; default: string; fast: string };
export type AIConfig = {
  enabled: boolean;
  provider: string;
  models: { default: string; fast: string };
  embeddings: boolean;
  features: AISettings;
  /** Typical credits per call, also the minimum balance to start one. */
  costs: Partial<Record<AIFeature, number>>;
  /** Credits follow real usage (model, thread and answer length). */
  metered?: boolean;
  /** The name AI acts under everywhere ("Ollie"). */
  assistant_name?: string;
  /** The decision engine (Jev by TypeSafe, the LLM fallback, or none). */
  decisions?: DecisionEngine;
};

// Decisions (contracts/ai.md "Decisions"), stored on tickets as custom.ai_decisions and custom.ai_suggestions.
export type DecisionField =
  | "priority" | "severity" | "category" | "type_label" | "label" | "sentiment" | "language" | "spam" | "needs_human" | "team" | "sla_risk";
export type Decision = {
  value: string | boolean | number | null;
  probability: number | null;
  confidence: number | null;
  applied: boolean;
};
export type AIDecisions = {
  engine: "jev" | "llm";
  model: string;
  model_version?: string;
  threshold: number;
  decided_at: string;
  fields: Partial<Record<DecisionField, Decision>>;
};
export type SuggestionField = "priority" | "severity" | "labels" | "team" | "spam";
export type Suggestion = {
  /** labels: names; team: a team id. */
  value: string | string[] | boolean;
  confidence: number | null;
  probability: number | null;
  model: string;
  decided_at: string;
};
export type AISuggestions = Partial<Record<SuggestionField, Suggestion>>;
export type KBSource = { article_id: string; title: string; url: string };
export type AIDraft = { body_html: string; body_text: string; sources: KBSource[] };
export type AISummary = { summary: string; key_points: string[]; sentiment: Sentiment; updated_at: string };
export type AIAnswer = { answer_html: string; sources: KBSource[] };
export type Triage = {
  tags: string[];
  /** At most 2 new tag names; only the explicit apply creates them. */
  suggested_tags: string[];
  priority: Priority;
  severity: Severity | null;
  team_id: string | null;
  sentiment: Sentiment;
  language: string;
  category: string;
  summary: string;
  applied: boolean;
  decisions?: AIDecisions;
  suggestions?: AISuggestions;
};
export type RewriteMode = "friendlier" | "more_formal" | "shorter" | "longer" | "fix_grammar" | "simplify";
export type TranslateResult = { html?: string; text?: string; source_language: string };
export type KBArticleDraft = { title: string; body_html: string; excerpt: string };

// The widget AI agent (contracts/agent.md).

/** A passage the agent answered from. */
export type AgentSource = { kind: "article" | "page" | "file" | "snippet"; id: string; title: string; url: string | null };

export type AgentReport = {
  from: string;
  to: string;
  conversations: number;
  replies: number;
  resolved: number;
  handoffs: number;
  ratings: { up: number; down: number };
  credits: number;
  by_day: { date: string; conversations: number; replies: number; resolved: number; handoffs: number }[];
  tools: { tool: string; calls: number; errors: number }[];
  gaps: { question: string; count: number }[];
};

export type PlaygroundMessage = { role: "visitor" | "agent"; text: string };
export type PlaygroundVisitor = { name?: string; email?: string; verified?: boolean; user_id?: string };
export type PlaygroundSettings = Partial<Pick<AISettings, "widget_model" | "widget_instructions" | "widget_blocked_topics" | "tone" | "reply_language" | "instructions">>;
export type PlaygroundBody = { messages: PlaygroundMessage[]; settings?: PlaygroundSettings; visitor?: PlaygroundVisitor };
export type PlaygroundToolEvent = { name: string; status: "running" | "done" | "error"; summary: string };
export type PlaygroundDone = {
  text_html: string;
  sources: AgentSource[];
  handoff: boolean;
  action: { tool: string; title: string; summary: string } | null;
  credits: number;
};
export type PlaygroundEvent =
  | { event: "delta"; data: { text: string } }
  | { event: "tool"; data: PlaygroundToolEvent }
  | { event: "sources"; data: { sources: AgentSource[] } }
  | { event: "done"; data: PlaygroundDone };

export type McpAuthKind = "none" | "bearer" | "header" | "oauth";
export type McpTool = {
  name: string;
  title: string | null;
  description: string;
  input_schema: Record<string, unknown>;
  read_only: boolean;
  destructive: boolean;
  enabled: boolean;
  policy: "auto" | "confirm";
  verified_only: boolean;
};
export type McpServerStatus = "connected" | "needs_auth" | "error" | "connecting";
export type McpServer = {
  id: string;
  name: string;
  slug: string;
  url: string;
  enabled: boolean;
  auth: {
    kind: McpAuthKind;
    header_name?: string;
    has_secret: boolean;
    oauth?: { connected: boolean; scopes: string[]; expires_at: string | null };
  };
  status: McpServerStatus;
  error: string | null;
  server_info: { name: string; version: string } | null;
  tools: McpTool[];
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};
/** Secrets are write-only: omit them to keep the stored one. */
export type McpAuthInput = { kind: McpAuthKind; token?: string; header_name?: string; header_value?: string };
export type McpToolPatch = Partial<Pick<McpTool, "enabled" | "policy" | "verified_only">>;
export type McpServerPatch = { name?: string; url?: string; enabled?: boolean; auth?: McpAuthInput; tools?: Record<string, McpToolPatch> };
export type McpToolResult = { content: string; is_error: boolean; ms: number };

export type KnowledgeKind = "website" | "file" | "snippet";
export type KnowledgeStatus = "pending" | "syncing" | "ready" | "error";
export type KnowledgeWebsite = { url: string; max_pages: number; include: string[]; exclude: string[]; recrawl: "off" | "weekly" };
export type KnowledgeSource = {
  id: string;
  kind: KnowledgeKind;
  name: string;
  status: KnowledgeStatus;
  error: string | null;
  enabled: boolean;
  website?: KnowledgeWebsite;
  file?: { filename: string; content_type: string; size_bytes: number };
  snippet?: { question: string; answer: string };
  doc_count: number;
  char_count: number;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};
export type KnowledgeDoc = { id: string; title: string; url: string | null; chars: number; updated_at: string };
export type KnowledgeCreate =
  | { kind: "website"; name?: string; website: Partial<KnowledgeWebsite> & { url: string } }
  | { kind: "snippet"; name?: string; snippet: { question: string; answer: string } };
export type KnowledgePatch = { name?: string; enabled?: boolean; website?: Partial<KnowledgeWebsite>; snippet?: { question: string; answer: string } };

/** "live" pushes on the ticket channel while the widget agent writes (contracts/realtime.md). */
export type LiveEvent =
  | { type: "ai.reply.started"; data: { reply_id: string; ticket_id: string; bot: { name: string } } }
  | { type: "ai.reply.delta"; data: { reply_id: string; ticket_id: string; text: string } }
  | { type: "ai.reply.tool"; data: { reply_id: string; ticket_id: string; tool: string; status: "running" | "done" | "error" } }
  | { type: "ai.reply.ended"; data: { reply_id: string; ticket_id: string; message_id: string | null; handoff: boolean; action_id: string | null } };
