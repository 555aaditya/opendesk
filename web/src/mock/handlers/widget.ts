// Widget settings (admin) and the public widget config (contracts/api.md "Widget").

import type { WidgetConfig, WidgetSettings } from "@/lib/api/types";
import { db, userRef, type WsData } from "../db";
import { HttpError, forbidden, get, invalid, patch } from "../router";
import { hasControl, isRecord, nowIso, oneLine, uuid } from "../util";
import { aiOff } from "./ai";

type Check = (v: unknown) => unknown;

const bool = (key: string): Check => (v) => {
  if (typeof v !== "boolean") throw invalid(`${key} must be true or false`);
  return v;
};
const oneOf = <T extends string>(key: string, options: readonly T[]): Check => (v) => {
  if (typeof v !== "string" || !options.includes(v as T)) throw invalid(`${key} must be ${options.slice(0, -1).join(", ")} or ${options[options.length - 1]}`);
  return v;
};
const offset = (key: string): Check => (v) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 200) throw invalid(`${key} must be a whole number of pixels from 0 to 200`);
  return v;
};

/** Trimmed, whitespace collapsed, no <, > or control characters. */
function cleanText(key: string, v: unknown, max: number, min = 0): string {
  if (typeof v !== "string") throw invalid(`${key} must be text`);
  const s = oneLine(v);
  if (/[<>]/.test(s) || hasControl(s)) throw invalid(`${key} can't contain < or > or control characters`);
  if (s.length > max) throw invalid(`${key} can be at most ${max} characters`);
  if (s.length < min) throw invalid(`${key} must be at least ${min} characters`);
  return s;
}
const text = (key: string, max: number): Check => (v) => cleanText(key, v, max);

const CHECKS: Partial<Record<keyof WidgetSettings, Check>> = {
  enabled: bool("enabled"),
  require_email: bool("require_email"),
  show_team: bool("show_team"),
  sound: bool("sound"),
  greeting: (v) => {
    if (typeof v !== "string") throw invalid("greeting must be text");
    const s = v.replace(/\r\n/g, "\n").trim();
    if (s.length > 300) throw invalid("Keep the greeting under 300 characters");
    if (/[<>]/.test(s) || hasControl(s, true)) throw invalid("The greeting must be plain text, without < or >");
    return s;
  },
  allowed_origins: (v) => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw invalid("allowed_origins must be a list of origins");
    const list = (v as string[]).map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
    if (list.length > 20) throw invalid("Add at most 20 allowed origins");
    for (const o of list) if (!/^https?:\/\/[^/\s]+$/.test(o)) throw invalid(`${o} is not a valid origin (like https://example.com)`);
    return [...new Set(list)];
  },
  color: (v) => {
    if (typeof v !== "string" || (v !== "" && !/^#[0-9a-fA-F]{6}$/.test(v))) throw invalid("color must be a hex colour like #4f46e5, or empty for the brand colour");
    return v.toLowerCase();
  },
  theme: oneOf("theme", ["auto", "light", "dark"] as const),
  position: oneOf("position", ["right", "left"] as const),
  offset_x: offset("offset_x"),
  offset_y: offset("offset_y"),
  launcher: oneOf("launcher", ["icon", "label"] as const),
  launcher_label: text("launcher_label", 24),
  radius: oneOf("radius", ["square", "soft", "round"] as const),
  title: text("title", 40),
  subtitle: text("subtitle", 80),
  bot_name: text("bot_name", 30),
  suggestions: (v) => {
    if (!Array.isArray(v)) throw invalid("suggestions must be a list");
    const list = v.map((x) => cleanText("Each suggestion", x, 60)).filter(Boolean);
    if (list.length > 4) throw invalid("Add at most 4 suggestions");
    for (const s of list) if (s.length < 2) throw invalid("Each suggestion must be 2 to 60 characters");
    return list;
  },
};

function requireAdmin(ws: WsData) {
  const r = ws.members.find((m) => m.user_id === db.meId)?.role;
  if (r !== "owner" && r !== "admin") throw forbidden("Only admins can change the widget");
}

/** Validates every given key first, so a refused patch changes nothing. */
export function widgetPatch(body: Record<string, unknown>): Partial<WidgetSettings> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const check = CHECKS[k as keyof WidgetSettings];
    if (check) out[k] = check(v);
  }
  return out as Partial<WidgetSettings>;
}

export function widgetConfig(ws: WsData): WidgetConfig {
  const w = ws.widget;
  const wsSettings = ws.workspace.settings;
  const rank = { online: 0, away: 1, offline: 2 } as const;
  const team = w.show_team
    ? ws.members
        .filter((m) => m.role !== "viewer")
        .sort((a, b) => rank[a.availability ?? "online"] - rank[b.availability ?? "online"])
        .slice(0, 3)
        .map((m) => {
          const u = userRef(m.user_id);
          return { name: (u?.name ?? "").split(" ")[0], avatar_url: u?.avatar_url ?? null };
        })
    : [];
  return {
    workspace_name: ws.workspace.name,
    brand_color: w.color || wsSettings.brand_color || null,
    greeting: w.greeting,
    help_center_url: wsSettings.help_center_enabled ? `/help/${ws.workspace.slug}` : null,
    require_email: w.require_email,
    locale: wsSettings.locale || null,
    avatar_url: ws.workspace.images.widget_avatar ?? ws.workspace.avatar_url,
    launcher_icon_url: ws.workspace.images.widget_launcher,
    theme: w.theme,
    position: w.position,
    offset_x: w.offset_x,
    offset_y: w.offset_y,
    launcher: w.launcher,
    launcher_label: w.launcher_label,
    radius: w.radius,
    title: w.title,
    subtitle: w.subtitle,
    suggestions: [...w.suggestions],
    sound: w.sound,
    team,
    ai_answers: !aiOff() && ws.ai.enabled && ws.ai.widget_answers,
    bot: { name: w.bot_name || "Ollie", avatar_url: ws.workspace.images.widget_bot },
  };
}

export function registerWidget() {
  get("/v1/widget/settings", (ctx) => ctx.ws.widget);

  patch("/v1/widget/settings", (ctx) => {
    requireAdmin(ctx.ws);
    if (!isRecord(ctx.body)) throw invalid("Body must be an object");
    const changes = widgetPatch(ctx.body);
    ctx.ws.widget = { ...ctx.ws.widget, ...changes };
    ctx.ws.audit.unshift({
      id: uuid(),
      actor: { type: "user", user: userRef(db.meId), api_key_id: null },
      action: "widget.settings_updated",
      entity_type: "workspace",
      entity_id: ctx.ws.workspace.id,
      data: { keys: Object.keys(changes) },
      ip: "84.152.33.17",
      created_at: nowIso(),
    });
    return ctx.ws.widget;
  });

  // Public: the widget asks with its key, so any workspace may answer.
  get("/v1/widget/config", (ctx) => {
    const key = ctx.query.get("key");
    const ws = key ? db.workspaces.find((w) => w.workspace.widget_key === key) : ctx.ws;
    if (!ws) throw new HttpError(404, "not_found", "No widget uses this key");
    return widgetConfig(ws);
  });
}
