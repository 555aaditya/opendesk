// Jev's panel state and runs. One conversation is live at a time; its blocks
// (text and tool steps, in the order they happened) render the transcript, and
// runs stream into the last assistant entry.

import { create } from "zustand";
import { queryClient } from "@/lib/queryClient";
import { errorMessage } from "@/lib/api/client";
import { assistantApi, type Approval, type AssistantStep, type PageContext, type RunEvent, type Transcript } from "./api";
import { pageContext } from "./context";

export type Block = { kind: "text"; text: string } | { kind: "step"; step: AssistantStep };
export type Entry = { id: string; role: "user" | "assistant"; text: string; blocks: Block[]; error?: string };

type Mode = "docked" | "floating";

type State = {
  open: boolean;
  mode: Mode;
  /** Floating panel position, from the viewport's bottom right. */
  offset: { right: number; bottom: number };
  showSessions: boolean;
  sessionId: string | null;
  title: string;
  entries: Entry[];
  loading: boolean;
  running: boolean;
  /** The change waiting for a decision. */
  approval: Approval | null;
  /** Set when a run ended well, for the blob's cheer. */
  lastOk: boolean;
  /** A prompt to send once the panel is ready (askJev). */
  queued: string | null;
};

const PREFS = "od-jev-prefs";

function readPrefs(): Partial<Pick<State, "mode" | "offset" | "sessionId">> {
  try {
    const raw = localStorage.getItem(PREFS);
    return raw ? (JSON.parse(raw) as Partial<State>) : {};
  } catch {
    return {};
  }
}

function writePrefs(s: State) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ mode: s.mode, offset: s.offset, sessionId: s.sessionId }));
  } catch {
    /* storage unavailable */
  }
}

const prefs = readPrefs();

export const useJev = create<State>(() => ({
  open: false,
  mode: prefs.mode === "floating" ? "floating" : "docked",
  offset: prefs.offset ?? { right: 24, bottom: 24 },
  showSessions: false,
  sessionId: prefs.sessionId ?? null,
  title: "",
  entries: [],
  loading: false,
  running: false,
  approval: null,
  lastOk: false,
  queued: null,
}));

useJev.subscribe((s, prev) => {
  if (s.mode !== prev.mode || s.offset !== prev.offset || s.sessionId !== prev.sessionId) writePrefs(s);
});

let seq = 0;
const uid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;
let controller: AbortController | null = null;

export const sessionsKey = ["assistant", "sessions"] as const;

/** Transcript items to entries: consecutive assistant items merge into one. */
export function toEntries(tr: Transcript): Entry[] {
  const out: Entry[] = [];
  for (const it of tr.items) {
    if (it.role === "user") {
      out.push({ id: uid(), role: "user", text: it.text, blocks: [] });
      continue;
    }
    let last = out[out.length - 1];
    if (!last || last.role !== "assistant") {
      last = { id: uid(), role: "assistant", text: "", blocks: [] };
      out.push(last);
    }
    if (it.text) last.blocks.push({ kind: "text", text: it.text });
    for (const st of it.steps) last.blocks.push({ kind: "step", step: st });
  }
  return out;
}

function patchLast(fn: (e: Entry) => Entry) {
  useJev.setState((s) => {
    const entries = s.entries.slice();
    const i = entries.length - 1;
    if (i < 0 || entries[i].role !== "assistant") return s;
    entries[i] = fn(entries[i]);
    return { entries };
  });
}

function apply(e: RunEvent) {
  switch (e.type) {
    case "session":
      useJev.setState({ title: e.session.title });
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
      break;
    case "text":
      patchLast((en) => {
        const blocks = en.blocks.slice();
        const last = blocks[blocks.length - 1];
        if (last && last.kind === "text") blocks[blocks.length - 1] = { kind: "text", text: last.text + e.text };
        else blocks.push({ kind: "text", text: e.text });
        return { ...en, blocks };
      });
      break;
    case "tool":
      patchLast((en) => {
        const blocks = en.blocks.slice();
        const i = blocks.findIndex((b) => b.kind === "step" && b.step.id === e.step.id);
        if (i >= 0) blocks[i] = { kind: "step", step: { ...(blocks[i] as { step: AssistantStep }).step, ...e.step } };
        else blocks.push({ kind: "step", step: e.step });
        return { ...en, blocks };
      });
      break;
    case "approval":
      useJev.setState({ approval: e.approval });
      break;
    case "done":
      useJev.setState({ lastOk: e.status === "complete" });
      break;
  }
}

