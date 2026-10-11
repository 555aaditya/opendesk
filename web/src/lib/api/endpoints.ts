// Typed wrappers for every endpoint in contracts/api.md.

import { http, stream, type StreamHandlers } from "./client";
import type * as T from "./types";

type ListQuery = { limit?: number; cursor?: string | null };

export type TicketListQuery = ListQuery & {
  status?: T.TicketStatus[];
  priority?: T.Priority[];
  /** "none": tickets without a severity. */
  severity?: (T.Severity | "none")[];
  assignee?: string;
  team_id?: string;
  mailbox_id?: string;
  tag?: string;
  channel?: T.Channel;
  contact_id?: string;
  view_id?: string;
  q?: string;
  spam?: boolean | "any";
  /** `field.<key>` sorts by a text, number, date, checkbox or select custom field. */
  sort?: "last_message_at" | "created_at" | "priority" | "severity" | "due" | `field.${string}`;
  order?: "asc" | "desc";
  /** Custom field filters, sent as `field.<key>[<op>]=<value>`. */
  fields?: T.FieldFilter[];
};

/** Flattens custom field filters into `field.<key>[<op>]` query parameters. */
export function fieldQuery(fields?: T.FieldFilter[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields ?? []) {
    // set/not_set ignore the value, but an empty value would be dropped from the URL.
    out[`field.${f.key}[${f.op}]`] = f.op === "set" || f.op === "not_set" ? "1" : f.value;
  }
  return out;
}

function listQuery<Q extends { fields?: T.FieldFilter[] }>(q: Q) {
  const { fields, ...rest } = q;
  return { ...(rest as Omit<Q, "fields">), ...fieldQuery(fields) } as Record<string, string | number | boolean | string[] | null | undefined>;
}

export type ContactListQuery = ListQuery & { q?: string; company_id?: string; tag?: string; fields?: T.FieldFilter[] };
export type CompanyListQuery = ListQuery & { q?: string; tag?: string; fields?: T.FieldFilter[] };

/** Labels and custom fields on contact and company writes. */
type LabelWrites = { tags?: string[]; add_tags?: string[]; remove_tags?: string[]; fields?: T.FieldValuesPatch };

export type CreateTicketBody = {
  subject: string;
  contact_id?: string;
  contact?: { email: string; name: string };
  channel?: "email" | "api";
  mailbox_id?: string;
  body_html: string;
  kind?: "reply" | "note";
  priority?: T.Priority;
  severity?: T.Severity;
  assignee_id?: string;
  team_id?: string;
  tags?: string[];
  fields?: T.FieldValues;
  status?: T.TicketStatus;
};

export type SendMessageBody = {
  kind: "reply" | "note";
  body_html: string;
  cc?: string[];
  bcc?: string[];
  attachment_ids?: string[];
  status?: T.TicketStatus;
};

export type CreateMailboxBody = {
  name: string;
  email: string;
  display_name?: string;
  inbound_kind: T.Mailbox["inbound_kind"];
  outbound_kind: T.Mailbox["outbound_kind"];
  config: T.MailboxConfig;
  password?: string;
  smtp_password?: string;
  team_id?: string | null;
};

const pub = { auth: false, workspace: false } as const;

/** One `file` field, as every picture upload expects. */
function imageForm(file: File | Blob): FormData {
  const fd = new FormData();
  fd.append("file", file);
  return fd;
}

/** Upload, remove and refresh routes for a contact or company picture. */
function pictureRoutes<R>(base: string) {
  return {
    uploadAvatar: (id: string, file: File | Blob) => http.put<R>(`${base}/${id}/avatar`, imageForm(file)),
    removeAvatar: (id: string) => http.del<R>(`${base}/${id}/avatar`),
    /** Looks the automatic sources up again now (202). */
    refreshAvatar: (id: string) => http.post<void>(`${base}/${id}/avatar/refresh`),
  };
}

