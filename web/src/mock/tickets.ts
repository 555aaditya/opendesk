// Ticket rules shared by the seed and the handlers: SLA, filtering, counts,
// adding messages and applying patches (with activities and events).

import type {
  Activity,
  Attachment,
  Channel,
  Message,
  Priority,
  Tag,
  Ticket,
  TicketCounts,
  TicketFilters,
  TicketPatch,
  TicketStatus,
  UserRef,
} from "@/lib/api/types";
import { db, userRef, type WsData } from "./db";
import { publish } from "./gateway";
import { MIN, nowIso, preview, stripHtml, uuid } from "./util";

export const OPENISH: TicketStatus[] = ["open", "pending", "on_hold"];

export function policyFor(ws: WsData, priority: Priority) {
  const enabled = ws.sla.filter((p) => p.enabled).sort((a, b) => a.position - b.position);
  return enabled.find((p) => p.priority === priority) ?? enabled.find((p) => p.priority === null) ?? null;
}

/** Recompute due dates and breach from the ticket's policy. */
export function computeSla(ws: WsData, t: Ticket, keepPolicy = true): Ticket["sla"] {
  const policy = keepPolicy && t.sla ? ws.sla.find((p) => p.id === t.sla!.policy_id) ?? policyFor(ws, t.priority) : policyFor(ws, t.priority);
  if (!policy) return null;
  const created = Date.parse(t.created_at);
  const fr = created + policy.first_response_minutes * MIN;
  const res = created + policy.resolution_minutes * MIN;
  const now = Date.now();
  const open = OPENISH.includes(t.status);
  const frBreached = t.first_responded_at ? Date.parse(t.first_responded_at) > fr : open && now > fr;
  const resBreached = t.solved_at ? Date.parse(t.solved_at) > res : open && now > res;
  return {
    policy_id: policy.id,
    first_response_due_at: new Date(fr).toISOString(),
    resolution_due_at: new Date(res).toISOString(),
    breached: frBreached || resBreached,
  };
}

export type ListFilters = TicketFilters & { contact_id?: string; spam?: boolean; view_id?: string };

export function resolveFilters(ws: WsData, f: ListFilters): ListFilters {
  if (!f.view_id) return f;
  const v = ws.views.find((x) => x.id === f.view_id);
  return v ? { ...v.filters, ...f, view_id: undefined } : f;
}

