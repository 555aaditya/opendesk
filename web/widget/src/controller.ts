// Everything the widget does that isn't drawing: the session, conversations,
// sending (optimistic, with retry), and applying live events.

import { WidgetApi, WidgetError, type Fetcher } from "./api";
import { isAiAnswer } from "./ai";
import { t } from "./i18n";
import { Live, type SocketFactory } from "./realtime";
import { load, save } from "./storage";
import { get, set } from "./store";
import type { Attachment, Envelope, Message, SessionIdentity, UiMessage } from "./types";

export type Env = { base: string; key: string; fetcher: Fetcher; socketFactory: SocketFactory };
export type EventName = "message" | "open" | "close";
type Listener = (payload?: unknown) => void;

export const NEW = "__new";
const TYPING_MS = 5000;

let localSeq = 0;

export class Controller {
  readonly api: WidgetApi;
  private live: Live | null = null;
  private identity: SessionIdentity = {};
  private listeners: Record<EventName, Set<Listener>> = { message: new Set(), open: new Set(), close: new Set() };
  private typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private storageKey: string;
  /** Called with screen-reader text when an agent message arrives. */
  announce: (text: string) => void = () => {};

  constructor(private env: Env) {
    this.api = new WidgetApi(env.base, env.key, env.fetcher);
    this.storageKey = `od_widget_${env.key}`;
    this.api.visitorToken = load(this.storageKey);
  }

  on(name: EventName, cb: Listener) {
    this.listeners[name]?.add(cb);
  }

  private emit(name: EventName, payload?: unknown) {
    this.listeners[name].forEach((cb) => {
      try {
        cb(payload);
      } catch {
        /* a host callback must not break the widget */
      }
    });
  }

