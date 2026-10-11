// Shapes from contracts/api.md (Widget section) that the widget uses.

export type ContactRef = { id: string; email: string | null; name: string; avatar_url: string };

export type WidgetConfig = {
  workspace_name: string;
  brand_color: string | null;
  greeting: string;
  help_center_url: string | null;
  require_email: boolean;
  /** Workspace default language (BCP 47) for visitors whose browser language isn't supported. */
  locale?: string | null;
  /** The AI answer bot takes new chat messages (contracts/ai.md); lets the widget show it working. */
  ai_answers?: boolean;
};

export type WidgetSession = {
  visitor_token: string;
  contact: ContactRef;
  ws_token: string;
  gateway_url: string;
};

export type Conversation = {
  id: string;
  subject: string;
  status: string;
  last_message_preview: string;
  last_message_at: string;
  /** True once the visitor asked for a person after an AI answer (contracts/ai.md). */
  ai_handoff?: boolean;
};

export type Attachment = { id: string; filename: string; content_type: string; size_bytes: number; inline: boolean; url: string };

export type Message = {
  id: string;
  ticket_id: string;
  kind: "reply" | "note";
  direction: "inbound" | "outbound";
  author: {
    type: "contact" | "user" | "system" | "api";
    user: { id: string; name: string; avatar_url: string } | null;
    contact: ContactRef | null;
  };
  body_html: string;
  body_text: string;
  attachments: Attachment[];
  created_at: string;
  /** An automatic answer from the answer bot (contracts/ai.md); its sources are links in the body. */
  ai?: boolean;
};


/** A message as the widget shows it: server messages plus local optimistic ones. */
export type UiMessage = Message & { local?: "pending" | "failed"; localFiles?: File[] };

export type Envelope = { id: string; seq: number; type: string; data: Record<string, unknown>; topics?: string[] };

export type SessionIdentity = { user_id?: string; user_hash?: string; email?: string; name?: string };
