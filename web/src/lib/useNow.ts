import { useSyncExternalStore } from "react";

// One shared clock for live durations ("waiting 2m 14s"): a single interval for every
// subscriber, running only while something is subscribed.

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const idle = () => () => {};

/** The current time, updated every second; frozen (no re-renders) while disabled. */
export function useNow(enabled = true): number {
  return useSyncExternalStore(enabled ? subscribe : idle, () => (enabled ? now : 0), () => now);
}
