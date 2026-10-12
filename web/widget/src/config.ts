// The widget's appearance from /v1/widget/config. Every appearance key has a
// default (contracts/api.md "Widget"), so an older server, or a stored setting
// without the key, reads the same as the default.

import { contrastText, isHex } from "./html";
import type { WidgetConfig, WidgetRadius } from "./types";

export const BOT_NAME = "Ollie";

const clamp = (n: unknown, lo: number, hi: number, d: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : d;
  return Math.min(hi, Math.max(lo, v));
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
const url = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim() : null);

/** Fill in every key with its default and keep values in their documented ranges. */
export function resolveConfig(raw: Partial<WidgetConfig> | null | undefined): WidgetConfig {
  const r = raw ?? {};
  const suggestions = Array.isArray(r.suggestions)
    ? r.suggestions
        .map((s) => str(s, 60))
        .filter((s) => s.length >= 2)
        .slice(0, 4)
    : [];
  const team = Array.isArray(r.team)
    ? r.team
        .filter((m) => m && typeof m.name === "string")
        .slice(0, 3)
        .map((m) => ({ name: m.name.trim().slice(0, 40), avatar_url: url(m.avatar_url) }))
    : [];
  return {
    workspace_name: str(r.workspace_name, 80),
    brand_color: isHex(r.brand_color) ? r.brand_color.trim() : null,
    greeting: typeof r.greeting === "string" ? r.greeting : "",
    help_center_url: url(r.help_center_url),
    require_email: r.require_email === true,
    locale: r.locale ?? null,
    avatar_url: url(r.avatar_url),
    launcher_icon_url: url(r.launcher_icon_url),
    theme: oneOf(r.theme, ["auto", "light", "dark"] as const, "auto"),
    position: oneOf(r.position, ["right", "left"] as const, "right"),
    offset_x: clamp(r.offset_x, 0, 200, 20),
    offset_y: clamp(r.offset_y, 0, 200, 20),
    launcher: oneOf(r.launcher, ["icon", "label"] as const, "icon"),
    launcher_label: str(r.launcher_label, 24),
    radius: oneOf(r.radius, ["square", "soft", "round"] as const, "soft"),
    title: str(r.title, 40),
    subtitle: str(r.subtitle, 80),
    suggestions,
    sound: r.sound === true,
    team,
    ai_answers: r.ai_answers === true,
    bot: { name: str(r.bot?.name, 30) || BOT_NAME, avatar_url: url(r.bot?.avatar_url) },
  };
}

/** Corner radii per preset: panel, bubbles, launcher, controls (buttons, chips), cards, the composer bar, avatars. */
export const RADII: Record<WidgetRadius, { panel: number; bubble: number; launcher: string; ctl: string; card: number; bar: number; av: string }> = {
  square: { panel: 6, bubble: 6, launcher: "10px", ctl: "4px", card: 4, bar: 4, av: "4px" },
  soft: { panel: 16, bubble: 14, launcher: "16px", ctl: "8px", card: 10, bar: 10, av: "6px" },
  round: { panel: 24, bubble: 20, launcher: "999px", ctl: "999px", card: 16, bar: 22, av: "999px" },
};

/** CSS custom properties on the widget host for a resolved config. */
export function hostVars(c: WidgetConfig): Record<string, string> {
  const r = RADII[c.radius ?? "soft"];
  const vars: Record<string, string> = {
    "--r-panel": `${r.panel}px`,
    "--r-bubble": `${r.bubble}px`,
    "--r-launcher": r.launcher,
    "--r-ctl": r.ctl,
    "--r-card": `${r.card}px`,
    "--r-bar": `${r.bar}px`,
    "--r-av": r.av,
    "--ox": `${c.offset_x ?? 20}px`,
    "--oy": `${c.offset_y ?? 20}px`,
  };
  if (isHex(c.brand_color)) {
    const hex = c.brand_color.startsWith("#") ? c.brand_color : `#${c.brand_color}`;
    vars["--brand"] = hex;
    vars["--brand-fg"] = contrastText(hex);
  }
  return vars;
}

/** Write `hostVars` onto an element, clearing the brand colour when the config has none. */
export function applyHostVars(el: HTMLElement, c: WidgetConfig) {
  const vars = hostVars(c);
  for (const k of ["--brand", "--brand-fg"]) if (!(k in vars)) el.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

/** The visitor's current page for the agent: https only, no fragment or credentials, at most 500 characters. */
export function pageUrl(href: string | undefined = typeof location === "undefined" ? undefined : location.href): string | undefined {
  if (!href) return undefined;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:") return undefined;
  u.hash = "";
  u.username = "";
  u.password = "";
  let s = u.href;
  if (s.length > 500) s = (u.origin + u.pathname).slice(0, 500);
  return s;
}
