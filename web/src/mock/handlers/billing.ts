// Mock billing (contracts/billing.md). Fieldnote is on Pro, Lumen Labs on Free.
// Override every workspace with ?mock_plan=free|pro|past_due|cancel|self_hosted.
//
// Stripe Checkout is simulated: the checkout endpoints return a URL back to
// /settings/billing, and the "webhook" lands a moment later (billing.updated),
// even across the full page load that follows, via sessionStorage.

import type { AIFeature, Billing, BillingUsage, UserRef } from "@/lib/api/types";
import { db, userRef, type WsData } from "../db";
import { publish } from "../gateway";
import { HttpError, forbidden, get, post, type Ctx } from "../router";
import { COSTS } from "../credits";
import { DAY, NOW, int, pick, rand } from "../util";

type MockPlan = "free" | "pro" | "past_due" | "cancel" | "self_hosted";

const PRICES: Billing["prices"] = {
  pro_month: { id: "price_mock_pro_month", unit_amount: 1900, currency: "usd", interval: "month" },
  pro_year: { id: "price_mock_pro_year", unit_amount: 19000, currency: "usd", interval: "year" },
  credit_pack: { id: "price_mock_credits", unit_amount: 2000, currency: "usd", interval: null, credits: 2000 },
};
const PACK = 2000;
const FREE_CREDITS = 50;
const PRO_CREDITS_PER_SEAT = 1000;

/** Purchased credits ever added, per workspace; `credits.purchased` is what's left. */
const purchasedTotal = new WeakMap<WsData, number>();
const seeded = new WeakSet<WsData>();

// ─── Persistence across the reload that follows a checkout ─────────────────

type Persisted = Record<string, { plan?: MockPlan; interval?: "month" | "year"; packs?: number; pending?: { plan?: MockPlan; interval?: "month" | "year"; packs?: number } }>;
const KEY = "od-mock-billing";

function load(): Persisted {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Persisted;
  } catch {
    return {};
  }
}
function save(p: Persisted) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: the change lasts until reload */
  }
}

// ─── State ─────────────────────────────────────────────────────────────────

function role(ws: WsData) {
  return ws.members.find((m) => m.user_id === db.meId)?.role ?? "viewer";
}
function requireAdmin(ws: WsData) {
  const r = role(ws);
  if (r !== "owner" && r !== "admin") throw forbidden("Only owners and admins can manage billing");
}
function billedSeats(ws: WsData) {
  return ws.members.filter((m) => m.role !== "viewer").length;
}

function applyPlan(ws: WsData, plan: MockPlan, interval: "month" | "year" = "month") {
  const b = ws.billing;
  const c = b.credits;
  if (plan === "self_hosted") {
    Object.assign(b, {
      plan: "self_hosted",
      billing_enabled: false,
      status: "none",
      interval: "month",
      seats: 0,
      current_period_end: null,
      cancel_at_period_end: false,
      limits: { max_mailboxes: 0, max_members: 0 },
      prices: { pro_month: null, pro_year: null, credit_pack: null },
    } satisfies Partial<Billing>);
    Object.assign(c, { unlimited: true, monthly: 0 });
    return;
  }
  b.billing_enabled = true;
  b.prices = structuredClone(PRICES);
  c.unlimited = false;
  if (plan === "free") {
    Object.assign(b, { plan: "free", status: "none", interval: "month", seats: 0, current_period_end: null, cancel_at_period_end: false, limits: { max_mailboxes: 1, max_members: 1 } } satisfies Partial<Billing>);
    c.monthly = FREE_CREDITS;
    return;
  }
  const seats = billedSeats(ws);
  Object.assign(b, {
    plan: "pro",
    status: plan === "past_due" ? "past_due" : "active",
    interval,
    seats,
    current_period_end: c.period_end,
    cancel_at_period_end: plan === "cancel",
    limits: { max_mailboxes: 0, max_members: 0 },
  } satisfies Partial<Billing>);
  c.monthly = PRO_CREDITS_PER_SEAT * seats;
}

function addPacks(ws: WsData, packs: number) {
  purchasedTotal.set(ws, (purchasedTotal.get(ws) ?? 0) + packs * PACK);
}

/** The Billing as the API returns it: usage counted live, credits derived. */
export function billingOut(ws: WsData): Billing {
  ensure(ws);
  const b = ws.billing;
  const c = b.credits;
  const overflow = Math.max(0, c.used - c.monthly);
  const purchased = Math.max(0, (purchasedTotal.get(ws) ?? 0) - overflow);
  c.purchased = purchased;
  c.remaining = c.unlimited ? 0 : Math.max(0, c.monthly - c.used) + purchased;
  const members = ws.members.length + (b.plan === "free" ? ws.invitations.length : 0);
  return structuredClone({
    ...b,
    billed_seats: billedSeats(ws),
    usage: { mailboxes: ws.mailboxes.length, members },
  });
}

