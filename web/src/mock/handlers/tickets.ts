// Tickets, messages, activities, attachments, search and reports.

import type { Attachment, Channel, Priority, ReportsOverview, Severity, SuggestionField, Ticket, TicketPatch, TicketStatus } from "@/lib/api/types";
import { contactRef, db, me, userRef, type WsData } from "../db";
import { publish } from "../gateway";
import { HttpError, del, get, invalid, notFound, paginate, patch, post, required, respond, s, strArr, type Ctx } from "../router";
import { canCreateLabels, checkRequiredOnSolve, mergeFields } from "../labels";
import { addActivity, addMessage, applyPatch, counts, fieldFiltersFromQuery, findTicket, matches, newTicket, notify, publishTicketUpdated, sortTickets, type ListFilters } from "../tickets";
import { DAY, isRecord, nowIso, uuid } from "../util";

const STATUSES: TicketStatus[] = ["open", "pending", "on_hold", "solved", "closed"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];
const SEVERITIES: Severity[] = ["sev1", "sev2", "sev3", "sev4"];
const SUGGESTION_FIELDS: SuggestionField[] = ["priority", "severity", "labels", "team", "spam"];

function csv<T extends string>(v: string | null, allowed: T[]): T[] | undefined {
  if (!v) return undefined;
  const out = v.split(",").map((x) => x.trim()).filter((x): x is T => (allowed as string[]).includes(x));
  return out.length ? out : undefined;
}

function filtersFrom(ctx: Ctx): ListFilters {
  const q = ctx.query;
  return {
    status: csv(q.get("status"), STATUSES),
    priority: csv(q.get("priority"), PRIORITIES),
    severity: csv(q.get("severity"), [...SEVERITIES, "none" as const]),
    assignee: q.get("assignee") ?? undefined,
    team_id: q.get("team_id") ?? undefined,
    mailbox_id: q.get("mailbox_id") ?? undefined,
    tag: q.get("tag") ?? undefined,
    channel: (q.get("channel") as Channel | null) ?? undefined,
    contact_id: q.get("contact_id") ?? undefined,
    view_id: q.get("view_id") ?? undefined,
    q: q.get("q") ?? undefined,
    spam: q.get("spam") === "true",
    fieldFilters: fieldFiltersFromQuery(ctx.ws, "ticket", q),
  };
}

/** How a person's write treats labels and required fields. */
function personOpts(ws: WsData) {
  return { requireFields: true, createLabels: canCreateLabels(ws) };
}

function ticket(ctx: Ctx): Ticket {
  const t = findTicket(ctx.ws, ctx.params.id);
  if (!t) throw notFound("Ticket");
  return t;
}

function readPatch(body: Record<string, unknown>): TicketPatch {
  const p: TicketPatch = {};
  if (typeof body.subject === "string") {
    if (!body.subject.trim()) throw invalid("Subject can't be empty");
    p.subject = body.subject.trim().slice(0, 250);
  }
  if (typeof body.status === "string") {
    if (!STATUSES.includes(body.status as TicketStatus)) throw invalid("Unknown status");
    p.status = body.status as TicketStatus;
  }
  if (typeof body.priority === "string") {
    if (!PRIORITIES.includes(body.priority as Priority)) throw invalid("Unknown priority");
    p.priority = body.priority as Priority;
  }
  if ("severity" in body) {
    const v = body.severity;
    if (v !== null && !SEVERITIES.includes(v as Severity)) throw invalid("severity must be one of sev1, sev2, sev3, sev4, or null");
    p.severity = (v as Severity | null) ?? null;
  }
  if ("assignee_id" in body) {
    const v = body.assignee_id;
    if (v !== null && typeof v !== "string") throw invalid("assignee_id must be a user id or null");
    if (v && !db.users.some((u) => u.id === v)) throw invalid("Unknown assignee");
    p.assignee_id = v;
  }
  if ("team_id" in body) p.team_id = typeof body.team_id === "string" ? body.team_id : null;
  if ("snoozed_until" in body) p.snoozed_until = typeof body.snoozed_until === "string" ? body.snoozed_until : null;
  if (typeof body.spam === "boolean") p.spam = body.spam;
  const tags = strArr(body.tags);
  if (tags) p.tags = tags;
  const add = strArr(body.add_tags);
  if (add) p.add_tags = add;
  const remove = strArr(body.remove_tags);
  if (remove) p.remove_tags = remove;
  if (isRecord(body.custom)) p.custom = body.custom;
  if (isRecord(body.fields)) p.fields = body.fields as TicketPatch["fields"];
  return p;
}