export function matches(ws: WsData, t: Ticket, raw: ListFilters, meId: string): boolean {
  const f = resolveFilters(ws, raw);
  if (ws.deletedTickets.has(t.id)) return false;
  if ((f.spam ?? false) !== t.spam) return false;
  if (f.status?.length && !f.status.includes(t.status)) return false;
  if (f.priority?.length && !f.priority.includes(t.priority)) return false;
  if (f.assignee === "me" && t.assignee?.id !== meId) return false;
  if (f.assignee === "none" && t.assignee) return false;
  if (f.assignee && f.assignee !== "me" && f.assignee !== "none" && t.assignee?.id !== f.assignee) return false;
  if (f.team_id && t.team_id !== f.team_id) return false;
  if (f.mailbox_id && t.mailbox_id !== f.mailbox_id) return false;
  if (f.channel && t.channel !== f.channel) return false;
  if (f.contact_id && t.contact?.id !== f.contact_id) return false;
  if (f.tag && !t.tags.some((x) => x.name.toLowerCase() === f.tag!.toLowerCase())) return false;
  if (f.q) {
    const q = f.q.toLowerCase().trim().replace(/^#/, "");
    const hay = [t.subject, t.last_message_preview, t.contact?.name ?? "", t.contact?.email ?? "", String(t.number)].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function counts(ws: WsData, meId: string): TicketCounts {
  const live = ws.tickets.filter((t) => !ws.deletedTickets.has(t.id));
  const ns = live.filter((t) => !t.spam);
  const views: Record<string, number> = {};
  for (const v of ws.views) views[v.id] = live.filter((t) => matches(ws, t, { view_id: v.id }, meId)).length;
  return {
    unassigned: ns.filter((t) => OPENISH.includes(t.status) && !t.assignee).length,
    mine: ns.filter((t) => OPENISH.includes(t.status) && t.assignee?.id === meId).length,
    open: ns.filter((t) => t.status === "open").length,
    pending: ns.filter((t) => t.status === "pending").length,
    on_hold: ns.filter((t) => t.status === "on_hold").length,
    solved: ns.filter((t) => t.status === "solved").length,
    spam: live.filter((t) => t.spam).length,
    views,
  };
}

const priorityRank: Record<Priority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

function dueOf(t: Ticket): number {
  const d = t.sla?.first_response_due_at && !t.first_responded_at ? t.sla.first_response_due_at : t.sla?.resolution_due_at;
  return d ? Date.parse(d) : Number.POSITIVE_INFINITY;
}

export function sortTickets(list: Ticket[], sort: string, order: string | null): Ticket[] {
  const dir = (order ?? (sort === "due" ? "asc" : "desc")) === "asc" ? 1 : -1;
  return list.slice().sort((a, b) => {
    let d: number;
    if (sort === "priority") d = priorityRank[a.priority] - priorityRank[b.priority];
    else if (sort === "due") d = dueOf(a) - dueOf(b);
    else if (sort === "created_at") d = Date.parse(a.created_at) - Date.parse(b.created_at);
    else d = Date.parse(a.last_message_at) - Date.parse(b.last_message_at);
    if (d === 0) d = a.number - b.number;
    return d * dir;
  });
}

export function findTicket(ws: WsData, idOrNumber: string): Ticket | undefined {
  const raw = decodeURIComponent(idOrNumber).replace(/^#/, "");
  const t = /^\d+$/.test(raw) ? ws.tickets.find((x) => x.number === Number(raw)) : ws.tickets.find((x) => x.id === raw);
  return t && !ws.deletedTickets.has(t.id) ? t : undefined;
}

export function ensureTags(ws: WsData, names: string[], publishEvents = true): Tag[] {
  const out: Tag[] = [];
  for (const raw of names) {
    const name = raw.trim().toLowerCase().slice(0, 50);
    if (!name) continue;
    let tag = ws.tags.find((x) => x.name.toLowerCase() === name);
    if (!tag) {
      tag = { id: uuid(), name };
      ws.tags.push(tag);
      if (publishEvents) publish(ws, "tag.created", { tag });
    }
    if (!out.some((x) => x.id === tag!.id)) out.push(tag);
  }
  return out;
}

export function addActivity(
  ws: WsData,
  t: Ticket,
  type: string,
  data: Record<string, unknown>,
  actor: UserRef | null,
  at = nowIso(),
  publishEvent = true,
): Activity {
  const a: Activity = { id: uuid(), ticket_id: t.id, actor: { type: actor ? "user" : "system", user: actor }, type, data, created_at: at };
  ws.activities.push(a);
  if (publishEvent) publish(ws, "activity.created", { ticket_id: t.id, activity: a });
  return a;
}

/** Topics for a ticket.updated event: the assignee hears about assignment changes. */
function ticketTopics(t: Ticket, changes: string[]): string[] {
  return changes.includes("assignee_id") && t.assignee ? [`user:${t.assignee.id}`] : [];
}

export function publishTicketUpdated(ws: WsData, t: Ticket, changes: string[]) {
  t.updated_at = nowIso();
  publish(ws, "ticket.updated", { ticket: t, changes }, { topics: ticketTopics(t, changes) });
}

export type PatchResult = { changes: string[] };

export function applyPatch(ws: WsData, t: Ticket, patch: TicketPatch, actor: UserRef | null, publishEvents = true): PatchResult {
  const changes: string[] = [];
  const act = (type: string, data: Record<string, unknown>) => addActivity(ws, t, type, data, actor, nowIso(), publishEvents);

  if (patch.subject !== undefined && patch.subject !== t.subject) {
    t.subject = patch.subject;
    changes.push("subject");
  }
  if (patch.status && patch.status !== t.status) {
    const from = t.status;
    t.status = patch.status;
    if (patch.status === "solved" || patch.status === "closed") t.solved_at = t.solved_at ?? nowIso();
    else t.solved_at = null;
    if (patch.status !== "pending" && patch.status !== "on_hold") t.snoozed_until = null;
    changes.push("status");
    act("status_changed", { from, to: patch.status });
  }
  if (patch.priority && patch.priority !== t.priority) {
    const from = t.priority;
    t.priority = patch.priority;
    changes.push("priority");
    act("priority_changed", { from, to: patch.priority });
  }
  if (patch.assignee_id !== undefined && (patch.assignee_id ?? null) !== (t.assignee?.id ?? null)) {
    const from = t.assignee;
    t.assignee = userRef(patch.assignee_id);
    changes.push("assignee_id");
    act("assigned", { from, to: t.assignee });
    if (t.assignee && actor?.id !== t.assignee.id && t.assignee.id === db.meId) {
      notify(ws, "assigned", t, { actor });
    }
  }
  if (patch.team_id !== undefined && (patch.team_id ?? null) !== t.team_id) {
    const from = t.team_id;
    t.team_id = patch.team_id ?? null;
    changes.push("team_id");
    const name = (id: string | null) => ws.teams.find((x) => x.id === id)?.name ?? null;
    act("team_changed", { from: name(from), to: name(t.team_id) });
  }
  if (patch.snoozed_until !== undefined && patch.snoozed_until !== t.snoozed_until) {
    t.snoozed_until = patch.snoozed_until;
    changes.push("snoozed_until");
    if (t.snoozed_until && t.status === "open") {
      t.status = "pending";
      changes.push("status");
      act("status_changed", { from: "open", to: "pending" });
    }
  }
  if (patch.spam !== undefined && patch.spam !== t.spam) {
    t.spam = patch.spam;
    changes.push("spam");
  }
  if (patch.tags) {
    const next = ensureTags(ws, patch.tags, publishEvents);
    const added = next.filter((x) => !t.tags.some((y) => y.id === x.id));
    const removed = t.tags.filter((x) => !next.some((y) => y.id === x.id));
    if (added.length || removed.length) {
      t.tags = next;
      changes.push("tags");
      for (const a of added) act("tagged", { tag: a.name });
      for (const r of removed) act("untagged", { tag: r.name });
    }
  }
  if (patch.custom) {
    t.custom = { ...t.custom, ...patch.custom };
    changes.push("custom");
  }
  if (changes.some((c) => c === "priority" || c === "status")) t.sla = computeSla(ws, t, false);
  if (changes.length && publishEvents) publishTicketUpdated(ws, t, changes);
  return { changes };
}

export function notify(
  ws: WsData,
  type: "assigned" | "mentioned" | "customer_replied" | "sla_breached",
  t: Ticket,
  data: Record<string, unknown> = {},
) {
  const n = {
    id: uuid(),
    type,
    ticket: { id: t.id, number: t.number, subject: t.subject },
    data,
    read_at: null,
    created_at: nowIso(),
  };
  ws.notifications.unshift(n);
  publish(ws, "notification.created", { notification: n }, { topics: [`user:${db.meId}`] });
}

export type NewMessage = {
  kind: "reply" | "note";
  direction: "inbound" | "outbound";
  html: string;
  user?: UserRef | null;
  attachments?: Attachment[];
  cc?: string[];
  bcc?: string[];
  at?: string;
  has_quoted?: boolean;
  delivery?: Message["delivery_status"];
  delivery_error?: string;
};

export function buildMessage(ws: WsData, t: Ticket, m: NewMessage): Message {
  const contact = t.contact;
  const mailbox = ws.mailboxes.find((x) => x.id === t.mailbox_id);
  const inbound = m.direction === "inbound";
  const at = m.at ?? nowIso();
  const isEmail = t.channel === "email";
  const msg: Message = {
    id: uuid(),
    ticket_id: t.id,
    ai: false,
    kind: m.kind,
    direction: m.direction,
    author: inbound
      ? { type: "contact", user: null, contact }
      : { type: "user", user: m.user ?? null, contact: null },
    body_html: m.html,
    body_text: stripHtml(m.html),
    has_quoted: m.has_quoted ?? false,
    subject: inbound ? t.subject : `Re: ${t.subject}`,
    from_email: inbound ? (contact?.email ?? "") : (mailbox?.email ?? "support@fieldnote.app"),
    from_name: inbound ? (contact?.name ?? "") : `${m.user?.name ?? "Fieldnote"} (Fieldnote)`,
    to: inbound ? [mailbox?.email ?? "support@fieldnote.app"] : contact?.email ? [contact.email] : [],
    cc: m.cc ?? [],
    bcc: m.bcc ?? [],
    attachments: m.attachments ?? [],
    delivery_status: m.kind === "note" || inbound || !isEmail ? "none" : (m.delivery ?? "sent"),
    delivery_error: m.delivery_error ?? "",
    created_at: at,
  };
  if (msg.delivery_status === "failed" && !msg.delivery_error) msg.delivery_error = "550 5.1.1 Recipient address rejected";
  return msg;
}

/** Store a message, update the ticket's derived fields, publish events. */
export function addMessage(ws: WsData, t: Ticket, m: NewMessage, opts: { publish?: boolean; status?: TicketStatus; actor?: UserRef | null } = {}): Message {
  const doPublish = opts.publish ?? true;
  const msg = buildMessage(ws, t, m);
  ws.messages.push(msg);
  if (m.has_quoted) {
    ws.originals[msg.id] =
      `${msg.body_html}<blockquote><p>On ${new Date(Date.parse(msg.created_at) - 3 * 3600_000).toUTCString()}, Fieldnote Support wrote:</p><p>Thanks for the detailed report. Could you check whether anything changed on your side recently?</p><blockquote><p>Earlier messages in this thread…</p></blockquote></blockquote>`;
  }
  const changes: string[] = [];
  if (m.kind === "reply") {
    t.last_message_at = msg.created_at;
    t.last_message_preview = preview(m.html);
    changes.push("last_message_at");
    if (m.direction === "inbound") {
      t.last_customer_message_at = msg.created_at;
      if (t.status !== "open" && !t.spam) {
        const from = t.status;
        t.status = "open";
        t.solved_at = null;
        changes.push("status");
        if (doPublish) addActivity(ws, t, "status_changed", { from, to: "open" }, null);
        else addActivity(ws, t, "status_changed", { from, to: "open" }, null, msg.created_at, false);
      }
    } else if (!t.first_responded_at) {
      t.first_responded_at = msg.created_at;
      changes.push("first_responded_at");
    }
  }
  t.message_count += 1;
  if (opts.status && opts.status !== t.status) {
    const r = applyPatch(ws, t, { status: opts.status }, opts.actor ?? null, doPublish);
    changes.push(...r.changes.filter((c) => !changes.includes(c)));
  }
  t.sla = computeSla(ws, t);
  if (doPublish) {
    const visibility = t.channel === "chat" && m.kind === "reply" ? "public" : "agents";
    const topics = visibility === "public" && t.contact ? [`contact:${ws.workspace.id}:${t.contact.id}`] : [];
    publish(ws, "message.created", { ticket_id: t.id, message: msg }, { visibility, topics });
    publishTicketUpdated(ws, t, changes);
  }
  return msg;
}

export function newTicket(
  ws: WsData,
  init: {
    subject: string;
    contact: Ticket["contact"];
    channel: Channel;
    priority?: Priority;
    status?: TicketStatus;
    mailbox_id?: string | null;
    assignee?: UserRef | null;
    team_id?: string | null;
    tags?: Tag[];
    created_at?: string;
  },
): Ticket {
  const number = Math.max(1000, ...ws.tickets.map((x) => x.number)) + 1;
  const at = init.created_at ?? nowIso();
  const t: Ticket = {
    id: uuid(),
    number,
    subject: init.subject,
    status: init.status ?? "open",
    priority: init.priority ?? "normal",
    channel: init.channel,
    mailbox_id: init.mailbox_id ?? ws.mailboxes[0]?.id ?? null,
    contact: init.contact,
    assignee: init.assignee ?? null,
    team_id: init.team_id ?? null,
    tags: init.tags ?? [],
    sla: null,
    first_responded_at: null,
    solved_at: null,
    snoozed_until: null,
    last_message_at: at,
    last_customer_message_at: null,
    last_message_preview: "",
    message_count: 0,
    spam: false,
    csat: null,
    custom: {},
    created_at: at,
    updated_at: at,
  };
  t.sla = computeSla(ws, t, false);
  ws.tickets.push(t);
  return t;
}
