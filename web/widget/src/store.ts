import { useEffect, useState } from "preact/hooks";
import type { Conversation, UiMessage, WidgetConfig, WidgetSession } from "./types";

export type View = "home" | "thread";

export type State = {
  open: boolean;
  view: View;
  config: WidgetConfig | null;
  session: WidgetSession | null;
  conversations: Conversation[] | null;
  /** Open conversation id, or null for a new one. */
  active: string | null;
  messages: Record<string, UiMessage[]>;
  /** ticket_id -> agent name, while they are typing. */
  typing: Record<string, string>;
  unread: number;
  error: string | null;
  booting: boolean;
  /** Active language; changing it re-renders every string. */
  lang: string;
  /** conversation id -> "Talk to a person" request state. */
  handoff: Record<string, "pending" | "done" | "failed">;
  /** conversation id -> when the visitor's last message was delivered, until a reply arrives. */
  awaiting: Record<string, number>;
};

let state: State = {
  open: false,
  view: "home",
  config: null,
  session: null,
  conversations: null,
  active: null,
  messages: {},
  typing: {},
  unread: 0,
  error: null,
  booting: true,
  lang: "en",
  handoff: {},
  awaiting: {},
};

const subs = new Set<() => void>();

export function get(): State {
  return state;
}

export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  subs.forEach((f) => f());
}

export function useStore(): State {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return state;
}