function attachmentsFor(ids: string[] | undefined): Attachment[] {
  return (ids ?? []).map((id) => db.attachments.find((a) => a.id === id)).filter((a): a is Attachment => !!a);
}

/** Outbound email: pending, then sent (or failed for addresses containing "bounce"). */
function simulateDelivery(ws: WsData, t: Ticket, msgId: string) {
  setTimeout(() => {
    const m = ws.messages.find((x) => x.id === msgId);
    if (!m || m.delivery_status !== "pending") return;
    const fail = (t.contact?.email ?? "").includes("bounce");
    m.delivery_status = fail ? "failed" : "sent";
    m.delivery_error = fail ? "550 5.1.1 Recipient address rejected" : "";
    publish(ws, "message.updated", { ticket_id: t.id, message: m });
  }, 1500);
}

export function registerTickets() {
  get("/v1/tickets", (ctx) => {
    const f = filtersFrom(ctx);
    const list = ctx.ws.tickets.filter((t) => matches(ctx.ws, t, f, db.meId));
    return paginate(ctx, sortTickets(list, ctx.query.get("sort") ?? "last_message_at", ctx.query.get("order"), ctx.ws));
  });
  get("/v1/tickets/counts", (ctx) => counts(ctx.ws, db.meId));

  post("/v1/tickets", (ctx) => {
    const subject = required(ctx, "subject").slice(0, 250);
    const ws = ctx.ws;
    let contact = s(ctx, "contact_id") ? ws.contacts.find((c) => c.id === s(ctx, "contact_id")) : undefined;
    if (s(ctx, "contact_id") && !contact) throw invalid("Unknown contact");
    if (!contact && isRecord(ctx.body.contact)) {
      const email = typeof ctx.body.contact.email === "string" ? ctx.body.contact.email.trim().toLowerCase() : "";
      const name = typeof ctx.body.contact.name === "string" ? ctx.body.contact.name.trim() : "";
      if (!email) throw invalid("Contact email is required");
      contact = ws.contacts.find((c) => c.email === email);
      if (!contact) {
        contact = { id: uuid(), email, name: name || email.split("@")[0], phone: "", avatar_url: null, avatar_source: null, company: null, external_id: null, notes: "", custom: {}, tags: [], fields: {}, blocked: false, ticket_count: 0, created_at: nowIso(), updated_at: nowIso() };
        ws.contacts.unshift(contact);
        publish(ws, "contact.created", { contact });
      }
    }
    const p = readPatch(ctx.body);
    const fields = p.fields ? mergeFields(ws, "ticket", {}, p.fields).next : {};
    if (p.status === "solved" || p.status === "closed") checkRequiredOnSolve(ws, fields);
    const t = newTicket(ws, {
      subject,
      contact: contact ? contactRef(contact) : null,
      channel: (s(ctx, "channel") as Channel | undefined) ?? "email",
      priority: p.priority,
      severity: p.severity ?? null,
      mailbox_id: s(ctx, "mailbox_id") ?? ws.mailboxes[0]?.id ?? null,
      assignee: userRef(s(ctx, "assignee_id")),
      team_id: s(ctx, "team_id") ?? null,
      fields,
    });
    if (p.tags || p.add_tags) applyPatch(ws, t, { tags: p.tags, add_tags: p.add_tags }, userRef(db.meId), false, personOpts(ws));
    if (contact) contact.ticket_count++;
    publish(ws, "ticket.created", { ticket: t });
    const body = s(ctx, "body_html");
    if (body) {
      const kind = s(ctx, "kind") === "note" ? "note" : "reply";
      const msg = addMessage(ws, t, { kind, direction: "outbound", html: body, user: userRef(db.meId), delivery: "pending" }, { status: p.status, actor: userRef(db.meId) });
      if (msg.delivery_status === "pending") simulateDelivery(ws, t, msg.id);
    } else if (p.status && p.status !== t.status) {
      applyPatch(ws, t, { status: p.status }, userRef(db.meId));
    }
    return respond(201, t);
  });

  get("/v1/tickets/:id", (ctx) => ticket(ctx));
  patch("/v1/tickets/:id", (ctx) => {
    const t = ticket(ctx);
    applyPatch(ctx.ws, t, readPatch(ctx.body), userRef(db.meId), true, personOpts(ctx.ws));
    return t;
  });
  del("/v1/tickets/:id/ai/suggestions/:field", (ctx) => {
    const t = ticket(ctx);
    const field = ctx.params.field as SuggestionField;
    if (!SUGGESTION_FIELDS.includes(field)) throw notFound("Suggestion");
    const sugg = t.custom.ai_suggestions as Record<string, unknown> | undefined;
    if (sugg && field in sugg) {
      t.custom = { ...t.custom, ai_suggestions: Object.fromEntries(Object.entries(sugg).filter(([k]) => k !== field)) };
      publishTicketUpdated(ctx.ws, t, ["custom"]);
    }
    return respond(204);
  });
  del("/v1/tickets/:id", (ctx) => {
    const t = ticket(ctx);
    ctx.ws.deletedTickets.add(t.id);
    publish(ctx.ws, "ticket.deleted", { ticket_id: t.id });
    return respond(204);
  });
  post("/v1/tickets/bulk", (ctx) => {
    const ids = strArr(ctx.body.ids) ?? [];
    if (!ids.length) throw invalid("ids is required");
    if (ids.length > 100) throw invalid("At most 100 tickets at a time");
    const doDelete = ctx.body.delete === true;
    const p = isRecord(ctx.body.patch) ? readPatch(ctx.body.patch) : null;
    if (!doDelete && !p) throw invalid("patch or delete is required");
    for (const id of ids) {
      const t = findTicket(ctx.ws, id);
      if (!t) continue;
      if (doDelete) {
        ctx.ws.deletedTickets.add(t.id);
        publish(ctx.ws, "ticket.deleted", { ticket_id: t.id });
      } else if (p) {
        applyPatch(ctx.ws, t, p, userRef(db.meId), true, personOpts(ctx.ws));
      }
    }
    return respond(204);
  });
  post("/v1/tickets/:id/merge", (ctx) => {
    const src = ticket(ctx);
    const into = findTicket(ctx.ws, required(ctx, "into_id"));
    if (!into) throw notFound("Target ticket");
    if (into.id === src.id) throw invalid("A ticket can't be merged into itself");
    for (const m of ctx.ws.messages.filter((x) => x.ticket_id === src.id)) {
      ctx.ws.messages.push({ ...m, id: uuid(), ticket_id: into.id });
      into.message_count++;
    }
    if (Date.parse(src.last_message_at) > Date.parse(into.last_message_at)) {
      into.last_message_at = src.last_message_at;
      into.last_message_preview = src.last_message_preview;
    }
    addActivity(ctx.ws, src, "merged", { into: { id: into.id, number: into.number, subject: into.subject } }, userRef(db.meId));
    addActivity(ctx.ws, into, "merged", { from: { id: src.id, number: src.number, subject: src.subject } }, userRef(db.meId));
    applyPatch(ctx.ws, src, { status: "closed" }, userRef(db.meId));
    publishTicketUpdated(ctx.ws, into, ["message_count"]);
    return into;
  });

  get("/v1/tickets/:id/messages", (ctx) => {
    const t = ticket(ctx);
    const list = ctx.ws.messages.filter((m) => m.ticket_id === t.id).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return { data: list, next_cursor: null };
  });
  post("/v1/tickets/:id/messages", (ctx) => {
    const t = ticket(ctx);
    const kind = s(ctx, "kind") === "note" ? "note" : "reply";
    const html = required(ctx, "body_html");
    const status = s(ctx, "status") as TicketStatus | undefined;
    if (status && !STATUSES.includes(status)) throw invalid("Unknown status");
    if ((status === "solved" || status === "closed") && t.status !== "solved" && t.status !== "closed") checkRequiredOnSolve(ctx.ws, t.fields);
    const myRef = userRef(db.meId);
    const msg = addMessage(
      ctx.ws,
      t,
      { kind, direction: "outbound", html, user: myRef, cc: strArr(ctx.body.cc), bcc: strArr(ctx.body.bcc), attachments: attachmentsFor(strArr(ctx.body.attachment_ids)), delivery: "pending" },
      { status, actor: myRef },
    );
    if (msg.delivery_status === "pending") simulateDelivery(ctx.ws, t, msg.id);
    return respond(201, msg);
  });
  get("/v1/tickets/:id/activities", (ctx) => {
    const t = ticket(ctx);
    const list = ctx.ws.activities.filter((a) => a.ticket_id === t.id).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return { data: list, next_cursor: null };
  });
  get("/v1/messages/:id/original", (ctx) => {
    const m = ctx.ws.messages.find((x) => x.id === ctx.params.id);
    if (!m) throw notFound("Message");
    return { full_html: ctx.ws.originals[m.id] ?? m.body_html };
  });

  post("/v1/attachments", (ctx) => {
    const file = ctx.form?.get("file");
    if (!(file instanceof File)) throw invalid("file is required");
    if (file.size > 25 * 1024 * 1024) throw new HttpError(413, "too_large", "Files can be up to 25 MB");
    const a: Attachment = { id: uuid(), filename: file.name, content_type: file.type || "application/octet-stream", size_bytes: file.size, inline: false, url: URL.createObjectURL(file) };
    db.attachments.push(a);
    return respond(201, a);
  });
  get("/v1/attachments/:id", (ctx) => {
    const a = db.attachments.find((x) => x.id === ctx.params.id);
    if (!a) throw notFound("Attachment");
    return respond(302, undefined, { location: a.url });
  });

  get("/v1/search", (ctx) => {
    const q = (ctx.query.get("q") ?? "").trim().toLowerCase();
    if (!q) return { tickets: [], contacts: [], articles: [] };
    const ws = ctx.ws;
    const tickets = sortTickets(ws.tickets.filter((t) => matches(ws, t, { q }, db.meId)), "last_message_at", "desc").slice(0, 5);
    const contacts = ws.contacts.filter((c) => [c.name, c.email ?? "", c.company?.name ?? ""].join(" ").toLowerCase().includes(q)).slice(0, 5);
    const articles = ws.articles.filter((a) => (a.title + " " + a.excerpt).toLowerCase().includes(q)).slice(0, 5);
    return { tickets, contacts, articles };
  });

  get("/v1/reports/overview", (ctx) => reports(ctx));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function reports(ctx: Ctx): ReportsOverview {
  const toRaw = ctx.query.get("to");
  const fromRaw = ctx.query.get("from");
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 29 * DAY);
  if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime()) || from > to) throw invalid("from must be before to");
  const by_day: ReportsOverview["by_day"] = [];
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (let d = start; d <= end && by_day.length < 400; d += DAY) {
    const date = new Date(d).toISOString().slice(0, 10);
    const dow = new Date(d).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const trend = 1 + ((d - start) / DAY) * 0.004;
    const base = (weekend ? 9 : 34) * trend;
    const created = Math.round(base * (0.75 + hash(date) * 0.5));
    const solved = Math.max(0, Math.round(created * (0.8 + hash(date + "s") * 0.3)));
    by_day.push({ date, created, solved });
  }
  const created = by_day.reduce((a, b) => a + b.created, 0);
  const solved = by_day.reduce((a, b) => a + b.solved, 0);
  const key = `${by_day[0]?.date}-${by_day.length}`;
  const shares = [0.27, 0.22, 0.21, 0.18, 0.12];
  return {
    created,
    solved,
    open_now: counts(ctx.ws, db.meId).open,
    first_response_p50_minutes: Math.round(38 + hash(key) * 30),
    resolution_p50_minutes: Math.round(6 * 60 + hash(key + "r") * 240),
    csat_avg: Math.round((4.3 + hash(key + "c") * 0.5) * 100) / 100,
    csat_count: Math.round(solved * 0.31),
    sla_breached: Math.round(created * (0.03 + hash(key + "b") * 0.03)),
    by_day,
    by_channel: {
      email: Math.round(created * 0.68),
      chat: Math.round(created * 0.22),
      api: Math.round(created * 0.06),
      portal: created - Math.round(created * 0.68) - Math.round(created * 0.22) - Math.round(created * 0.06),
    },
    by_severity: {
      sev1: Math.round(created * 0.02),
      sev2: Math.round(created * 0.07),
      sev3: Math.round(created * 0.16),
      sev4: Math.round(created * 0.21),
      none: created - Math.round(created * 0.02) - Math.round(created * 0.07) - Math.round(created * 0.16) - Math.round(created * 0.21),
    },
    by_agent: shares.map((share, i) => {
      const u = db.users[i];
      return {
        user: { id: u.id, name: u.name, email: u.email, avatar_url: u.avatar_url },
        solved: Math.round(solved * share),
        first_response_p50_minutes: Math.round(22 + hash(key + u.id) * 50),
      };
    }),
  };
}

/** Used by the live simulator. */
export function customerReply(ws: WsData, t: Ticket, html: string) {
  addMessage(ws, t, { kind: "reply", direction: "inbound", html });
  if (t.assignee?.id === db.meId) notify(ws, "customer_replied", t, { contact: { name: t.contact?.name ?? "" } });
}

export function meRef() {
  return userRef(me().id);
}