/** 402 plan_limit when creating one more `kind` would pass the plan's cap. */
export function checkLimit(ws: WsData, kind: "mailbox" | "member") {
  const b = billingOut(ws);
  if (kind === "mailbox" && b.limits.max_mailboxes > 0 && b.usage.mailboxes >= b.limits.max_mailboxes) {
    throw new HttpError(402, "plan_limit", `The Free plan includes ${b.limits.max_mailboxes} mailbox. Upgrade to Pro for unlimited mailboxes.`, { limit: "mailboxes" });
  }
  if (kind === "member" && b.limits.max_members > 0 && b.usage.members >= b.limits.max_members) {
    throw new HttpError(402, "plan_limit", `The Free plan includes ${b.limits.max_members} member. Upgrade to Pro to invite your team.`, { limit: "members" });
  }
}

function changed(ws: WsData) {
  publish(ws, "billing.updated", billingOut(ws) as unknown as Record<string, unknown>);
}

// ─── Seed ──────────────────────────────────────────────────────────────────

const WEIGHTS: [AIFeature, number][] = [
  ["summarize", 30],
  ["draft_reply", 22],
  ["rewrite", 16],
  ["copilot", 10],
  ["translate", 9],
  ["triage", 8],
  ["answer", 4],
  ["kb_draft", 1],
];
function feature(): AIFeature {
  let r = rand() * WEIGHTS.reduce((s, [, w]) => s + w, 0);
  for (const [f, w] of WEIGHTS) if ((r -= w) < 0) return f;
  return "summarize";
}

/** About `perDay` calls a day for 60 days, fewer on weekends, from the team. */
function seedUsage(ws: WsData, perDay: number) {
  const users = ws.members.filter((m) => m.role !== "viewer").map((m) => m.user_id);
  for (let d = 59; d >= 0; d--) {
    const dayStart = NOW - d * DAY;
    const dow = new Date(dayStart).getUTCDay();
    const n = Math.max(0, Math.round(perDay * (dow === 0 || dow === 6 ? 0.3 : 0.7 + rand() * 0.6)));
    for (let i = 0; i < n; i++) {
      const f = feature();
      const at = dayStart - int(0, 20) * 3_600_000;
      if (at > NOW) continue;
      ws.aiUsage.push({ feature: f, user_id: f === "answer" ? null : pick(users), credits: COSTS[f], at: new Date(at).toISOString() });
    }
  }
}

function periodUsed(ws: WsData) {
  const end = Date.parse(ws.billing.credits.period_end);
  const start = end - 30 * DAY;
  return ws.aiUsage.filter((u) => {
    const t = Date.parse(u.at);
    return t >= start && t < end;
  }).reduce((s, u) => s + u.credits, 0);
}

function seedWorkspace(ws: WsData, plan: MockPlan) {
  const c = ws.billing.credits;
  if (plan === "free") {
    c.period_end = new Date(NOW + 12 * DAY).toISOString();
    applyPlan(ws, "free");
    // Free history is light; the current period sits at 38 of 50.
    seedUsage(ws, 0.6);
    const start = Date.parse(c.period_end) - 30 * DAY;
    ws.aiUsage = ws.aiUsage.filter((u) => Date.parse(u.at) < start);
    const users = ws.members.map((m) => m.user_id);
    let left = 38;
    while (left > 0) {
      const f = left >= 3 && rand() < 0.3 ? "draft_reply" : pick<AIFeature>(["summarize", "rewrite", "translate"]);
      const at = start + rand() * (NOW - start);
      ws.aiUsage.push({ feature: f, user_id: pick(users), credits: COSTS[f], at: new Date(at).toISOString() });
      left -= COSTS[f];
    }
  } else {
    c.period_end = new Date(NOW + 18 * DAY).toISOString();
    applyPlan(ws, plan);
    seedUsage(ws, 3.2 * Math.max(1, billedSeats(ws)));
    addPacks(ws, 1);
  }
  ws.aiUsage.sort((a, b) => a.at.localeCompare(b.at));
  c.used = periodUsed(ws);
}

/** Workspaces created after install (onboarding) start on Free. */
function ensure(ws: WsData) {
  if (seeded.has(ws)) return;
  seeded.add(ws);
  ws.billing.credits.period_end = new Date(NOW + 30 * DAY).toISOString();
  applyPlan(ws, "free");
  ws.billing.credits.used = 0;
}

// ─── Usage aggregation ─────────────────────────────────────────────────────

