// Contacts, companies, tags, saved replies, views, SLA, automations, the
// knowledge base, mailboxes and the public help center / CSAT pages.

import type {
  Action,
  Automation,
  Company,
  Condition,
  Contact,
  KbArticle,
  KbCollection,
  Mailbox,
  MailboxConfig,
  Priority,
  SavedReply,
  SlaPolicy,
  TicketFilters,
  View,
} from "@/lib/api/types";
import { db, userRef, type WsData } from "../db";
import { publish } from "../gateway";
import { HttpError, del, get, invalid, notFound, paginate, patch, post, required, respond, s, strArr, type Ctx } from "../router";
import { applyLabels, canCreateLabels, fieldFiltersFromQuery, fieldsText, matchFields, mergeFields } from "../labels";
import { addActivity, publishTicketUpdated, sortTickets } from "../tickets";
import { isRecord, nowIso, randomToken, slugify, uuid } from "../util";
import { checkLimit } from "./billing";
import { assign, crud } from "./crud";

function contactOut(ws: WsData, c: Contact): Contact {
  c.ticket_count = ws.tickets.filter((t) => t.contact?.id === c.id && !ws.deletedTickets.has(t.id)).length;
  return c;
}

function companyOut(ws: WsData, c: Company): Company {
  c.contact_count = ws.contacts.filter((x) => x.company?.id === c.id).length;
  return c;
}

function setCompany(ws: WsData, c: Contact, companyId: unknown) {
  if (companyId === null || companyId === "") c.company = null;
  else if (typeof companyId === "string") {
    const co = ws.companies.find((x) => x.id === companyId);
    if (!co) throw invalid("Unknown company");
    c.company = { id: co.id, name: co.name, domain: co.domain, avatar_url: co.avatar_url };
  }
}

/** tags (replace), add_tags and remove_tags on a contact or company write. */
function writeLabels(ctx: Ctx, scope: "contacts" | "companies", row: Contact | Company): boolean {
  const replace = strArr(ctx.body.tags);
  const add = strArr(ctx.body.add_tags);
  const remove = strArr(ctx.body.remove_tags);
  if (!replace && !add?.length && !remove?.length) return false;
  const r = applyLabels(ctx.ws, scope, row.tags, { replace, add, remove }, { create: canCreateLabels(ctx.ws) });
  row.tags = r.next;
  return r.added.length + r.removed.length > 0;
}

function writeFields(ctx: Ctx, entity: "contact" | "company", row: Contact | Company): boolean {
  if (!isRecord(ctx.body.fields)) return false;
  const r = mergeFields(ctx.ws, entity, row.fields, ctx.body.fields);
  row.fields = r.next;
  return r.changes.length > 0;
}

function recordFilter<R extends Contact | Company>(ctx: Ctx, entity: "contact" | "company", list: R[]): R[] {
  const tag = ctx.query.get("tag")?.trim().toLowerCase();
  const ff = fieldFiltersFromQuery(ctx.ws, entity, ctx.query);
  return list.filter((r) => (!tag || r.tags.some((x) => x.name.toLowerCase() === tag)) && matchFields(ctx.ws, entity, r.fields, ff));
}

function syncContactRefs(ws: WsData, c: Contact) {
  for (const t of ws.tickets) if (t.contact?.id === c.id) t.contact = { id: c.id, email: c.email, name: c.name, avatar_url: c.avatar_url };
}

