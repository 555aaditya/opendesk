// Mock billing (contracts/billing.md). Fieldnote is on Pro, Lumen Labs on Free.
// Override every workspace with ?mock_plan=free|pro|past_due|cancel|self_hosted.
//
// Stripe Checkout is simulated: the checkout endpoints return a URL back to
// /settings/billing, and the "webhook" lands a moment later (billing.updated),
// even across the full page load that follows, via sessionStorage.

import type { AIFeature, AutoRecharge, AutoRechargeFailure, Billing, BillingUsage, NotificationType, UserRef } from "@/lib/api/types";
import { db, userRef, type WsData } from "../db";
import { publish } from "../gateway";
import { HttpError, forbidden, get, patch, post, type Ctx } from "../router";
import { FAST_MODEL, DEFAULT_MODEL, JEV, meter, round3 } from "../credits";
import { DAY, NOW, int, nowIso, pick, rand, uuid } from "../util";
import { CREDIT_PACK_SIZE } from "@/components/billing/model";

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

type Persisted = Record<
  string,
  {
    plan?: MockPlan;
    interval?: "month" | "year";
    packs?: number;
    pending?: { plan?: MockPlan; interval?: "month" | "year"; packs?: number };
    /** A saved payment method (auto-recharge), and the auto-recharge settings. */
    card?: boolean;
    autoRecharge?: Pick<AutoRecharge, "enabled" | "threshold" | "packs" | "monthly_limit">;
  }
>;
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
      auto_recharge: null,
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
  c.used = round3(c.used);
  const overflow = Math.max(0, c.used - c.monthly);
  const purchased = round3(Math.max(0, (purchasedTotal.get(ws) ?? 0) - overflow));
  c.purchased = purchased;
  c.remaining = c.unlimited ? 0 : round3(Math.max(0, c.monthly - c.used) + purchased);
  const members = ws.members.length + (b.plan === "free" ? ws.invitations.length : 0);
  b.auto_recharge = autoRechargeOut(ws);
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
  ["answer_check", 8],
  ["answer", 6],
  ["assistant", 5],
  ["decide", 2],
  ["playground", 1],
  ["kb_draft", 1],
];

/** The model each feature ran on in the seeded history. */
function seedModel(f: AIFeature): string {
  if (f === "triage" || f === "decide" || f === "answer_check") return JEV;
  if (f === "rewrite" || f === "translate" || f === "summarize") return FAST_MODEL;
  return DEFAULT_MODEL;
}

/** A seeded usage row: metered like a real call, deterministic. */
function seedRow(f: AIFeature, user_id: string | null, at: number): WsData["aiUsage"][number] {
  return { ...meter(f, seedModel(f), rand), user_id, at: new Date(at).toISOString() };
}

/** The widget agent and automations act for nobody in particular. */
const unattended = (f: AIFeature) => f === "answer" || f === "answer_check" || f === "decide";
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
      ws.aiUsage.push(seedRow(f, unattended(f) ? null : pick(users), at));
    }
  }
}

function periodUsed(ws: WsData) {
  const end = Date.parse(ws.billing.credits.period_end);
  const start = end - 30 * DAY;
  return ws.aiUsage.filter((u) => {
    const t = Date.parse(u.at);
    return t >= start && t < end;
  }).reduce((s, u) => round3(s + u.credits), 0);
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
    while (left > 0.5) {
      const f = left >= 3 && rand() < 0.3 ? "draft_reply" : pick<AIFeature>(["summarize", "rewrite", "translate", "copilot"]);
      const at = start + rand() * (NOW - start);
      const row = seedRow(f, pick(users), at);
      ws.aiUsage.push(row);
      left -= row.credits;
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
  const models = new Map<string, { model: string; source: "credits" | "own_key"; credits: number; calls: number; input_tokens: number; output_tokens: number }>();
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
    const source = r.source ?? "credits";
    const mo = models.get(`${source}:${r.model}`) ?? { model: r.model, source, credits: 0, calls: 0, input_tokens: 0, output_tokens: 0 };
    mo.credits += r.credits;
    mo.calls += 1;
    mo.input_tokens += r.input_tokens;
    mo.output_tokens += r.output_tokens;
    models.set(`${source}:${r.model}`, mo);
  }
  const rounded = <T extends { credits: number }>(v: T): T => ({ ...v, credits: round3(v.credits) });
  return {
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
    total_credits: round3(inRange.reduce((s, r) => s + r.credits, 0)),
    total_calls: inRange.length,
    by_feature: [...feats].map(([feature, v]) => rounded({ feature, ...v })).sort((a, b) => b.credits - a.credits),
    by_day: [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        ...rounded(v),
        by_feature: Object.fromEntries(Object.entries(v.by_feature).map(([k, n]) => [k, round3(n)])) as Partial<Record<AIFeature, number>>,
      })),
    by_member: [...members].map(([id, v]) => rounded({ user: id ? ref(id) : null, ...v })).sort((a, b) => b.credits - a.credits),
    by_model: [...models.values()].map((v) => rounded(v)).sort((a, b) => b.credits - a.credits || b.calls - a.calls),
    own_key_calls: inRange.filter((r) => r.source === "own_key").length,
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
    notified.delete(ws);
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
  // ?mock_credits=low|out shows the running-low banner; ?mock_recharge=decline|auth makes recharges fail.
  const forcedCredits = params.get("mock_credits");
  const failMode = params.get("mock_recharge");
  rechargeFailure = failMode === "decline" ? "card_declined" : failMode === "auth" ? "authentication_required" : null;
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
    // Fieldnote has a card on file from its Pro checkout.
    if (i === 0 || entry?.card) cards.add(ws);
    if (entry?.autoRecharge && ws.billing.billing_enabled) Object.assign(autoRechargeOut(ws) ?? {}, entry.autoRecharge);
    if (forcedCredits === "low" || forcedCredits === "out") forceCredits(ws, forcedCredits);
  });
  registerAutoRecharge();

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


