// One socket per signed-in tab. Joins workspace:<wid> and user:<uid> for
// events, and ticket:<wid>:<id> for presence and typing on the open ticket
// (and, quietly, the tickets visible in the list).

import type { QueryClient } from "@tanstack/react-query";
import { getWorkspaceId } from "../api/client";
import { api } from "../api/endpoints";
import type { Envelope, Notification, Ticket } from "../api/types";
import { qk } from "../queries";
import { config } from "../config";
import { applyEnvelope } from "./apply";
import { syncDiff, syncState, type PresenceDiff, type PresenceState } from "./presence";
import { SeqSync } from "./seq";
import { clearPresence, noteCustomerTyping, noteTyping, setPresence, useRealtime } from "./store";
import { createSocket, type RtChannel, type RtSocket } from "./transport";

/** Query roots that realtime events keep current (see apply.ts). */
const LIVE_ROOTS = new Set(["tickets", "contacts", "companies", "notifications", "members", "kb"]);

export type ManagerOptions = {
  qc: QueryClient;
  workspaceId: string;
  userId: string;
  onNotification?: (n: Notification) => void;
  onSelfMembershipChanged?: () => void;
};

type TicketMode = "active" | "watch";
type TicketEntry = { ch: RtChannel; mode: TicketMode; state: PresenceState };

const MAX_WATCHED = 30;
const TOKEN_REFRESH_MS = 4 * 60_000;

export class RealtimeManager {
  private socket: RtSocket | null = null;
  private token = "";
  private tokenTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private sync: SeqSync;
  private tickets = new Map<string, TicketEntry>();
  private active: string | null = null;
  private watched = new Set<string>();
  private lastTyping = 0;
  private everOpened = false;

  constructor(private opts: ManagerOptions) {
    this.sync = new SeqSync({
      fetchSince: (since) => api.events(since),
      apply: (env) => this.apply(env),
      resync: () => void opts.qc.invalidateQueries(),
    });
  }

  private apply(env: Envelope, viaUser = false) {
    applyEnvelope(this.opts.qc, env, {
      me: this.opts.userId,
      viaUser,
      onNotification: this.opts.onNotification,
      onSelfMembershipChanged: this.opts.onSelfMembershipChanged,
    });
  }

  private async fetchToken(): Promise<{ token: string; url: string }> {
    // The token is for this manager's workspace; once the session has moved on
    // (switched, left or deleted it, logged out) there is nothing to ask for.
    if (this.stopped || getWorkspaceId() !== this.opts.workspaceId) throw new Error("realtime: workspace changed");
    const r = await api.realtimeToken();
    this.token = r.token;
    return r;
  }

  async start() {
    useRealtime.setState({ status: "connecting" });
    let url = config.gatewayUrl;
    try {
      const r = await this.fetchToken();
      if (r.url && !window.__OPENDESK__?.gatewayUrl && !import.meta.env.VITE_GATEWAY_URL) url = r.url;
    } catch {
      if (this.stopped) return;
      useRealtime.setState({ status: "offline" });
      setTimeout(() => !this.stopped && void this.start(), 5000);
      return;
    }
    if (this.stopped) return;

    const socket = createSocket(url, () => ({ token: this.token }));
    this.socket = socket;
    socket.onOpen(() => {
      useRealtime.setState({ status: "live" });
      this.everOpened = true;
    });
    const dropped = () => {
      if (this.stopped) return;
      useRealtime.setState({ status: this.everOpened ? "reconnecting" : "connecting" });
      // Tokens only need to be valid at connect; fetch a fresh one for the retry.
      this.fetchToken().catch(() => useRealtime.setState({ status: "offline" }));
    };
    socket.onClose(dropped);
    socket.onError(dropped);
    socket.connect();
    this.tokenTimer = setInterval(() => void this.fetchToken().catch(() => {}), TOKEN_REFRESH_MS);

    const { workspaceId: wid, userId: uid } = this.opts;
    const ws = socket.channel(`workspace:${wid}`);
    ws.on("event", (p) => this.sync.receive(p as Envelope));
    let joinedOnce = false;
    ws.join().receive("ok", () => {
      if (!joinedOnce) {
        joinedOnce = true;
        const joinedAt = Date.now();
        if (this.sync.last === null) {
          api
            .events(0, 1)
            .then((page) => {
              if (this.sync.last !== null) return;
              this.sync.baseline(page.latest_seq);
              // Lists loaded before the join can miss events published in between,
              // which the channel never delivers: refetch those once.
              void this.opts.qc.invalidateQueries({
                predicate: (q) => LIVE_ROOTS.has(String(q.queryKey[0])) && q.state.dataUpdatedAt > 0 && q.state.dataUpdatedAt < joinedAt,
              });
            })
            .catch(() => {});
        }
      } else {
        // A rejoin after a dropped connection: pick up what we missed.
        void this.sync.catchUp();
      }
    });

    const user = socket.channel(`user:${uid}`);
    user.on("event", (p) => {
      const env = p as Envelope;
      if (env.workspace_id !== wid) return;
      // Notifications are applied from here only (the workspace copy carries no topics).
      if (env.type === "notification.created") return this.apply(env, true);
      if (this.sync.hasSeen(env.id)) return;
      this.sync.markSeen(env.id);
      this.apply(env);
    });
    user.join();

    this.reconcileTickets();
  }

