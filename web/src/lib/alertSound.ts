import { useSyncExternalStore } from "react";

// Alert sounds, synthesized with Web Audio so there is no asset to load. Browsers allow
// audio only after the person interacted with the page, so the context is created and
// resumed on the first pointer or key press; until then a sound is skipped silently.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  ctx ??= new AudioContext();
  return ctx;
}

if (typeof window !== "undefined") {
  const unlock = () => {
    const c = audio();
    if (c && c.state === "suspended") void c.resume();
  };
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true });
}

function tone(c: AudioContext, freq: number, start: number, length: number, volume: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

export type AlertSound = "waiting" | "reminder";

/**
 * waiting: a bright rising three-note chime, a visitor needs a person now.
 * reminder: a softer two-note ping, they are still waiting.
 */
export function playAlert(kind: AlertSound) {
  const c = audio();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.01;
  if (kind === "waiting") {
    tone(c, 880, t, 0.22, 0.22);
    tone(c, 1174.66, t + 0.11, 0.24, 0.22);
    tone(c, 1567.98, t + 0.22, 0.42, 0.2);
  } else {
    tone(c, 1046.5, t, 0.2, 0.12);
    tone(c, 1318.51, t + 0.12, 0.32, 0.1);
  }
}

// ── The on/off preference, per browser ─────────────────────────────────────────────

const KEY = "od-chat-alert-sound";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

let enabled = read();

export function setAlertSound(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export function alertSoundOn(): boolean {
  return enabled;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    enabled = read();
    listeners.forEach((l) => l());
  });
}

/** Whether alert sounds are on, kept in sync across tabs. */
export function useAlertSound(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => enabled,
    () => true,
  );
}

// ── One tab plays ──────────────────────────────────────────────────────────────────

const PLAYED_KEY = "od-chat-alert-played";

/** Plays unless another tab of this browser just played the same alert. */
export function playAlertOnce(kind: AlertSound, id: string) {
  if (!enabled) return;
  const stamp = `${kind}:${id}`;
  try {
    const last = localStorage.getItem(PLAYED_KEY);
    if (last) {
      const [at, prev] = [Number(last.slice(0, last.indexOf("|"))), last.slice(last.indexOf("|") + 1)];
      if (prev === stamp && Date.now() - at < 5000) return;
    }
    localStorage.setItem(PLAYED_KEY, `${Date.now()}|${stamp}`);
  } catch {
    /* storage unavailable: play anyway */
  }
  playAlert(kind);
}