// ─── Auto-recharge (contracts/billing.md "Auto-recharge") ──────────────────

/** Below this a widget reply or a draft can't start: Ollie is paused. */
export const OUT_OF_CREDITS_BELOW = 3;
/** How long the simulated off-session payment takes. */
export const RECHARGE_DELAY = 900;

type RechargeRow = NonNullable<AutoRecharge["last_recharge"]>;
const recharges = new WeakMap<WsData, RechargeRow[]>();
const cards = new WeakSet<WsData>();
const inFlight = new WeakSet<WsData>();
/** Running-low notices already sent this period (period_end), per workspace. */
const notified = new WeakMap<WsData, { low?: string; out?: string }>();
let rechargeFailure: AutoRechargeFailure | null = null;

/** Tests: make the next recharges fail with `code`, or succeed with null. */
export function setRechargeFailure(code: AutoRechargeFailure | null) {
  rechargeFailure = code;
}
/** Tests and the setup Checkout: the workspace has a saved card. */
export function saveCard(ws: WsData, saved = true) {
  if (saved) cards.add(ws);
  else cards.delete(ws);
}

function defaultAutoRecharge(): AutoRecharge {
  return { enabled: false, threshold: 200, packs: 1, monthly_limit: 5, recharges_this_month: 0, low_at: 10, last_recharge: null, failure: null };
}

/** The live auto-recharge state: counts and low_at derived; null when billing is off. */
function autoRechargeOut(ws: WsData): AutoRecharge | null {
  const b = ws.billing;
  if (!b.billing_enabled) return null;
  const ar = (b.auto_recharge ??= defaultAutoRecharge());
  const month = new Date().toISOString().slice(0, 7);
  const rows = recharges.get(ws) ?? [];
  ar.recharges_this_month = rows.filter((r) => r.at.startsWith(month)).length;
  ar.last_recharge = rows.at(-1) ?? null;
  ar.low_at = ar.enabled ? ar.threshold : Math.min(ar.threshold, Math.max(Math.floor(b.credits.monthly / 5), 5));
  if (ar.enabled) ar.failure = null;
  return ar;
}

function persistAutoRecharge(ws: WsData, ar: AutoRecharge) {
  const p = load();
  const entry = (p[ws.workspace.slug] ??= {});
  entry.autoRecharge = { enabled: ar.enabled, threshold: ar.threshold, packs: ar.packs, monthly_limit: ar.monthly_limit };
  save(p);
}

function isAdmin(ws: WsData) {
  const r = role(ws);
  return r === "owner" || r === "admin";
}

function notify(ws: WsData, type: string, data: Record<string, unknown>) {
  if (!isAdmin(ws)) return;
  const n = { id: uuid(), type: type as NotificationType, ticket: null, data, read_at: null, created_at: nowIso() };
  ws.notifications.unshift(n);
  publish(ws, "notification.created", { notification: n }, { topics: [`user:${db.meId}`] });
}

/** A running-low or out notice, once a period; a grant re-arms both. */
function noticeOnce(ws: WsData, kind: "low" | "out", remaining: number) {
  const period = ws.billing.credits.period_end;
  const sent = notified.get(ws) ?? {};
  if (sent[kind] === period) return;
  notified.set(ws, { ...sent, [kind]: period });
  notify(ws, kind === "low" ? "credits_low" : "credits_out", { remaining: round3(remaining) });
  changed(ws);
}

/**
 * After a charged call (credits.ts spend): queue a recharge below the threshold
 * when auto-recharge is on with recharges left this month; otherwise tell
 * admins when credits cross below low_at, and again when they run out.
 */