  async boot() {
    try {
      const config = await this.api.config();
      set({ config });
      await this.startSession();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : t("unavailable") });
    } finally {
      set({ booting: false });
    }
  }

  private async session() {
    try {
      return await this.api.session(this.identity);
    } catch (e) {
      // A stale or revoked visitor token: start over as a new visitor.
      if (e instanceof WidgetError && (e.status === 401 || e.status === 403 || e.status === 404) && this.api.visitorToken) {
        this.api.visitorToken = null;
        save(this.storageKey, null);
        return this.api.session(this.identity);
      }
      throw e;
    }
  }

  async startSession() {
    const s = await this.session();
    save(this.storageKey, s.visitor_token);
    set({ session: s, error: null });
    this.live?.stop();
    this.live = new Live(
      this.env.socketFactory,
      // Already the widget endpoint (…/socket/widget); used exactly as returned.
      s.gateway_url,
      s.ws_token,
      s.contact.id,
      async () => {
        const fresh = await this.session();
        set({ session: fresh });
        return fresh.ws_token;
      },
      {
        onEvent: (e) => this.onEvent(e),
        onTyping: (p) => this.onTyping(p.ticket_id, p.user?.name ?? "Support"),
        onReconnect: () => void this.catchUp(),
      },
    );
    this.live.start();
    await this.loadConversations();
  }

  async identify(identity: SessionIdentity) {
    this.identity = { ...this.identity, ...identity };
    if (get().booting) return; // boot picks it up
    try {
      await this.startSession();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Couldn't identify" });
    }
  }

  /** After a dropped connection, fetch what arrived while we were away. */
  private async catchUp() {
    await this.loadConversations();
    const id = get().active;
    if (id) await this.openConversation(id);
  }

  async loadConversations() {
    try {
      const list = await this.api.conversations();
      list.sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
      set({ conversations: list });
    } catch {
      set((s) => ({ conversations: s.conversations ?? [] }));
    }
  }

  open() {
    if (get().open) return;
    set({ open: true, unread: 0 });
    this.emit("open");
  }
  close() {
    if (!get().open) return;
    set({ open: false });
    this.emit("close");
  }
  toggle() {
    if (get().open) this.close();
    else this.open();
  }

  home() {
    set({ view: "home", active: null });
    void this.loadConversations();
  }

  newConversation() {
    set((s) => ({ view: "thread", active: null, messages: { ...s.messages, [NEW]: s.messages[NEW] ?? [] } }));
  }

  async openConversation(id: string) {
    set({ view: "thread", active: id });
    try {
      const msgs = await this.api.messages(id);
      set((s) => ({ messages: { ...s.messages, [id]: mergeServer(s.messages[id] ?? [], msgs) } }));
    } catch {
      set((s) => ({ messages: { ...s.messages, [id]: s.messages[id] ?? [] } }));
    }
  }

  /** "Talk to a person": hand the conversation from the AI answer bot to the team. */
  async handoff(id: string) {
    if (get().handoff[id] === "pending" || get().handoff[id] === "done") return;
    set((s) => ({ handoff: { ...s.handoff, [id]: "pending" } }));
    try {
      await this.api.handoff(id);
      set((s) => ({
        handoff: { ...s.handoff, [id]: "done" },
        conversations: (s.conversations ?? []).map((c) => (c.id === id ? { ...c, ai_handoff: true } : c)),
      }));
      this.announce(t("handoffDone"));
    } catch {
      set((s) => ({ handoff: { ...s.handoff, [id]: "failed" } }));
    }
  }

  async captureEmail(name: string, email: string) {
    this.identity = { ...this.identity, name: name || undefined, email };
    const s = await this.session();
    save(this.storageKey, s.visitor_token);
    set({ session: s });
  }

  needsEmail(): boolean {
    const { config, session } = get();
    return !!config?.require_email && !!session && !session.contact.email;
  }

  typing() {
    const { active } = get();
    if (active) this.live?.typing(active);
  }

  async send(text: string, files: File[]) {
    const body = text.trim();
    if (!body && !files.length) return;
    const { active, session } = get();
    const key = active ?? NEW;
    const local: UiMessage = {
      id: `local-${++localSeq}`,
      ticket_id: key,
      kind: "reply",
      direction: "inbound",
      author: { type: "contact", user: null, contact: session?.contact ?? null },
      body_html: "",
      body_text: body,
      attachments: files.map((f, i) => ({
        id: `local-file-${localSeq}-${i}`,
        filename: f.name,
        content_type: f.type,
        size_bytes: f.size,
        inline: false,
        url: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
      })),
      created_at: new Date().toISOString(),
      local: "pending",
      localFiles: files,
    };
    set((s) => ({ messages: { ...s.messages, [key]: [...(s.messages[key] ?? []), local] } }));
    await this.deliver(key, local);
  }

  async retry(key: string, localId: string) {
    const m = get().messages[key]?.find((x) => x.id === localId);
    if (!m) return;
    this.patchLocal(key, localId, { local: "pending" });
    await this.deliver(key, m);
  }

  private patchLocal(key: string, id: string, patch: Partial<UiMessage>) {
    set((s) => ({ messages: { ...s.messages, [key]: (s.messages[key] ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)) } }));
  }

  private async deliver(key: string, local: UiMessage) {
    try {
      const uploaded: Attachment[] = [];
      for (const f of local.localFiles ?? []) uploaded.push(await this.api.upload(f));
      const ids = uploaded.map((a) => a.id);
      if (key === NEW) {
        const { conversation, message } = await this.api.start(local.body_text, ids.length ? ids : undefined);
        set((s) => {
          const rest = { ...s.messages };
          delete rest[NEW];
          const thread = message ? [message] : [];
          return {
            active: s.active === null && s.view === "thread" ? conversation.id : s.active,
            messages: { ...rest, [conversation.id]: mergeServer(s.messages[conversation.id] ?? [], thread) },
            conversations: [conversation, ...(s.conversations ?? []).filter((c) => c.id !== conversation.id)],
          };
        });
        if (!message) void this.openConversation(conversation.id);
        else this.live?.typing(conversation.id);
      } else {
        const msg = await this.api.send(key, local.body_text, ids.length ? ids : undefined);
        set((s) => ({
          messages: { ...s.messages, [key]: upsert((s.messages[key] ?? []).filter((m) => m.id !== local.id), msg) },
        }));
        this.touchConversation(key, msg);
      }
    } catch {
      this.patchLocal(key, local.id, { local: "failed" });
    }
  }

  private touchConversation(id: string, m: Message) {
    set((s) => {
      const list = s.conversations ?? [];
      const c = list.find((x) => x.id === id);
      if (!c) return {};
      const next = { ...c, last_message_at: m.created_at, last_message_preview: m.body_text.slice(0, 140) };
      return { conversations: [next, ...list.filter((x) => x.id !== id)] };
    });
  }

  private onTyping(ticketId: string, name: string) {
    set((s) => ({ typing: { ...s.typing, [ticketId]: name } }));
    clearTimeout(this.typingTimers[ticketId]);
    this.typingTimers[ticketId] = setTimeout(() => this.clearTyping(ticketId), TYPING_MS);
  }

  private clearTyping(ticketId: string) {
    clearTimeout(this.typingTimers[ticketId]);
    set((s) => {
      if (!(ticketId in s.typing)) return {};
      const next = { ...s.typing };
      delete next[ticketId];
      return { typing: next };
    });
  }

  onEvent(e: Envelope) {
    if (e.type !== "message.created" && e.type !== "message.updated") return;
    const m = e.data.message as Message | undefined;
    const tid = (e.data.ticket_id as string | undefined) ?? m?.ticket_id;
    if (!m || !tid || m.kind === "note") return;
    const s = get();
    if (s.messages[tid]) set((st) => ({ messages: { ...st.messages, [tid]: mergeServer(st.messages[tid] ?? [], [m]) } }));
    if (s.conversations && !s.conversations.some((c) => c.id === tid)) void this.loadConversations();
    else this.touchConversation(tid, m);
    if (m.direction === "outbound" && e.type === "message.created") {
      this.clearTyping(tid);
      const viewing = s.open && s.view === "thread" && s.active === tid;
      if (!s.open) set((st) => ({ unread: st.unread + 1 }));
      else if (!viewing) void this.loadConversations();
      const who = m.author.user?.name ?? (isAiAnswer(m) ? t("ai") : s.config?.workspace_name ?? t("support"));
      this.announce(t("newMessage", { name: who, text: m.body_text.slice(0, 200) }));
      this.emit("message", { conversation_id: tid, body: m.body_text, from: who });
    }
  }

  shutdown() {
    this.live?.stop();
    this.live = null;
    save(this.storageKey, null);
    this.api.visitorToken = null;
  }
}

function upsert(list: UiMessage[], m: Message): UiMessage[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) return list.map((x, j) => (j === i ? m : x));
  return [...list, m].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** Merge server messages in, dropping a pending local copy the echo replaces. */
function mergeServer(list: UiMessage[], incoming: Message[]): UiMessage[] {
  let out = list;
  for (const m of incoming) {
    if (m.direction === "inbound") {
      const dup = out.find((x) => x.local === "pending" && x.body_text === m.body_text);
      if (dup && !out.some((x) => x.id === m.id)) out = out.filter((x) => x !== dup);
    }
    out = upsert(out, m);
  }
  return out;
}