  stop() {
    this.stopped = true;
    if (this.tokenTimer) clearInterval(this.tokenTimer);
    for (const [tid, e] of this.tickets) {
      e.ch.leave();
      clearPresence(tid);
    }
    this.tickets.clear();
    this.socket?.disconnect();
    this.socket = null;
    useRealtime.setState({ status: "idle" });
  }

  setActiveTicket(id: string | null) {
    this.active = id;
    this.reconcileTickets();
  }

  setWatched(ids: string[]) {
    this.watched = new Set(ids.slice(0, MAX_WATCHED));
    this.reconcileTickets();
  }

  /** viewing | replying | idle for the open ticket. */
  setPresenceState(state: "viewing" | "replying" | "idle") {
    if (!this.active) return;
    const e = this.tickets.get(this.active);
    if (e?.mode === "active") e.ch.push("presence", { state });
  }

  typing(contactId?: string | null) {
    if (!this.active) return;
    const now = Date.now();
    if (now - this.lastTyping < 2500) return;
    this.lastTyping = now;
    const e = this.tickets.get(this.active);
    if (e?.mode === "active") e.ch.push("typing", contactId ? { contact_id: contactId } : {});
  }

  private reconcileTickets() {
    if (!this.socket) return;
    const desired = new Map<string, TicketMode>();
    for (const id of this.watched) desired.set(id, "watch");
    if (this.active) desired.set(this.active, "active");

    for (const [id, e] of this.tickets) {
      if (desired.get(id) !== e.mode) {
        e.ch.leave();
        this.tickets.delete(id);
        clearPresence(id);
      }
    }
    for (const [id, mode] of desired) {
      if (!this.tickets.has(id)) this.joinTicket(id, mode);
    }
  }

  private joinTicket(id: string, mode: TicketMode) {
    if (!this.socket) return;
    const topic = `ticket:${this.opts.workspaceId}:${id}`;
    const ch = this.socket.channel(topic, mode === "watch" ? { watch: true } : { state: "viewing" });
    const entry: TicketEntry = { ch, mode, state: {} };
    this.tickets.set(id, entry);
    ch.on("presence_state", (p) => {
      entry.state = syncState(entry.state, p as PresenceState);
      setPresence(id, entry.state);
    });
    ch.on("presence_diff", (p) => {
      entry.state = syncDiff(entry.state, p as PresenceDiff);
      setPresence(id, entry.state);
    });
    if (mode === "active") {
      ch.on("typing", (p) => {
        const t = p as { user_id: string; name: string };
        if (t.user_id !== this.opts.userId) noteTyping(id, t);
      });
      // contact_id comes from the visitor's token, so only the ticket's own contact counts.
      ch.on("customer_typing", (p) => {
        const contactId = (p as { contact_id?: string }).contact_id;
        const ticket = this.opts.qc.getQueryData<Ticket>(qk.ticket(id));
        if (contactId && ticket?.contact?.id === contactId) noteCustomerTyping(id);
      });
    }
    ch.join().receive("ok", () => {
      if (mode === "active") ch.push("presence", { state: "viewing" });
    });
  }
}

let current: RealtimeManager | null = null;

export function startRealtime(opts: ManagerOptions) {
  current?.stop();
  current = new RealtimeManager(opts);
  void current.start();
  return current;
}

export function stopRealtime() {
  current?.stop();
  current = null;
}

export function realtime(): RealtimeManager | null {
  return current;
}