export function registerResources() {
  // Contacts.
  get("/v1/contacts", (ctx) => {
    const q = (ctx.query.get("q") ?? "").toLowerCase().trim();
    const company = ctx.query.get("company_id");
    let list = ctx.ws.contacts;
    if (company) list = list.filter((c) => c.company?.id === company);
    list = recordFilter(ctx, "contact", list);
    if (q) list = list.filter((c) => [c.name, c.email ?? "", c.company?.name ?? "", c.phone, fieldsText(c.fields)].join(" ").toLowerCase().includes(q));
    list = list.slice().sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    const page = paginate(ctx, list);
    return { ...page, data: page.data.map((c) => contactOut(ctx.ws, c)) };
  });
  get("/v1/contacts/:id", (ctx) => contactOut(ctx.ws, findContact(ctx)));
  post("/v1/contacts", (ctx) => {
    const email = s(ctx, "email")?.trim().toLowerCase() || null;
    const name = s(ctx, "name")?.trim() || email?.split("@")[0] || "";
    if (!name) throw invalid("Name or email is required");
    if (email && ctx.ws.contacts.some((c) => c.email === email)) throw new HttpError(409, "conflict", "A contact with this email already exists");
    const c: Contact = { id: uuid(), email, name: name.slice(0, 80), phone: s(ctx, "phone") ?? "", avatar_url: null, avatar_source: null, company: null, external_id: s(ctx, "external_id") ?? null, notes: s(ctx, "notes") ?? "", custom: isRecord(ctx.body.custom) ? ctx.body.custom : {}, tags: [], fields: {}, blocked: false, ticket_count: 0, created_at: nowIso(), updated_at: nowIso() };
    setCompany(ctx.ws, c, ctx.body.company_id);
    writeLabels(ctx, "contacts", c);
    writeFields(ctx, "contact", c);
    ctx.ws.contacts.unshift(c);
    publish(ctx.ws, "contact.created", { contact: c });
    return respond(201, c);
  });
  patch("/v1/contacts/:id", (ctx) => {
    const c = findContact(ctx);
    if ("name" in ctx.body && !s(ctx, "name")?.trim()) throw invalid("Name can't be empty");
    if (s(ctx, "email")) {
      const email = s(ctx, "email")!.trim().toLowerCase();
      if (ctx.ws.contacts.some((x) => x.email === email && x.id !== c.id)) throw new HttpError(409, "conflict", "Another contact already uses this email");
      c.email = email;
    }
    writeLabels(ctx, "contacts", c);
    writeFields(ctx, "contact", c);
    assign(c, ctx.body, ["name", "phone", "notes", "external_id", "blocked", "custom"]);
    if ("company_id" in ctx.body) setCompany(ctx.ws, c, ctx.body.company_id);
    c.updated_at = nowIso();
    syncContactRefs(ctx.ws, c);
    publish(ctx.ws, "contact.updated", { contact: contactOut(ctx.ws, c) });
    return c;
  });
  del("/v1/contacts/:id", (ctx) => {
    const c = findContact(ctx);
    ctx.ws.contacts = ctx.ws.contacts.filter((x) => x !== c);
    publish(ctx.ws, "contact.deleted", { contact_id: c.id });
    return respond(204);
  });
  get("/v1/contacts/:id/tickets", (ctx) => {
    const c = findContact(ctx);
    const list = ctx.ws.tickets.filter((t) => t.contact?.id === c.id && !ctx.ws.deletedTickets.has(t.id));
    return paginate(ctx, sortTickets(list, "last_message_at", "desc"));
  });

  // Companies.
  get("/v1/companies", (ctx) => {
    const q = (ctx.query.get("q") ?? "").toLowerCase().trim();
    let list = ctx.ws.companies;
    list = recordFilter(ctx, "company", list);
    if (q) list = list.filter((c) => [c.name, c.domain, fieldsText(c.fields)].join(" ").toLowerCase().includes(q));
    list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    const page = paginate(ctx, list);
    return { ...page, data: page.data.map((c) => companyOut(ctx.ws, c)) };
  });
  get("/v1/companies/:id", (ctx) => companyOut(ctx.ws, findCompany(ctx)));
  post("/v1/companies", (ctx) => {
    const name = required(ctx, "name").slice(0, 80);
    const c: Company = { id: uuid(), name, domain: (s(ctx, "domain") ?? "").toLowerCase(), avatar_url: null, avatar_source: null, notes: s(ctx, "notes") ?? "", custom: isRecord(ctx.body.custom) ? ctx.body.custom : {}, tags: [], fields: {}, contact_count: 0, created_at: nowIso(), updated_at: nowIso() };
    writeLabels(ctx, "companies", c);
    writeFields(ctx, "company", c);
    ctx.ws.companies.push(c);
    publish(ctx.ws, "company.created", { company: c });
    return respond(201, c);
  });
  patch("/v1/companies/:id", (ctx) => {
    const c = findCompany(ctx);
    if ("name" in ctx.body && !s(ctx, "name")?.trim()) throw invalid("Name can't be empty");
    writeLabels(ctx, "companies", c);
    writeFields(ctx, "company", c);
    assign(c, ctx.body, ["name", "domain", "notes", "custom"]);
    c.updated_at = nowIso();
    for (const ct of ctx.ws.contacts) if (ct.company?.id === c.id) ct.company = { id: c.id, name: c.name, domain: c.domain, avatar_url: c.avatar_url };
    publish(ctx.ws, "company.updated", { company: companyOut(ctx.ws, c) });
    return c;
  });
  del("/v1/companies/:id", (ctx) => {
    const c = findCompany(ctx);
    ctx.ws.companies = ctx.ws.companies.filter((x) => x !== c);
    for (const ct of ctx.ws.contacts) if (ct.company?.id === c.id) ct.company = null;
    publish(ctx.ws, "company.deleted", { company_id: c.id });
    return respond(204);
  });

  crud<SavedReply>({
    path: "/v1/saved-replies",
    resource: "saved_reply",
    label: "saved reply",
    list: (ws) => ws.savedReplies,
    sort: (a, b) => a.title.localeCompare(b.title),
    create: (ctx, id) => ({ id, title: required(ctx, "title").slice(0, 100), shortcut: slugify(s(ctx, "shortcut") ?? "").slice(0, 30), body_html: required(ctx, "body_html"), created_at: nowIso(), updated_at: nowIso() }),
    update: (ctx, row) => {
      assign(row, ctx.body, ["title", "body_html"]);
      if (s(ctx, "shortcut") !== undefined) row.shortcut = slugify(s(ctx, "shortcut")!).slice(0, 30);
      row.updated_at = nowIso();
    },
  });

  crud<View>({
    path: "/v1/views",
    resource: "view",
    list: (ws) => ws.views,
    sort: (a, b) => a.position - b.position,
    create: (ctx, id) => ({ id, name: required(ctx, "name").slice(0, 60), shared: ctx.body.shared === true, filters: isRecord(ctx.body.filters) ? (ctx.body.filters as TicketFilters) : {}, position: typeof ctx.body.position === "number" ? ctx.body.position : ctx.ws.views.length }),
    update: (ctx, row) => {
      assign(row, ctx.body, ["name", "shared", "position"]);
      if (isRecord(ctx.body.filters)) row.filters = ctx.body.filters as TicketFilters;
    },
  });

  crud<SlaPolicy>({
    path: "/v1/sla-policies",
    resource: "sla_policy",
    label: "SLA policy",
    list: (ws) => ws.sla,
    sort: (a, b) => a.position - b.position,
    create: (ctx, id) => ({
      id,
      name: required(ctx, "name").slice(0, 60),
      priority: (s(ctx, "priority") as Priority | undefined) ?? null,
      first_response_minutes: positive(ctx.body.first_response_minutes, "first_response_minutes"),
      resolution_minutes: positive(ctx.body.resolution_minutes, "resolution_minutes"),
      business_hours: ctx.body.business_hours === true,
      enabled: ctx.body.enabled !== false,
      position: typeof ctx.body.position === "number" ? ctx.body.position : ctx.ws.sla.length,
    }),
    update: (ctx, row) => {
      assign(row, ctx.body, ["name", "enabled", "position", "business_hours"]);
      if ("priority" in ctx.body) row.priority = (s(ctx, "priority") as Priority | undefined) ?? null;
      if ("first_response_minutes" in ctx.body) row.first_response_minutes = positive(ctx.body.first_response_minutes, "first_response_minutes");
      if ("resolution_minutes" in ctx.body) row.resolution_minutes = positive(ctx.body.resolution_minutes, "resolution_minutes");
    },
  });

  crud<Automation>({
    path: "/v1/automations",
    resource: "automation",
    list: (ws) => ws.automations,
    sort: (a, b) => a.position - b.position,
    create: (ctx, id) => ({
      id,
      name: required(ctx, "name").slice(0, 80),
      trigger: (s(ctx, "trigger") as Automation["trigger"] | undefined) ?? "ticket_created",
      conditions: conditions(ctx.body.conditions),
      actions: actions(ctx.body.actions, true),
      enabled: ctx.body.enabled !== false,
      position: ctx.ws.automations.length,
      run_count: 0,
    }),
    update: (ctx, row) => {
      assign(row, ctx.body, ["name", "trigger", "enabled", "position"]);
      if ("conditions" in ctx.body) row.conditions = conditions(ctx.body.conditions);
      if ("actions" in ctx.body) row.actions = actions(ctx.body.actions, true);
    },
  });

  // Knowledge base.
  crud<KbCollection>({
    path: "/v1/kb/collections",
    resource: "kb_collection",
    label: "collection",
    list: (ws) => ws.collections,
    sort: (a, b) => a.position - b.position,
    create: (ctx, id) => {
      const name = required(ctx, "name").slice(0, 80);
      return { id, name, slug: uniqueSlug(ctx.ws.collections, slugify(s(ctx, "slug") || name)), description: s(ctx, "description") ?? "", position: ctx.ws.collections.length, article_count: 0 };
    },
    update: (ctx, row) => {
      assign(row, ctx.body, ["name", "description", "position"]);
      if (s(ctx, "slug")) row.slug = uniqueSlug(ctx.ws.collections.filter((c) => c !== row), slugify(s(ctx, "slug")!));
    },
    beforeDelete: (ctx, row) => {
      for (const a of ctx.ws.articles) if (a.collection_id === row.id) a.collection_id = null;
    },
  });

  get("/v1/kb/articles", (ctx) => {
    const col = ctx.query.get("collection_id");
    const status = ctx.query.get("status");
    const q = (ctx.query.get("q") ?? "").toLowerCase().trim();
    let list = ctx.ws.articles;
    if (col) list = list.filter((a) => a.collection_id === col);
    if (status) list = list.filter((a) => a.status === status);
    if (q) list = list.filter((a) => (a.title + " " + a.excerpt + " " + a.body_html).toLowerCase().includes(q));
    return paginate(ctx, list.slice().sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)), 100);
  });
  get("/v1/kb/articles/:id", (ctx) => findArticle(ctx));
  post("/v1/kb/articles", (ctx) => {
    const title = required(ctx, "title").slice(0, 160);
    const status = s(ctx, "status") === "published" ? "published" : "draft";
    const a: KbArticle = {
      id: uuid(),
      collection_id: s(ctx, "collection_id") ?? null,
      title,
      slug: uniqueSlug(ctx.ws.articles, slugify(s(ctx, "slug") || title)),
      excerpt: s(ctx, "excerpt") ?? "",
      body_html: s(ctx, "body_html") ?? "",
      status,
      author: userRef(db.meId),
      views: 0,
      published_at: status === "published" ? nowIso() : null,
      updated_at: nowIso(),
    };
    ctx.ws.articles.unshift(a);
    recountCollections(ctx.ws);
    publish(ctx.ws, "kb_article.created", { kb_article: a });
    return respond(201, a);
  });
  patch("/v1/kb/articles/:id", (ctx) => {
    const a = findArticle(ctx);
    if ("title" in ctx.body && !s(ctx, "title")?.trim()) throw invalid("Title can't be empty");
    assign(a, ctx.body, ["title", "excerpt", "body_html"]);
    if ("collection_id" in ctx.body) a.collection_id = s(ctx, "collection_id") ?? null;
    if (s(ctx, "slug")) a.slug = uniqueSlug(ctx.ws.articles.filter((x) => x !== a), slugify(s(ctx, "slug")!));
    const status = s(ctx, "status");
    if (status === "published" || status === "draft") {
      if (status === "published" && a.status !== "published") a.published_at = nowIso();
      if (status === "draft") a.published_at = null;
      a.status = status;
    }
    a.updated_at = nowIso();
    recountCollections(ctx.ws);
    publish(ctx.ws, "kb_article.updated", { kb_article: a });
    return a;
  });
  del("/v1/kb/articles/:id", (ctx) => {
    const a = findArticle(ctx);
    ctx.ws.articles = ctx.ws.articles.filter((x) => x !== a);
    recountCollections(ctx.ws);
    publish(ctx.ws, "kb_article.deleted", { kb_article_id: a.id });
    return respond(204);
  });

  // Mailboxes.
  get("/v1/mailboxes", (ctx) => paginate(ctx, ctx.ws.mailboxes, 100));
  get("/v1/mailboxes/:id", (ctx) => findMailbox(ctx));
  post("/v1/mailboxes", (ctx) => {
    checkLimit(ctx.ws, "mailbox");
    const email = required(ctx, "email").toLowerCase();
    if (ctx.ws.mailboxes.some((m) => m.email === email)) throw new HttpError(409, "conflict", "A mailbox with this address already exists");
    const inbound = (s(ctx, "inbound_kind") ?? "forwarding") as Mailbox["inbound_kind"];
    const outbound = (s(ctx, "outbound_kind") ?? "system") as Mailbox["outbound_kind"];
    const config = isRecord(ctx.body.config) ? (ctx.body.config as MailboxConfig) : {};
    if (inbound === "imap" && (!config.imap_host || !config.imap_username)) throw invalid("IMAP host and username are required");
    if (outbound === "smtp" && (!config.smtp_host || !config.smtp_username)) throw invalid("SMTP host and username are required");
    const m = mailbox(ctx.ws, { name: required(ctx, "name"), email, display_name: s(ctx, "display_name") ?? "", inbound_kind: inbound, outbound_kind: outbound, config, team_id: s(ctx, "team_id") ?? null });
    if ((s(ctx, "password") ?? "") === "wrong" || (s(ctx, "smtp_password") ?? "") === "wrong") {
      m.status = "error";
      m.last_error = "IMAP login failed: [AUTHENTICATIONFAILED] Invalid credentials";
    }
    publish(ctx.ws, "mailbox.created", { mailbox: m });
    return respond(201, m);
  });
  patch("/v1/mailboxes/:id", (ctx) => {
    const m = findMailbox(ctx);
    assign(m, ctx.body, ["name", "display_name", "signature_html", "auto_reply_enabled", "auto_reply_subject", "auto_reply_html", "status", "team_id"]);
    if (isRecord(ctx.body.config)) m.config = { ...m.config, ...(ctx.body.config as MailboxConfig) };
    if (ctx.body.password || ctx.body.smtp_password) {
      m.status = "active";
      m.last_error = "";
    }
    publish(ctx.ws, "mailbox.updated", { mailbox: m });
    return m;
  });
  del("/v1/mailboxes/:id", (ctx) => {
    const m = findMailbox(ctx);
    ctx.ws.mailboxes = ctx.ws.mailboxes.filter((x) => x !== m);
    publish(ctx.ws, "mailbox.deleted", { mailbox_id: m.id });
    return respond(204);
  });
  post("/v1/mailboxes/:id/test", (ctx) => {
    const m = findMailbox(ctx);
    if (m.status === "error") return respond(200, { inbound: { ok: false, error: m.last_error || "Connection refused" }, outbound: { ok: m.outbound_kind !== "smtp", error: m.outbound_kind === "smtp" ? "SMTP authentication failed (535 5.7.8)" : "" } });
    m.last_synced_at = nowIso();
    publish(ctx.ws, "mailbox.updated", { mailbox: m });
    return respond(200, { inbound: { ok: true, error: "" }, outbound: { ok: true, error: "" } });
  });
  post("/v1/mailboxes/oauth/:provider/start", (ctx) => {
    const provider = ctx.params.provider;
    if (provider !== "google" && provider !== "microsoft") throw notFound("Provider");
    const existingId = s(ctx, "mailbox_id");
    let m = existingId ? ctx.ws.mailboxes.find((x) => x.id === existingId) : undefined;
    const email = s(ctx, "email")?.toLowerCase() || `support@${provider === "google" ? "fieldnote.app" : "fieldnote.onmicrosoft.com"}`;
    if (!m) {
      m = mailbox(ctx.ws, { name: s(ctx, "name") || "Support", email, display_name: "", inbound_kind: provider, outbound_kind: provider, config: { oauth_email: email }, team_id: null });
      publish(ctx.ws, "mailbox.created", { mailbox: m });
    } else {
      m.status = "active";
      m.last_error = "";
      m.inbound_kind = provider;
      m.outbound_kind = provider;
      publish(ctx.ws, "mailbox.updated", { mailbox: m });
    }
    return respond(200, { url: `/settings/mailboxes?connected=${m.id}` });
  });

  // Public help center.
  get("/v1/public/help/:slug", (ctx) => {
    const ws = publicWs(ctx);
    const published = ws.articles.filter((a) => a.status === "published");
    return {
      title: ws.workspace.settings.help_center_title || `${ws.workspace.name} Help`,
      collections: ws.collections
        .map((c) => ({ ...c, article_count: published.filter((a) => a.collection_id === c.id).length }))
        .filter((c) => c.article_count > 0)
        .sort((a, b) => a.position - b.position),
      featured: published.slice().sort((a, b) => b.views - a.views).slice(0, 6),
      locale: ws.workspace.settings.locale,
    };
  });
  get("/v1/public/help/:slug/collections/:cslug", (ctx) => {
    const ws = publicWs(ctx);
    const col = ws.collections.find((c) => c.slug === ctx.params.cslug);
    if (!col) throw notFound("Collection");
    const articles = ws.articles.filter((a) => a.collection_id === col.id && a.status === "published");
    return { collection: { ...col, article_count: articles.length }, articles };
  });
  get("/v1/public/help/:slug/articles/:aslug", (ctx) => {
    const ws = publicWs(ctx);
    const a = ws.articles.find((x) => x.slug === ctx.params.aslug && x.status === "published");
    if (!a) throw notFound("Article");
    a.views++;
    return a;
  });
  get("/v1/public/help/:slug/search", (ctx) => {
    const ws = publicWs(ctx);
    const q = (ctx.query.get("q") ?? "").toLowerCase().trim();
    if (!q) return [];
    return ws.articles.filter((a) => a.status === "published" && (a.title + " " + a.excerpt + " " + a.body_html).toLowerCase().includes(q)).slice(0, 20);
  });

  // Public CSAT.
  const findCsat = (token: string) => {
    for (const ws of db.workspaces) {
      const c = ws.csat[token];
      if (c) return { ws, c, t: ws.tickets.find((x) => x.id === c.ticket_id)! };
    }
    throw notFound("Survey");
  };
  get("/v1/public/csat/:token", (ctx) => {
    const { ws, c, t } = findCsat(ctx.params.token);
    return { score: c.score, comment: c.comment ?? "", workspace_name: ws.workspace.name, brand_color: ws.workspace.settings.brand_color ?? "", ticket: { number: t.number, subject: t.subject }, locale: ws.workspace.settings.locale ?? "" };
  });
  post("/v1/public/csat/:token", (ctx) => {
    const { ws, c, t } = findCsat(ctx.params.token);
    const score = ctx.body.score;
    if (typeof score !== "number" || score < 1 || score > 5) throw invalid("score must be between 1 and 5");
    c.score = score;
    c.comment = (s(ctx, "comment") ?? "").slice(0, 2000);
    t.csat = { score, comment: c.comment };
    addActivity(ws, t, "csat_received", { score, comment: c.comment }, null);
    publishTicketUpdated(ws, t, ["csat"]);
    return respond(204);
  });
}