async function run(go: (signal: AbortSignal) => Promise<void>) {
  controller?.abort();
  const c = new AbortController();
  controller = c;
  useJev.setState({ running: true, lastOk: false });
  try {
    await go(c.signal);
  } catch (err) {
    if ((err as Error)?.name !== "AbortError") patchLast((en) => ({ ...en, error: errorMessage(err, "Jev could not answer. Try again.") }));
  } finally {
    if (controller === c) controller = null;
    useJev.setState({ running: false });
    // Tool writes went through the API: refresh what they may have changed.
    void queryClient.invalidateQueries({ queryKey: sessionsKey });
  }
}

async function ensureSession(): Promise<string> {
  const s = useJev.getState();
  if (s.sessionId) return s.sessionId;
  const created = await assistantApi.create();
  useJev.setState({ sessionId: created.id, title: created.title });
  return created.id;
}

/** Reopening after a reload picks the last conversation back up. */
function restore() {
  const s = useJev.getState();
  if (s.sessionId && !s.entries.length && !s.loading && !s.running && !s.queued) void jev.load(s.sessionId);
}

export const jev = {
  open: (open = true) => {
    useJev.setState({ open });
    if (open) restore();
  },
  toggle: () => jev.open(!useJev.getState().open),
  setMode: (mode: Mode) => useJev.setState({ mode }),
  setOffset: (offset: State["offset"]) => useJev.setState({ offset }),
  sessions: (showSessions = !useJev.getState().showSessions) => useJev.setState({ showSessions }),

  /** A fresh, empty conversation (created on the first message). */
  newChat: () => {
    controller?.abort();
    useJev.setState({ sessionId: null, title: "", entries: [], approval: null, running: false, showSessions: false });
  },

  load: async (id: string) => {
    controller?.abort();
    useJev.setState({ sessionId: id, loading: true, entries: [], approval: null, showSessions: false, running: false });
    try {
      const tr = await assistantApi.get(id);
      if (useJev.getState().sessionId !== id) return;
      useJev.setState({ title: tr.session.title, entries: toEntries(tr), approval: tr.approval, loading: false });
    } catch {
      if (useJev.getState().sessionId === id) useJev.setState({ sessionId: null, title: "", entries: [], loading: false });
    }
  },

  send: async (text: string, context: PageContext | undefined = pageContext()) => {
    const t = text.trim();
    if (!t || useJev.getState().running) return;
    useJev.setState((s) => ({
      approval: null,
      entries: [...s.entries, { id: uid(), role: "user", text: t, blocks: [] }, { id: uid(), role: "assistant", text: "", blocks: [] }],
    }));
    await run(async (signal) => {
      const id = await ensureSession();
      await assistantApi.send(id, t, context, apply, signal);
    });
  },

  decide: async (decision: "approve" | "deny") => {
    const a = useJev.getState().approval;
    if (!a || useJev.getState().running) return;
    useJev.setState((s) => {
      const entries = s.entries.slice();
      if (entries[entries.length - 1]?.role !== "assistant") entries.push({ id: uid(), role: "assistant", text: "", blocks: [] });
      return { approval: null, entries };
    });
    await run((signal) => assistantApi.decide(a.action_id, decision, a.token, apply, signal));
    // The approved change went through the API: show it everywhere at once.
    if (decision === "approve") void queryClient.invalidateQueries({ queryKey: ["tickets"] });
  },

  stop: () => controller?.abort(),

  /** Open on a fresh conversation and ask `prompt` there. */
  ask: (prompt: string) => {
    const s = useJev.getState();
    if (s.sessionId || s.entries.length) jev.newChat();
    useJev.setState({ open: true, queued: prompt });
  },
  takeQueued: () => {
    const q = useJev.getState().queued;
    if (q) useJev.setState({ queued: null });
    return q;
  },
};
