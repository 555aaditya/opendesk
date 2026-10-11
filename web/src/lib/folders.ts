import type { TicketListQuery } from "./api/endpoints";
import type { TicketCounts } from "./api/types";

export type FolderId = "unassigned" | "mine" | "open" | "pending" | "solved" | "spam";

export type Folder = { id: FolderId; label: string; query: TicketListQuery; count: (c: TicketCounts) => number | null };

const active = ["open", "pending", "on_hold"] as TicketListQuery["status"];

export const folders: Folder[] = [
  { id: "unassigned", label: "Unassigned", query: { status: active, assignee: "none" }, count: (c) => c.unassigned },
  { id: "mine", label: "Mine", query: { status: active, assignee: "me" }, count: (c) => c.mine },
  { id: "open", label: "All open", query: { status: ["open"] }, count: (c) => c.open },
  { id: "pending", label: "Pending", query: { status: ["pending", "on_hold"] }, count: (c) => c.pending + c.on_hold },
  { id: "solved", label: "Solved", query: { status: ["solved", "closed"] }, count: () => null },
  { id: "spam", label: "Spam", query: { spam: true }, count: (c) => c.spam },
];

export function folderById(id: string): Folder | undefined {
  return folders.find((f) => f.id === id);
}

export type InboxSearch = {
  sort?: TicketListQuery["sort"];
  order?: TicketListQuery["order"];
  priority?: string;
  channel?: string;
  tag?: string;
  mailbox?: string;
  q?: string;
};

/** The list query for a folder or view plus the user's filters and sort. */
export function listQuery(base: TicketListQuery, s: InboxSearch): TicketListQuery {
  const q: TicketListQuery = { ...base };
  if (s.sort) q.sort = s.sort;
  if (s.order) q.order = s.order;
  if (s.priority) q.priority = s.priority.split(",") as TicketListQuery["priority"];
  if (s.channel) q.channel = s.channel as TicketListQuery["channel"];
  if (s.tag) q.tag = s.tag;
  if (s.mailbox) q.mailbox_id = s.mailbox;
  if (s.q) q.q = s.q;
  return q;
}

export function parseInboxSearch(raw: Record<string, unknown>): InboxSearch {
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const sort = str(raw.sort);
  const order = str(raw.order);
  return {
    sort: sort === "created_at" || sort === "priority" || sort === "due" || sort === "last_message_at" ? sort : undefined,
    order: order === "asc" || order === "desc" ? order : undefined,
    priority: str(raw.priority),
    channel: str(raw.channel),
    tag: str(raw.tag),
    mailbox: str(raw.mailbox),
    q: str(raw.q),
  };
}