function positive(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw invalid(`${name} must be a positive number of minutes`);
  return Math.round(v);
}

function conditions(v: unknown): Condition[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isRecord).map((c) => {
    if (typeof c.field !== "string" || typeof c.op !== "string" || typeof c.value !== "string") throw invalid("Each condition needs a field, operator and value");
    return { field: c.field, op: c.op, value: c.value } as Condition;
  });
}

function actions(v: unknown, requireOne: boolean): Action[] {
  const list = Array.isArray(v) ? v.filter(isRecord) : [];
  if (requireOne && !list.length) throw invalid("Add at least one action");
  return list.map((a) => {
    if (typeof a.type !== "string" || typeof a.value !== "string") throw invalid("Each action needs a type and value");
    return { type: a.type, value: a.value } as Action;
  });
}

function uniqueSlug(rows: { slug: string }[], base: string): string {
  const b = base || "untitled";
  let slug = b;
  for (let i = 2; rows.some((r) => r.slug === slug); i++) slug = `${b}-${i}`;
  return slug;
}

function recountCollections(ws: WsData) {
  for (const c of ws.collections) c.article_count = ws.articles.filter((a) => a.collection_id === c.id).length;
}

function mailbox(ws: WsData, init: Pick<Mailbox, "name" | "email" | "display_name" | "inbound_kind" | "outbound_kind" | "config" | "team_id">): Mailbox {
  const m: Mailbox = {
    ...init,
    id: uuid(),
    name: init.name.slice(0, 60),
    forwarding_address: `${ws.workspace.slug}-${slugify(init.name) || "inbox"}-${randomToken(4).toLowerCase().replace(/[-_]/g, "x")}@in.opendesk.sh`,
    signature_html: "",
    auto_reply_enabled: false,
    auto_reply_subject: "",
    auto_reply_html: "",
    status: "active",
    last_error: "",
    last_synced_at: init.inbound_kind === "forwarding" ? null : nowIso(),
    created_at: nowIso(),
  };
  ws.mailboxes.push(m);
  return m;
}

function publicWs(ctx: Ctx): WsData {
  const ws = db.workspaces.find((w) => w.workspace.slug === ctx.params.slug);
  if (!ws || !ws.workspace.settings.help_center_enabled) throw notFound("Help center");
  return ws;
}

function findContact(ctx: Ctx): Contact {
  const c = ctx.ws.contacts.find((x) => x.id === ctx.params.id);
  if (!c) throw notFound("Contact");
  return c;
}
function findCompany(ctx: Ctx): Company {
  const c = ctx.ws.companies.find((x) => x.id === ctx.params.id);
  if (!c) throw notFound("Company");
  return c;
}
function findArticle(ctx: Ctx): KbArticle {
  const a = ctx.ws.articles.find((x) => x.id === ctx.params.id);
  if (!a) throw notFound("Article");
  return a;
}
function findMailbox(ctx: Ctx): Mailbox {
  const m = ctx.ws.mailboxes.find((x) => x.id === ctx.params.id);
  if (!m) throw notFound("Mailbox");
  return m;
}
