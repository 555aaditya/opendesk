// Applies one event envelope (contracts/events.md) to the TanStack Query cache.
// Payloads carry the full REST object, so most events patch in place; only
// aggregates (counts, reports) are invalidated.

import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type {
  Activity,
  Contact,
  Envelope,
  Member,
  Message,
  Notification,
  Page,
  Ticket,
  TicketLink,
  Workspace,
} from "../api/types";
import { qk, removeFromList, upsertInList } from "../queries";
import { updateWorkspace, useSession } from "../session";
import { patchTicketEverywhere, removeTicketEverywhere } from "../ticketCache";

// Events that can tick off a setup checklist step (contracts/api.md "Onboarding").
const onboardingResources = new Set(["mailbox", "member", "tag", "kb_article", "workspace"]);

export type ApplyContext = {
  me: string;
  /** The envelope came from the user:<me> channel (the gateway pushes envelopes without `topics`). */
  viaUser?: boolean;
  /** The signed-in user was removed from this workspace or changed role. */
  onSelfMembershipChanged?: () => void;
  onNotification?: (n: Notification) => void;
};

// Settings-style resources: event prefix -> [list key, payload field].
const simpleLists: Record<string, { key: readonly unknown[]; field: string }> = {
  tag: { key: qk.tags, field: "tag" },
  tag_group: { key: qk.tagGroups, field: "tag_group" },
  custom_field: { key: qk.customFields, field: "custom_field" },
  mailbox: { key: qk.mailboxes, field: "mailbox" },
  saved_reply: { key: qk.savedReplies, field: "saved_reply" },
  view: { key: qk.views, field: "view" },
  automation: { key: qk.automations, field: "automation" },
  sla_policy: { key: qk.slaPolicies, field: "sla_policy" },
  kb_collection: { key: qk.kbCollections, field: "kb_collection" },
  team: { key: qk.teams, field: "team" },
  webhook: { key: qk.webhooks, field: "webhook" },
  integration: { key: qk.integrations, field: "integration" },
};

let countsTimer: ReturnType<typeof setTimeout> | null = null;
/** Coalesce bursts (bulk edits) into one counts refetch. */
function refreshCounts(qc: QueryClient) {
  if (countsTimer) return;
  countsTimer = setTimeout(() => {
    countsTimer = null;
    void qc.invalidateQueries({ queryKey: qk.counts });
  }, 250);
}

function appendUnique<R extends { id: string }>(qc: QueryClient, key: readonly unknown[], row: R) {
  qc.setQueryData<R[]>(key, (old) => {
    if (!old) return old;
    const i = old.findIndex((x) => x.id === row.id);
    if (i >= 0) {
      const next = old.slice();
      next[i] = row;
      return next;
    }
    return [...old, row];
  });
}

/**
 * Merge by id. Chat replies arrive customer-safe (no author email, no
 * to/cc/bcc), so an existing copy keeps its fields, and a new partial one
 * triggers a refetch of the full list.
 */
function mergeMessage(qc: QueryClient, ticketId: string, m: Message) {
  const key = qk.messages(ticketId);
  const old = qc.getQueryData<Message[]>(key);
  if (!old) return;
  const defined = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== null)) as Partial<Message>;
  const i = old.findIndex((x) => x.id === m.id);
  if (i >= 0) {
    qc.setQueryData<Message[]>(key, old.map((x, j) => (j === i ? { ...x, ...defined, author: { ...x.author, ...(m.author ?? {}) } } : x)));
    return;
  }
  const partial = !Array.isArray(m.to) || !Array.isArray(m.attachments) || !m.author;
  const full = { ...m, to: m.to ?? [], cc: m.cc ?? [], bcc: m.bcc ?? [], attachments: m.attachments ?? [] };
  // Our own send can arrive here before its POST answers: take the optimistic copy's place.
  const temp = old.findIndex((x) => x.id.startsWith("tmp-") && x.kind === m.kind && x.author?.user?.id === m.author?.user?.id && x.delivery_status !== "failed");
  if (temp >= 0 && m.author?.type === "user") {
    qc.setQueryData<Message[]>(key, old.map((x, j) => (j === temp ? full : x)));
    if (partial) void qc.invalidateQueries({ queryKey: key, exact: true });
    return;
  }
  qc.setQueryData<Message[]>(key, [...old, full]);
  if (partial) void qc.invalidateQueries({ queryKey: key, exact: true });
}

type ContactPages = InfiniteData<Page<Contact>, string | null>;

function patchContactLists(qc: QueryClient, c: Contact | null, removeId?: string) {
  for (const [key, data] of qc.getQueriesData<ContactPages>({ queryKey: qk.contactLists })) {
    if (!data) continue;
    const pages = data.pages.map((p) => ({
      ...p,
      data: removeId ? p.data.filter((x) => x.id !== removeId) : p.data.map((x) => (c && x.id === c.id ? c : x)),
    }));
    qc.setQueryData<ContactPages>(key, { ...data, pages });
  }
}

