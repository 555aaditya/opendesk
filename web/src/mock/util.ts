// Small helpers shared by the mock backend: a seeded RNG, ids and time.

let rngState = 0x2f6e2b1;

/** Deterministic PRNG (mulberry32) so the seed is identical on every load. */
export function rand(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function reseed(n: number) {
  rngState = n;
}

export function int(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function chance(p: number): boolean {
  return rand() < p;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let idCounter = 0;
/** UUID-shaped, deterministic during seeding, unique afterwards. */
export function uuid(): string {
  idCounter++;
  const hex = (n: number, len: number) => n.toString(16).padStart(len, "0").slice(-len);
  const a = Math.floor(rand() * 0xffffffff);
  const b = Math.floor(rand() * 0xffff);
  const c = Math.floor(rand() * 0xfff);
  const d = Math.floor(rand() * 0x3fff) | 0x8000;
  return `${hex(a, 8)}-${hex(b, 4)}-4${hex(c, 3)}-${hex(d, 4)}-${hex(idCounter, 4)}${hex(Math.floor(rand() * 0xffffffff), 8)}`;
}

/** uuid v7-ish for event ids: time ordered. */
export function uuid7(): string {
  const ms = Date.now().toString(16).padStart(12, "0");
  const r = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${r().slice(1)}-${r()}-${r()}${r()}${r()}`;
}

export function randomToken(len = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const NOW = Date.now();

export function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|li|h\d|div|blockquote)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function preview(html: string): string {
  const t = stripHtml(html);
  return t.length > 140 ? `${t.slice(0, 139)}…` : t;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToHtml(s: string): string {
  return s
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function avatarFor(_name: string): string {
  // Empty string: the app renders monochrome initials.
  return "";
}
