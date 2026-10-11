// The in-memory database behind mock mode.

import type {
  Activity,
  AIFeature,
  AISettings,
  Billing,
  ApiKey,
  AuditLog,
  Automation,
  Company,
  Contact,
  Envelope,
  Invitation,
  KbArticle,
  KbCollection,
  Mailbox,
  Message,
  Notification,
  Role,
  SavedReply,
  Session,
  SlaPolicy,
  Tag,
  Team,
  Ticket,
  User,
  UserRef,
  View,
  Webhook,
  WebhookDelivery,
  WidgetSettings,
  Workspace,
  Attachment,
} from "@/lib/api/types";

export type MemberRow = { user_id: string; role: Role; created_at: string };

export type WsData = {
  workspace: Workspace;
  members: MemberRow[];
  invitations: (Invitation & { token: string })[];
  teams: Team[];
  contacts: Contact[];
  companies: Company[];
  tickets: Ticket[];
  deletedTickets: Set<string>;
  messages: Message[];
  originals: Record<string, string>;
  activities: Activity[];
  tags: Tag[];
  savedReplies: SavedReply[];
  views: View[];
  sla: SlaPolicy[];
  automations: Automation[];
  mailboxes: Mailbox[];
  collections: KbCollection[];
  articles: KbArticle[];
  apiKeys: ApiKey[];
  webhooks: Webhook[];
  deliveries: Record<string, WebhookDelivery[]>;
  audit: AuditLog[];
  notifications: Notification[];
  widget: WidgetSettings;
  events: Envelope[];
  seq: number;
  csat: Record<string, { ticket_id: string; score: number | null; comment: string }>;
  /** Billing state (handlers/billing.ts). */
  billing: Billing;
  /** settings.ai (handlers/ai.ts). */
  ai: AISettings;
  /** AI usage rows, counts only (contracts/ai.md). */
  aiUsage: { feature: AIFeature; user_id: string | null; credits: number; at: string }[];
};

export type Db = {
  users: User[];
  meId: string;
  sessions: Session[];
  workspaces: WsData[];
  attachments: Attachment[];
  totpPending: string | null;
};

export const db: Db = {
  users: [],
  meId: "",
  sessions: [],
  workspaces: [],
  attachments: [],
  totpPending: null,
};

export function me(): User {
  const u = db.users.find((x) => x.id === db.meId);
  if (!u) throw new Error("mock: no current user");
  return u;
}

export function userRef(id: string | null | undefined): UserRef | null {
  if (!id) return null;
  const u = db.users.find((x) => x.id === id);
  return u ? { id: u.id, name: u.name, email: u.email, avatar_url: u.avatar_url } : null;
}

export function wsById(id: string | null | undefined): WsData | undefined {
  return db.workspaces.find((w) => w.workspace.id === id);
}

export function contactRef(c: Contact) {
  return { id: c.id, email: c.email, name: c.name, avatar_url: c.avatar_url };
}
