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
  CustomField,
  Envelope,
  Invitation,
  KbArticle,
  KnowledgeDoc,
  KnowledgeSource,
  McpServer,
  KbCollection,
  Mailbox,
  Message,
  Notification,
  Role,
  SavedReply,
  Session,
  SlaPolicy,
  Tag,
  TagGroup,
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
  AssignmentRule,
  Availability,
  BusinessHours,
  TriageField,
} from "@/lib/api/types";

export type MemberRow = {
  user_id: string;
  role: Role;
  created_at: string;
  availability?: Availability;
  max_open_tickets?: number | null;
  last_seen_at?: string | null;
  onboarding_dismissed?: boolean;
};

/** Triage and assignment state (handlers/pictures.ts). */
export type RoutingState = {
  rules: AssignmentRule[];
  autoAwayMinutes: number;
  hours: Omit<BusinessHours, "timezone">;
  triageFields: TriageField[];
  triageThreshold: number;
  assignAfterTriage: boolean;
  widgetSeen: boolean;
};

/** One metered AI call (contracts/billing.md): counts only, never content. */
export type AiUsageRow = {
  feature: AIFeature;
  user_id: string | null;
  /** Up to 3 decimals. */
  credits: number;
  /** An OpenRouter model id, or "jev" for decisions. */
  model: string;
  input_tokens: number;
  output_tokens: number;
  at: string;
};

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
  tagGroups: TagGroup[];
  customFields: CustomField[];
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
  aiUsage: AiUsageRow[];
  /** The widget agent's MCP connections (handlers/mcp.ts). */
  mcpServers: McpServer[];
  /** Knowledge sources and their documents (handlers/knowledge.ts). */
  knowledge: KnowledgeSource[];
  knowledgeDocs: Record<string, KnowledgeDoc[]>;
  /** Assignment rules, auto-away, business hours and triage options. */
  routing: RoutingState;
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

export function defaultRouting(): RoutingState {
  const day = [{ start: "09:00", end: "17:00" }];
  return {
    rules: [],
    autoAwayMinutes: 0,
    hours: { enabled: false, schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] }, holidays: [] },
    triageFields: ["priority", "severity", "labels"],
    triageThreshold: 0.7,
    assignAfterTriage: false,
    widgetSeen: false,
  };
}

export function contactRef(c: Contact) {
  return { id: c.id, email: c.email, name: c.name, avatar_url: c.avatar_url };
}
