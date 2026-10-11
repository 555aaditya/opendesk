// Resource shapes, exactly as contracts/api.md defines them.

export type Role = "owner" | "admin" | "agent" | "viewer";

export type User = {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  email_verified: boolean;
  totp_enabled: boolean;
  created_at: string;
};
export type UserRef = { id: string; name: string; email: string; avatar_url: string };

export type WorkspaceSettings = {
  brand_color?: string;
  timezone?: string;
  help_center_enabled?: boolean;
  help_center_title?: string;
  csat_enabled?: boolean;
  auto_assign?: "none" | "round_robin";
  /** Default language (BCP 47) for customer-facing pages when the visitor's browser has no match. */
  locale?: string;
  ai?: AISettings;
};
export type Workspace = {
  id: string;
  name: string;
  slug: string;
  widget_key: string;
  settings: WorkspaceSettings;
  created_at: string;
};
export type Membership = { workspace: Workspace; role: Role };
export type Member = { user: UserRef; role: Role; created_at: string };
export type Invitation = {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  created_at: string;
  invited_by: UserRef | null;
};
export type Team = { id: string; name: string; member_ids: string[]; created_at: string };

export type CompanyRef = { id: string; name: string; domain: string };
export type Contact = {
  id: string;
  email: string | null;
  name: string;
  phone: string;
  avatar_url: string;
  company: CompanyRef | null;
  external_id: string | null;
  notes: string;
  custom: Record<string, unknown>;
  blocked: boolean;
  ticket_count: number;
  created_at: string;
  updated_at: string;
};
export type ContactRef = { id: string; email: string | null; name: string; avatar_url: string };
export type Company = {
  id: string;
  name: string;
  domain: string;
  notes: string;
  custom: Record<string, unknown>;
  contact_count: number;
  created_at: string;
  updated_at: string;
};

export type TicketStatus = "open" | "pending" | "on_hold" | "solved" | "closed";
export type Priority = "low" | "normal" | "high" | "urgent";
export type Channel = "email" | "chat" | "api" | "portal";
export type Tag = { id: string; name: string };
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
  channel: Channel;
  mailbox_id: string | null;
  contact: ContactRef | null;
  assignee: UserRef | null;
  team_id: string | null;
  tags: Tag[];
  sla: TicketSla | null;
  first_responded_at: string | null;
  solved_at: string | null;
  snoozed_until: string | null;
  last_message_at: string;
  last_customer_message_at: string | null;
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
  created_at: string;
};
export type ActivityType =
  | "status_changed"
  | "priority_changed"
  | "assigned"
  | "team_changed"
  | "tagged"
  | "untagged"
  | "sla_breached"
  | "merged"
  | "csat_received"
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
  assignee?: "me" | "none" | string;
  team_id?: string;
  mailbox_id?: string;
  tag?: string;
  channel?: Channel;
  q?: string;
};
export type View = { id: string; name: string; shared: boolean; filters: TicketFilters; position: number };
export type SlaPolicy = {
  id: string;
  name: string;
  priority: Priority | null;
  first_response_minutes: number;
  resolution_minutes: number;
  enabled: boolean;
  position: number;
};

export type AutomationTrigger = "ticket_created" | "customer_replied" | "agent_replied" | "ticket_updated";
export type ConditionField = "subject" | "body" | "from_email" | "channel" | "mailbox_id" | "priority" | "status" | "tag" | "sentiment";
/** `eq` is the AI sentiment condition's operator (contracts/ai.md). */
export type ConditionOp = "contains" | "not_contains" | "equals" | "not_equals" | "eq";
export type Condition = { field: ConditionField; op: ConditionOp; value: string };
export type ActionType =
  | "set_status"
  | "set_priority"
  | "assign_user"
  | "assign_team"
  | "add_tag"
  | "remove_tag"
  | "send_reply"
  | "add_note"
  | "mark_spam"
  | "ai_triage";
export type Action = { type: ActionType; value: string };
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
export type NotificationType = "assigned" | "mentioned" | "customer_replied" | "sla_breached";
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
  topics: string[];
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
  by_agent: { user: UserRef; solved: number; first_response_p50_minutes: number | null }[];
};

export type MailboxTest = { inbound: { ok: boolean; error: string }; outbound: { ok: boolean; error: string } };

export type WidgetSettings = {
  greeting: string;
  require_email: boolean;
  enabled: boolean;
  allowed_origins: string[];
};

export type PublicHelpHome = { title: string; collections: KbCollection[]; featured: KbArticle[]; locale?: string };
export type PublicCollection = { collection: KbCollection; articles: KbArticle[] };

export type TicketPatch = {
  subject?: string;
  status?: TicketStatus;
  priority?: Priority;
  assignee_id?: string | null;
  team_id?: string | null;
  snoozed_until?: string | null;
  spam?: boolean;
  tags?: string[];
  custom?: Record<string, unknown>;
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
export type AIFeature = "summarize" | "rewrite" | "translate" | "triage" | "copilot" | "draft_reply" | "answer" | "kb_draft";
/** GET /v1/billing/usage. Shape assumed: the contract names the three breakdowns only. */
export type BillingUsage = {
  from: string;
  to: string;
  total: { credits: number; calls: number };
  by_feature: { feature: AIFeature; credits: number; calls: number }[];
  by_day: { date: string; credits: number; by_feature?: Partial<Record<AIFeature, number>> }[];
  by_member: { user: UserRef | null; credits: number; calls: number }[];
};

// AI (contracts/ai.md).
export type Sentiment = "positive" | "neutral" | "negative" | "frustrated";
export type AISettings = {
  enabled: boolean;
  auto_triage: boolean;
  auto_summarize: boolean;
  widget_answers: boolean;
  tone: string;
  reply_language: "customer" | "workspace";
  instructions: string;
};
export type AIConfig = {
  enabled: boolean;
  provider: string;
  models: { default: string; fast: string };
  embeddings: boolean;
  features: AISettings;
  costs: Partial<Record<AIFeature, number>>;
};
export type KBSource = { article_id: string; title: string; url: string };
export type AIDraft = { body_html: string; body_text: string; sources: KBSource[] };
export type AISummary = { summary: string; key_points: string[]; sentiment: Sentiment; updated_at: string };
export type AIAnswer = { answer_html: string; sources: KBSource[] };
export type Triage = {
  tags: string[];
  priority: Priority;
  sentiment: Sentiment;
  language: string;
  category: string;
  summary: string;
  applied: boolean;
};
export type RewriteMode = "friendlier" | "more_formal" | "shorter" | "longer" | "fix_grammar" | "simplify";
export type TranslateResult = { html?: string; text?: string; source_language: string };
export type KBArticleDraft = { title: string; body_html: string; excerpt: string };