export function aggregateUsage(rows: WsData["aiUsage"], from: string, to: string, ref: (id: string | null) => UserRef | null): BillingUsage {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`) + DAY;
  const inRange = rows.filter((r) => {
    const t = Date.parse(r.at);
    return t >= start && t < end;
  });
  const days = new Map<string, { credits: number; calls: number; by_feature: Partial<Record<AIFeature, number>> }>();
  const feats = new Map<AIFeature, { credits: number; calls: number }>();
  const members = new Map<string, { credits: number; calls: number }>();
  for (const r of inRange) {
    const dayKey = r.at.slice(0, 10);
    const day = days.get(dayKey) ?? { credits: 0, calls: 0, by_feature: {} };
    day.credits += r.credits;
    day.calls += 1;
    day.by_feature[r.feature] = (day.by_feature[r.feature] ?? 0) + r.credits;
    days.set(dayKey, day);
    const f = feats.get(r.feature) ?? { credits: 0, calls: 0 };
    f.credits += r.credits;
    f.calls += 1;
    feats.set(r.feature, f);
    const key = r.user_id ?? "";
    const m = members.get(key) ?? { credits: 0, calls: 0 };
    m.credits += r.credits;
    m.calls += 1;
    members.set(key, m);
  }
  return {
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
    total_credits: inRange.reduce((s, r) => s + r.credits, 0),
    total_calls: inRange.length,
    by_feature: [...feats].map(([feature, v]) => ({ feature, ...v })).sort((a, b) => b.credits - a.credits),
    by_day: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    by_member: [...members].map(([id, v]) => ({ user: id ? ref(id) : null, ...v })).sort((a, b) => b.credits - a.credits),
  };
}

// ─── Routes ────────────────────────────────────────────────────────────────

function requireStripe(ws: WsData) {
  if (!billingOut(ws).billing_enabled) throw new HttpError(404, "billing_disabled", "Billing isn't available on this instance.");
}

function slugOf(ctx: Ctx) {
  return ctx.ws.workspace.slug;
}

function settle(ws: WsData) {
  const p = load();
  const entry = p[ws.workspace.slug];
  if (!entry?.pending) return;
  const { plan, interval, packs } = entry.pending;
  if (plan) {
    applyPlan(ws, plan, interval);
    entry.plan = plan;
    entry.interval = interval;
  }
  if (packs) {
    addPacks(ws, packs);
    entry.packs = (entry.packs ?? 0) + packs;
  }
  delete entry.pending;
  save(p);
  changed(ws);
}

/** The "Stripe webhook" arrives a moment after the customer is back. */
function scheduleSettle(ws: WsData, ms = 1600) {
  setTimeout(() => settle(ws), ms);
}

export function registerBilling() {
  const params = new URLSearchParams(location.search);
  const forced = params.get("mock_plan") as MockPlan | null;
  const persisted = load();

  db.workspaces.forEach((ws, i) => {
    seeded.add(ws);
    seedWorkspace(ws, i === 0 ? "pro" : "free");
    const entry = persisted[ws.workspace.slug];
    if (entry?.plan) applyPlan(ws, entry.plan, entry.interval);
    if (entry?.packs) addPacks(ws, entry.packs);
    if (forced && ["free", "pro", "past_due", "cancel", "self_hosted"].includes(forced)) {
      applyPlan(ws, forced);
      // A forced Free reads like a real Free workspace: a light month, no packs.
      if (forced === "free") {
        ws.billing.credits.used = 38;
        purchasedTotal.set(ws, 0);
      }
    }
    if (entry?.pending) scheduleSettle(ws);
  });

  get("/v1/billing", (ctx) => billingOut(ctx.ws));

  post("/v1/billing/checkout", (ctx) => {
    requireStripe(ctx.ws);
    requireAdmin(ctx.ws);
    if (ctx.ws.billing.plan === "pro" && ctx.ws.billing.status !== "canceled") throw new HttpError(409, "conflict", "This workspace is already on Pro. Manage it in the billing portal.");
    const interval = ctx.body.interval === "year" ? "year" : "month";
    const p = load();
    p[slugOf(ctx)] = { ...p[slugOf(ctx)], pending: { plan: "pro", interval } };
    save(p);
    scheduleSettle(ctx.ws);
    return { url: "/settings/billing?checkout=success" };
  });

  post("/v1/billing/portal", (ctx) => {
    requireStripe(ctx.ws);
    requireAdmin(ctx.ws);
    if (ctx.ws.billing.plan !== "pro") throw new HttpError(409, "conflict", "There's no subscription to manage yet.");
    return { url: "/settings/billing" };
  });

  post("/v1/billing/credits/checkout", (ctx) => {
    requireStripe(ctx.ws);
    requireAdmin(ctx.ws);
    const packs = Number(ctx.body.packs);
    if (!Number.isInteger(packs) || packs < 1 || packs > 20) throw new HttpError(422, "validation_failed", "Choose between 1 and 20 packs");
    const p = load();
    const entry = (p[slugOf(ctx)] ??= {});
    entry.pending = { ...entry.pending, packs: (entry.pending?.packs ?? 0) + packs };
    save(p);
    scheduleSettle(ctx.ws);
    return { url: "/settings/billing?credits=success" };
  });

  get("/v1/billing/usage", (ctx) => {
    requireStripe(ctx.ws);
    requireAdmin(ctx.ws);
    const today = new Date().toISOString().slice(0, 10);
    const from = ctx.query.get("from") ?? new Date(Date.now() - 29 * DAY).toISOString().slice(0, 10);
    const to = ctx.query.get("to") ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      throw new HttpError(422, "validation_failed", "from and to must be YYYY-MM-DD, from before to");
    }
    return aggregateUsage(ctx.ws.aiUsage, from, to, userRef);
  });
}