export function afterSpend(ws: WsData, before: number, after: number) {
  billingOut(ws);
  const ar = ws.billing.auto_recharge;
  if (!ar || ws.billing.credits.unlimited) return;
  if (ar.enabled && after < ar.threshold && ar.recharges_this_month < ar.monthly_limit) {
    scheduleRecharge(ws);
    return;
  }
  if (before >= OUT_OF_CREDITS_BELOW && after < OUT_OF_CREDITS_BELOW) noticeOnce(ws, "out", after);
  else if (before >= ar.low_at && after < ar.low_at && after >= OUT_OF_CREDITS_BELOW) noticeOnce(ws, "low", after);
}

function scheduleRecharge(ws: WsData) {
  if (inFlight.has(ws)) return;
  inFlight.add(ws);
  setTimeout(() => {
    inFlight.delete(ws);
    recharge(ws);
  }, RECHARGE_DELAY);
}

/** The simulated off-session PaymentIntent: credits granted, or auto-recharge off on failure. */
function recharge(ws: WsData) {
  const b = billingOut(ws);
  const ar = ws.billing.auto_recharge;
  const pack = b.prices.credit_pack;
  if (!ar?.enabled || !pack || b.credits.remaining >= ar.threshold || ar.recharges_this_month >= ar.monthly_limit) return;
  const failure: AutoRechargeFailure | null = !cards.has(ws) ? "no_payment_method" : rechargeFailure;
  if (failure) {
    ar.enabled = false;
    ar.failure = { code: failure, at: nowIso() };
    persistAutoRecharge(ws, ar);
    notify(ws, "auto_recharge_failed", { reason: failure });
    changed(ws);
    return;
  }
  addPacks(ws, ar.packs);
  const rows = recharges.get(ws) ?? [];
  rows.push({ at: nowIso(), packs: ar.packs, credits: ar.packs * (pack.credits ?? PACK), amount: pack.unit_amount * ar.packs, currency: pack.currency });
  recharges.set(ws, rows);
  notified.delete(ws);
  changed(ws);
}

/** ?mock_credits=low|out: a balance that shows the banner. */
function forceCredits(ws: WsData, kind: "low" | "out") {
  const ar = autoRechargeOut(ws);
  if (!ar) return;
  purchasedTotal.set(ws, 0);
  const left = kind === "out" ? 1.5 : Math.max(OUT_OF_CREDITS_BELOW + 1, Math.round(ar.low_at * 0.6));
  ws.billing.credits.used = round3(ws.billing.credits.monthly - left);
}

const int01 = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

function registerAutoRecharge() {
  patch("/v1/billing/auto-recharge", (ctx) => {
    requireStripe(ctx.ws);
    requireAdmin(ctx.ws);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new HttpError(422, "validation_failed", "enabled must be true or false");
    if (body.threshold !== undefined && !int01(body.threshold, 1, 100000)) throw new HttpError(422, "validation_failed", "threshold must be 1 to 100,000 credits");
    if (body.packs !== undefined && !int01(body.packs, 1, 20)) throw new HttpError(422, "validation_failed", "packs must be 1 to 20");
    if (body.monthly_limit !== undefined && !int01(body.monthly_limit, 1, 30)) throw new HttpError(422, "validation_failed", "monthly_limit must be 1 to 30");
    billingOut(ctx.ws);
    const ar = ctx.ws.billing.auto_recharge!;
    const nextThreshold = typeof body.threshold === "number" ? body.threshold : ar.threshold;
    const nextPacks = typeof body.packs === "number" ? body.packs : ar.packs;
    if (nextPacks * CREDIT_PACK_SIZE <= nextThreshold)
      throw new HttpError(422, "recharge_too_small", "Each recharge must bring your credits back above the threshold. Buy more packs per recharge or lower the threshold.");
    if (body.enabled === true && !ar.enabled) {
      if (!ctx.ws.billing.prices.credit_pack) throw new HttpError(422, "credits_unavailable", "Credit packs are not available.");
      if (!cards.has(ctx.ws)) throw new HttpError(409, "payment_method_required", "Add a payment method before turning on auto-recharge.");
      ar.failure = null;
    }
    if (typeof body.enabled === "boolean") ar.enabled = body.enabled;
    if (typeof body.threshold === "number") ar.threshold = body.threshold;
    if (typeof body.packs === "number") ar.packs = body.packs;
    if (typeof body.monthly_limit === "number") ar.monthly_limit = body.monthly_limit;
    persistAutoRecharge(ctx.ws, ar);
    const out = billingOut(ctx.ws);
    changed(ctx.ws);
    // Already below the threshold: recharge now.
    if (ar.enabled && out.credits.remaining < ar.threshold && ar.recharges_this_month < ar.monthly_limit) scheduleRecharge(ctx.ws);
    return out;
  });

  // Stripe Checkout in setup mode: the card is attached before the customer is back.
  post("/v1/billing/payment-method", (ctx) => {
    requireStripe(ctx.ws);
    requireAdmin(ctx.ws);
    cards.add(ctx.ws);
    const p = load();
    (p[slugOf(ctx)] ??= {}).card = true;
    save(p);
    return { url: "/settings/billing?payment_method=success" };
  });
}