export function applyEnvelope(qc: QueryClient, env: Envelope, ctx: ApplyContext): void {
  const d = env.data as Record<string, unknown>;
  const [resource, verb] = splitType(env.type);
  if (onboardingResources.has(resource) && verb !== "deleted") void qc.invalidateQueries({ queryKey: qk.onboarding });

  switch (env.type) {
    case "ticket.created":
    case "ticket.updated": {
      const t = d.ticket as Ticket;
      if (!t) return;
      patchTicketEverywhere(qc, t, ctx.me);
      refreshCounts(qc);
      return;
    }
    case "ticket.deleted": {
      const id = d.ticket_id as string;
      removeTicketEverywhere(qc, id);
      qc.removeQueries({ queryKey: qk.ticket(id) });
      refreshCounts(qc);
      return;
    }
    case "message.created":
    case "message.updated": {
      const m = d.message as Message;
      const tid = (d.ticket_id as string) ?? m?.ticket_id;
      if (!m || !tid) return;
      mergeMessage(qc, tid, m);
      return;
    }
    case "activity.created": {
      const a = d.activity as Activity;
      const tid = (d.ticket_id as string) ?? a?.ticket_id;
      if (a && tid) appendUnique(qc, qk.activities(tid), a);
      return;
    }
    case "tag.merged": {
      removeFromList(qc, qk.tags, d.tag_id as string);
      if (d.into) upsertInList(qc, qk.tags, d.into as { id: string });
      void qc.invalidateQueries({ queryKey: qk.ticketLists });
      void qc.invalidateQueries({ queryKey: qk.contactLists });
      void qc.invalidateQueries({ queryKey: qk.companyLists });
      return;
    }
    case "billing.updated": {
      if (d && typeof d === "object" && "plan" in d) qc.setQueryData(qk.billing, d);
      else void qc.invalidateQueries({ queryKey: qk.billing });
      return;
    }
    case "notification.created": {
      // The workspace channel carries everyone's notifications; ours arrive on user:<me>.
      if (!ctx.viaUser && !env.topics?.includes(`user:${ctx.me}`)) return;
      const n = d.notification as Notification;
      if (!n) return;
      qc.setQueryData<Notification[]>(qk.notifications, (old) =>
        old ? [n, ...old.filter((x) => x.id !== n.id)] : old,
      );
      ctx.onNotification?.(n);
      return;
    }
  }

  if (resource === "ticket_link") {
    const tid = d.ticket_id as string;
    if (verb === "deleted") removeFromList(qc, qk.ticketLinks(tid), d.link_id as string);
    else if (d.link) appendUnique(qc, qk.ticketLinks(tid), d.link as TicketLink);
    return;
  }

  if (resource === "contact") {
    if (verb === "deleted") {
      const id = d.contact_id as string;
      qc.removeQueries({ queryKey: qk.contact(id) });
      patchContactLists(qc, null, id);
    } else {
      const c = d.contact as Contact;
      qc.setQueryData(qk.contact(c.id), c);
      if (verb === "created") void qc.invalidateQueries({ queryKey: qk.contactLists });
      else patchContactLists(qc, c);
    }
    return;
  }

  if (resource === "company") {
    void qc.invalidateQueries({ queryKey: qk.companyLists });
    if (verb !== "deleted") qc.setQueryData(qk.company((d.company as { id: string }).id), d.company);
    return;
  }

  if (resource === "workspace") {
    const w = d.workspace as Workspace | undefined;
    if (w) {
      qc.setQueryData(qk.workspace, w);
      updateWorkspace(w);
    }
    void qc.invalidateQueries({ queryKey: qk.assignment });
    void qc.invalidateQueries({ queryKey: qk.businessHours });
    return;
  }

  if (resource === "member") {
    if (verb === "removed") {
      const uid = d.user_id as string;
      qc.setQueryData<Member[]>(qk.members, (old) => old?.filter((m) => m.user.id !== uid));
      if (uid === ctx.me) ctx.onSelfMembershipChanged?.();
    } else {
      const m = d.member as Member;
      const before = qc.getQueryData<Member[]>(qk.members)?.find((x) => x.user.id === m.user.id);
      qc.setQueryData<Member[]>(qk.members, (old) => {
        if (!old) return old;
        const i = old.findIndex((x) => x.user.id === m.user.id);
        return i >= 0 ? old.map((x, j) => (j === i ? m : x)) : [...old, m];
      });
      // Assignees embed the member's picture.
      if (before && before.user.avatar_url !== m.user.avatar_url) void qc.invalidateQueries({ queryKey: ["tickets"] });
      if (m.user.id === ctx.me) {
        const roleChanged = verb !== "updated" || !before || before.role !== m.role;
        if (roleChanged) ctx.onSelfMembershipChanged?.();
        else {
          const u = useSession.getState().user;
          if (u && u.avatar_url !== m.user.avatar_url) useSession.setState({ user: { ...u, avatar_url: m.user.avatar_url, avatar_source: m.user.avatar_source } });
        }
      }
    }
    return;
  }

  if (resource === "kb_article") {
    void qc.invalidateQueries({ queryKey: qk.kbArticleLists });
    if (verb === "deleted") qc.removeQueries({ queryKey: qk.kbArticle(d.kb_article_id as string) });
    else {
      const a = d.kb_article as { id: string };
      qc.setQueryData(qk.kbArticle(a.id), a);
    }
    void qc.invalidateQueries({ queryKey: qk.kbCollections });
    return;
  }

  const simple = simpleLists[resource];
  if (simple) {
    if (verb === "deleted") removeFromList(qc, simple.key, d[`${simple.field}_id`] as string);
    else {
      const row = d[simple.field] as { id: string } | undefined;
      if (row) upsertInList(qc, simple.key, row);
    }
    if (resource === "view") refreshCounts(qc);
    // Records embed label names and colours, and field changes can clear stored values.
    if ((resource === "tag" || resource === "tag_group") && verb !== "created") void qc.invalidateQueries({ queryKey: qk.ticketLists });
    if (resource === "tag_group") void qc.invalidateQueries({ queryKey: qk.tags });
    if (resource === "custom_field" && verb !== "created") {
      void qc.invalidateQueries({ queryKey: qk.ticketLists });
      void qc.invalidateQueries({ queryKey: ["tickets", "detail"] });
    }
    return;
  }
}

function splitType(type: string): [string, string] {
  const i = type.lastIndexOf(".");
  return i < 0 ? [type, ""] : [type.slice(0, i), type.slice(i + 1)];
}
