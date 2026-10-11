import { useSyncExternalStore } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "od-theme";
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

let current: ThemePref = read();

function systemDark() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolvedDark(pref: ThemePref = current) {
  return pref === "dark" || (pref === "system" && systemDark());
}

export function applyTheme(pref: ThemePref = current) {
  const dark = resolvedDark(pref);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(pref: ThemePref) {
  current = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable */
  }
  applyTheme(pref);
  listeners.forEach((l) => l());
}

export function initTheme() {
  applyTheme();
  if (typeof matchMedia !== "undefined") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (current === "system") {
        applyTheme();
        listeners.forEach((l) => l());
      }
    });
  }
}

export function useTheme() {
  const pref = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return { pref, dark: resolvedDark(pref), setTheme };
}
