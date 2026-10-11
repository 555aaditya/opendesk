import { create } from "zustand";
import type { PresenceState } from "./presence";

export type ConnectionStatus = "idle" | "connecting" | "live" | "reconnecting" | "offline";

type Typing = { user_id: string; name: string; at: number };

type RealtimeState = {
  status: ConnectionStatus;
  presence: Record<string, PresenceState>;
  typing: Record<string, Typing[]>;
  customerTyping: Record<string, number>;
};

export const useRealtime = create<RealtimeState>(() => ({
  status: "idle",
  presence: {},
  typing: {},
  customerTyping: {},
}));

export function setPresence(ticketId: string, state: PresenceState) {
  useRealtime.setState((s) => ({ presence: { ...s.presence, [ticketId]: state } }));
}

export function clearPresence(ticketId: string) {
  useRealtime.setState((s) => {
    const next = { ...s.presence };
    delete next[ticketId];
    return { presence: next };
  });
}

const TYPING_MS = 5000;

export function noteTyping(ticketId: string, t: { user_id: string; name: string }) {
  useRealtime.setState((s) => {
    const cur = (s.typing[ticketId] ?? []).filter((x) => x.user_id !== t.user_id && Date.now() - x.at < TYPING_MS);
    return { typing: { ...s.typing, [ticketId]: [...cur, { ...t, at: Date.now() }] } };
  });
  setTimeout(() => {
    useRealtime.setState((s) => ({
      typing: { ...s.typing, [ticketId]: (s.typing[ticketId] ?? []).filter((x) => Date.now() - x.at < TYPING_MS) },
    }));
  }, TYPING_MS + 50);
}

export function noteCustomerTyping(ticketId: string) {
  useRealtime.setState((s) => ({ customerTyping: { ...s.customerTyping, [ticketId]: Date.now() } }));
  setTimeout(() => useRealtime.setState((s) => ({ customerTyping: { ...s.customerTyping } })), TYPING_MS + 50);
}

export function isCustomerTyping(at: number | undefined) {
  return !!at && Date.now() - at < TYPING_MS;
}
