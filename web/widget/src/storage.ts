// The visitor token survives reloads in localStorage. Storage can be blocked
// (privacy modes, sandboxed iframes): then it lives in memory for the page.

const memory: Record<string, string> = {};

export function load(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    /* storage blocked */
  }
  return memory[key] ?? null;
}

export function save(key: string, value: string | null) {
  if (value === null) delete memory[key];
  else memory[key] = value;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}