export const api = {
  auth: {
    config: () => http.get<T.AuthConfig>("/v1/auth/config", pub),
    register: (b: { email: string; password: string; name: string; turnstile_token?: string; invite_token?: string }) =>
      http.post<T.TokenResponse>("/v1/auth/register", b, pub),
    login: (b: { email: string; password: string; turnstile_token?: string }) =>
      http.post<T.LoginResponse>("/v1/auth/login", b, pub),
    mfa: (b: { mfa_token: string; code: string }) => http.post<T.TokenResponse>("/v1/auth/mfa", b, pub),
    logout: () => http.post<void>("/v1/auth/logout", undefined, { workspace: false }),
    forgot: (email: string, turnstile_token?: string) =>
      http.post<void>("/v1/auth/password/forgot", { email, turnstile_token }, pub),
    reset: (token: string, password: string) => http.post<void>("/v1/auth/password/reset", { token, password }, pub),
    verifyEmail: (token: string) => http.post<void>("/v1/auth/email/verify", { token }, { workspace: false }),
    resendVerification: () => http.post<void>("/v1/auth/email/resend", undefined, { workspace: false }),
    oauthExchange: (code: string) => http.post<T.ExchangeResponse>("/v1/auth/oauth/exchange", { code }, pub),
    oauthLink: (link_token: string, password: string) =>
      http.post<T.LoginResponse>("/v1/auth/oauth/link", { link_token, password }, pub),
    totpSetup: () => http.post<{ secret: string; otpauth_url: string }>("/v1/auth/totp/setup", undefined, { workspace: false }),
    totpEnable: (code: string) =>
      http.post<{ recovery_codes: string[] }>("/v1/auth/totp/enable", { code }, { workspace: false }),
    totpDisable: (code: string) => http.post<void>("/v1/auth/totp/disable", { code }, { workspace: false }),
  },
  me: {
    get: () => http.get<T.Me>("/v1/me", { workspace: false }),
    /** `avatar_url` is an https picture to copy (processed in the background), or "" to remove it. */
    update: (b: { name?: string; avatar_url?: string }) => http.patch<T.User>("/v1/me", b, { workspace: false }),
    /** PNG, JPEG, GIF or WebP, at most 5 MB. */
    uploadAvatar: (file: File | Blob) => http.put<T.User>("/v1/me/avatar", imageForm(file), { workspace: false }),
    removeAvatar: () => http.del<T.User>("/v1/me/avatar", undefined, { workspace: false }),
    /** Marks you as seen, for auto-away. */
    heartbeat: () => http.post<void>("/v1/me/heartbeat", undefined, { workspace: false }),
    password: (current_password: string, new_password: string) =>
      http.post<void>("/v1/me/password", { current_password, new_password }, { workspace: false }),
    sessions: () => http.get<T.Session[] | T.Page<T.Session>>("/v1/me/sessions", { workspace: false }),
    revokeSession: (id: string) => http.del(`/v1/me/sessions/${id}`, undefined, { workspace: false }),
    delete: (b: { password?: string; code?: string }) => http.del("/v1/me", b, { workspace: false }),
  },
  workspaces: {
    create: (name: string) => http.create<T.Workspace>("/v1/workspaces", { name }, { workspace: false }),
    current: () => http.get<T.Workspace>("/v1/workspace"),
    update: (b: { name?: string; settings?: T.WorkspaceSettings }) => http.patch<T.Workspace>("/v1/workspace", b),
    delete: (confirm_name: string) => http.del("/v1/workspace", { confirm_name }),
    transfer: (user_id: string) => http.post<void>("/v1/workspace/transfer", { user_id }),
    rotateWidgetSecret: () => http.post<{ secret: string }>("/v1/workspace/widget-secret/rotate"),
    /** `logo` is the workspace avatar_url; the others fill `images`. Admin. */
    uploadImage: (slot: "logo" | T.WorkspaceImageSlot, file: File | Blob) =>
      http.put<T.Workspace>(`/v1/workspace/images/${slot}`, imageForm(file)),
    removeImage: (slot: "logo" | T.WorkspaceImageSlot) => http.del<T.Workspace>(`/v1/workspace/images/${slot}`),
  },
  members: {
    list: () => http.get<T.Page<T.Member>>("/v1/members"),
    update: (userId: string, role: T.Role) => http.patch<T.Member>(`/v1/members/${userId}`, { role }),
    remove: (userId: string) => http.del(`/v1/members/${userId}`),
    /** `userId` may be "me". Members set their own availability; admins anyone's, and the cap. */
    setAvailability: (userId: string, b: { availability?: T.Availability; max_open_tickets?: number | null }) =>
      http.patch<T.Member>(`/v1/members/${userId}/availability`, b),
  },
  assignment: {
    get: () => http.get<T.Assignment>("/v1/assignment"),
    /** `rules` replaces the whole list. Admin. */
    update: (b: Partial<T.Assignment>) => http.patch<T.Assignment>("/v1/assignment", b),
  },
  triage: {
    get: () => http.get<T.TriageSettings>("/v1/triage"),
    update: (b: Partial<Omit<T.TriageSettings, "available">>) => http.patch<T.TriageSettings>("/v1/triage", b),
  },
  businessHours: {
    get: () => http.get<T.BusinessHours>("/v1/business-hours"),
    /** The full object; `timezone` sets the workspace timezone. Admin. */
    put: (b: T.BusinessHours) => http.put<T.BusinessHours>("/v1/business-hours", b),
  },
  onboarding: {
    get: () => http.get<T.Onboarding>("/v1/onboarding"),
    dismiss: () => http.post<void>("/v1/onboarding/dismiss"),
  },
  invitations: {
    list: () => http.get<T.Page<T.Invitation>>("/v1/invitations"),
    create: (b: { email: string; role: T.Role }) => http.create<T.Invitation>("/v1/invitations", b),
    revoke: (id: string) => http.del(`/v1/invitations/${id}`),
    accept: (token: string) => http.post<T.Membership>("/v1/invitations/accept", { token }, { workspace: false }),
    lookup: (token: string) =>
      http.get<{ workspace_name: string; email: string; role: T.Role }>("/v1/invitations/lookup", { ...pub, query: { token } }),
  },
  teams: crud<T.Team, { name: string; member_ids: string[] }>("/v1/teams"),
  apiKeys: {
    ...crud<T.ApiKey, { name: string; scopes: string[]; expires_at?: string | null }>("/v1/api-keys"),
    create: (b: { name: string; scopes: string[]; expires_at?: string | null }) =>
      http.create<T.ApiKey & { secret: string }>("/v1/api-keys", b),
  },
  webhooks: {
    ...crud<T.Webhook, { url: string; description: string; events: string[]; enabled: boolean }>("/v1/webhooks"),
    create: (b: { url: string; description: string; events: string[]; enabled: boolean }) =>
      http.create<T.Webhook & { secret: string }>("/v1/webhooks", b),
    deliveries: (id: string, q?: ListQuery) =>
      http.get<T.Page<T.WebhookDelivery>>(`/v1/webhooks/${id}/deliveries`, { query: q }),
    test: (id: string) => http.post<T.WebhookDelivery>(`/v1/webhooks/${id}/test`),
  },
  auditLogs: (q?: ListQuery & { action?: string; entity_type?: string }) => http.get<T.Page<T.AuditLog>>("/v1/audit-logs", { query: q }),
  events: (since: number, limit = 500) => http.get<T.EventsPage>("/v1/events", { query: { since, limit } }),
  realtimeToken: () => http.post<{ token: string; url: string; expires_at: string }>("/v1/realtime/token"),
  notifications: {
    list: (q?: ListQuery & { unread?: boolean }) => http.get<T.Page<T.Notification>>("/v1/notifications", { query: q }),
    read: (b: { ids?: string[]; all?: boolean }) => http.post<void>("/v1/notifications/read", b),
  },

  tickets: {
    list: (q: TicketListQuery) => http.get<T.Page<T.Ticket>>("/v1/tickets", { query: listQuery(q) }),
    counts: () => http.get<T.TicketCounts>("/v1/tickets/counts"),
    create: (b: CreateTicketBody) => http.create<T.Ticket>("/v1/tickets", b),
    get: (id: string) => http.get<T.Ticket>(`/v1/tickets/${encodeURIComponent(id)}`),
    update: (id: string, patch: T.TicketPatch) => http.patch<T.Ticket>(`/v1/tickets/${id}`, patch),
    delete: (id: string) => http.del(`/v1/tickets/${id}`),
    bulk: (b: { ids: string[]; patch?: T.TicketPatch; delete?: true }) =>
      http.post<{ data: T.Ticket[]; updated: number; deleted: number } | undefined>("/v1/tickets/bulk", b),
    merge: (id: string, into_id: string) => http.post<T.Ticket>(`/v1/tickets/${id}/merge`, { into_id }),
    messages: (id: string) => http.get<T.Page<T.Message>>(`/v1/tickets/${id}/messages`),
    send: (id: string, b: SendMessageBody) => http.create<T.Message>(`/v1/tickets/${id}/messages`, b),
    activities: (id: string) => http.get<T.Page<T.Activity>>(`/v1/tickets/${id}/activities`),
  },
  messages: {
    original: (id: string) => http.get<{ full_html: string }>(`/v1/messages/${id}/original`),
  },
  contacts: {
    ...crud<T.Contact, Partial<Pick<T.Contact, "name" | "email" | "phone" | "notes" | "external_id" | "blocked" | "custom">> & { company_id?: string | null } & LabelWrites>("/v1/contacts"),
    search: (q: ContactListQuery) => http.get<T.Page<T.Contact>>("/v1/contacts", { query: listQuery(q) }),
    tickets: (id: string, q?: ListQuery) => http.get<T.Page<T.Ticket>>(`/v1/contacts/${id}/tickets`, { query: q }),
    ...pictureRoutes<T.Contact>("/v1/contacts"),
  },
  companies: {
    ...crud<T.Company, Partial<Pick<T.Company, "name" | "domain" | "notes" | "custom">> & LabelWrites>("/v1/companies"),
    search: (q: CompanyListQuery) => http.get<T.Page<T.Company>>("/v1/companies", { query: listQuery(q) }),
    ...pictureRoutes<T.Company>("/v1/companies"),
  },
  /** Labels (contracts/api.md "Labels and custom fields"). Writes need admin. */
  tags: {
    ...crud<T.Tag, T.TagInput>("/v1/tags"),
    list: (q?: { q?: string; group_id?: string | "none"; archived?: boolean | "any"; applies_to?: T.LabelScope }) =>
      http.get<T.Page<T.Tag>>("/v1/tags", { query: q }),
    merge: (id: string, into: string) => http.post<T.Tag>(`/v1/tags/${id}/merge`, { into }),
    reorder: (ids: string[]) => http.post<T.Page<T.Tag>>("/v1/tags/reorder", { ids }),
  },
  tagGroups: {
    ...crud<T.TagGroup, T.TagGroupInput>("/v1/tag-groups"),
    reorder: (ids: string[]) => http.post<T.Page<T.TagGroup>>("/v1/tag-groups/reorder", { ids }),
  },
  customFields: {
    list: (q?: { entity?: T.FieldEntity; archived?: boolean | "any" }) => http.get<T.Page<T.CustomField>>("/v1/custom-fields", { query: q }),
    get: (id: string) => http.get<T.CustomField>(`/v1/custom-fields/${id}`),
    create: (b: T.CustomFieldInput) => http.create<T.CustomField>("/v1/custom-fields", b),
    update: (id: string, b: T.CustomFieldPatch) => http.patch<T.CustomField>(`/v1/custom-fields/${id}`, b),
    remove: (id: string) => http.del(`/v1/custom-fields/${id}`),
    reorder: (entity: T.FieldEntity, ids: string[]) => http.post<T.Page<T.CustomField>>("/v1/custom-fields/reorder", { entity, ids }),
  },
  savedReplies: crud<T.SavedReply, { title: string; shortcut: string; body_html: string }>("/v1/saved-replies"),
  views: crud<T.View, { name: string; filters: T.TicketFilters; shared: boolean; position?: number }>("/v1/views"),
  slaPolicies: crud<T.SlaPolicy, Omit<T.SlaPolicy, "id" | "business_hours"> & { business_hours?: boolean }>("/v1/sla-policies"),
  automations: crud<T.Automation, Omit<T.Automation, "id" | "run_count">>("/v1/automations"),
  kb: {
    collections: crud<T.KbCollection, { name: string; slug?: string; description: string; position?: number }>("/v1/kb/collections"),
    articles: {
      ...crud<T.KbArticle, { title: string; slug?: string; collection_id: string | null; body_html: string; excerpt?: string; status: T.KbArticle["status"] }>("/v1/kb/articles"),
      search: (q: ListQuery & { collection_id?: string; status?: T.KbArticle["status"]; q?: string }) =>
        http.get<T.Page<T.KbArticle>>("/v1/kb/articles", { query: q }),
    },
  },
  search: (q: string) => http.get<T.SearchResults>("/v1/search", { query: { q } }),
  reports: {
    overview: (r: T.ReportsRange) => http.get<T.ReportsOverview>("/v1/reports/overview", { query: r }),
  },
  attachments: {
    upload: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return http.create<T.Attachment>("/v1/attachments", fd);
    },
  },
  widgetSettings: {
    get: () => http.get<T.WidgetSettings>("/v1/widget/settings"),
    update: (b: Partial<T.WidgetSettings>) => http.patch<T.WidgetSettings>("/v1/widget/settings", b),
  },
  mailboxes: {
    ...crud<T.Mailbox, Partial<CreateMailboxBody> & Partial<Pick<T.Mailbox, "signature_html" | "auto_reply_enabled" | "auto_reply_subject" | "auto_reply_html" | "status">>>("/v1/mailboxes"),
    create: (b: CreateMailboxBody) => http.create<T.Mailbox>("/v1/mailboxes", b),
    test: (id: string) => http.post<T.MailboxTest>(`/v1/mailboxes/${id}/test`),
    oauthStart: (provider: "google" | "microsoft", b: { mailbox_id?: string; name: string; email?: string }) =>
      http.post<{ url: string }>(`/v1/mailboxes/oauth/${provider}/start`, b),
  },
  billing: {
    get: () => http.get<T.Billing>("/v1/billing"),
    checkout: (interval: "month" | "year") => http.post<{ url: string }>("/v1/billing/checkout", { interval }),
    portal: () => http.post<{ url: string }>("/v1/billing/portal"),
    creditsCheckout: (packs: number) => http.post<{ url: string }>("/v1/billing/credits/checkout", { packs }),
    usage: (r: { from: string; to: string }) => http.get<T.BillingUsage>("/v1/billing/usage", { query: r }),
  },
  ai: {
    config: () => http.get<T.AIConfig>("/v1/ai/config"),
    updateSettings: (b: Partial<T.AISettings>) => http.patch<T.AISettings>("/v1/ai/settings", b),
    /** Streams `delta` text; resolves with the full draft at `done`. */
    draft: (ticketId: string, b: { instructions?: string; tone?: string }, h?: StreamHandlers) =>
      stream<T.AIDraft>(`/v1/tickets/${ticketId}/ai/draft`, b, h),
    summary: (ticketId: string) => http.post<T.AISummary>(`/v1/tickets/${ticketId}/ai/summary`, {}),
    ask: (ticketId: string, question: string, h?: StreamHandlers) => stream<T.AIAnswer>(`/v1/tickets/${ticketId}/ai/ask`, { question }, h),
    triage: (ticketId: string, apply: boolean) => http.post<T.Triage>(`/v1/tickets/${ticketId}/ai/triage`, { apply }),
    /** Dismisses Ollie's suggestion for one field; accepting is setting the field. */
    dismissSuggestion: (ticketId: string, field: T.SuggestionField) => http.del(`/v1/tickets/${ticketId}/ai/suggestions/${field}`),
    rewrite: (b: { html: string; mode: T.RewriteMode; instructions?: string }, h?: StreamHandlers) => stream<{ html: string }>("/v1/ai/rewrite", b, h),
    translate: (b: { html?: string; text?: string; target: string }) => http.post<T.TranslateResult>("/v1/ai/translate", b),
    kbDraft: (b: { ticket_ids?: string[]; topic?: string }) => http.post<T.KBArticleDraft>("/v1/kb/articles/ai/draft", b),
    search: (q: string) => http.get<T.SearchResults>("/v1/ai/search", { query: { q } }),
  },
  public: {
    help: (slug: string) => http.get<T.PublicHelpHome>(`/v1/public/help/${slug}`, pub),
    collection: (slug: string, c: string) => http.get<T.PublicCollection>(`/v1/public/help/${slug}/collections/${c}`, pub),
    article: (slug: string, a: string) => http.get<T.KbArticle>(`/v1/public/help/${slug}/articles/${a}`, pub),
    search: (slug: string, q: string) => http.get<T.KbArticle[]>(`/v1/public/help/${slug}/search`, { ...pub, query: { q } }),
    csat: (token: string) =>
      http.get<T.CsatSurvey>(`/v1/public/csat/${token}`, pub),
    submitCsat: (token: string, b: { score: number; comment?: string }) => http.post<void>(`/v1/public/csat/${token}`, b, pub),
  },
};

function crud<R, B>(base: string) {
  return {
    list: (q?: ListQuery & Record<string, string | number | boolean | undefined | null>) =>
      http.get<T.Page<R>>(base, { query: q }),
    get: (id: string) => http.get<R>(`${base}/${id}`),
    create: (b: B) => http.create<R>(base, b),
    update: (id: string, b: Partial<B>) => http.patch<R>(`${base}/${id}`, b),
    remove: (id: string) => http.del(`${base}/${id}`),
  };
}

/** Lists may come back bare or wrapped; read either. */
export function rows<R>(r: R[] | T.Page<R> | undefined | null): R[] {
  if (!r) return [];
  return Array.isArray(r) ? r : r.data;
}
