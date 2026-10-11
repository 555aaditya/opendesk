// Mock AI platform routes (contracts/ai.md): config, settings, semantic search
// and KB article drafts. `?mock_ai=off` behaves like an instance with no
// provider: config says disabled and every other AI route answers 404.

import type { AIConfig, AISettings, KbArticle, KBArticleDraft, SearchResults, Ticket } from "@/lib/api/types";
import { db, type WsData } from "../db";
import { COSTS, reserve, spend } from "../credits";
import { publish } from "../gateway";
import { HttpError, forbidden, get, invalid, patch, post, strArr, type Ctx } from "../router";
import { escapeHtml, isRecord, stripHtml } from "../util";

export function aiOff(): boolean {
  return typeof location !== "undefined" && new URLSearchParams(location.search).get("mock_ai") === "off";
}

/** Throws 404 ai_disabled when the instance (or the workspace) has AI off. */
export function assertAi(ws: WsData) {
  if (aiOff()) throw new HttpError(404, "ai_disabled", "AI isn't set up on this instance.");
  if (!ws.ai.enabled) throw new HttpError(404, "ai_disabled", "AI is turned off for this workspace.");
}

function role(ws: WsData) {
  return ws.members.find((m) => m.user_id === db.meId)?.role ?? "viewer";
}

function config(ws: WsData): AIConfig {
  if (aiOff()) {
    return { enabled: false, provider: "none", models: { default: "", fast: "" }, embeddings: false, features: { ...ws.ai, enabled: false }, costs: {} };
  }
  return {
    enabled: true,
    provider: "anthropic",
    models: { default: "claude-sonnet-5-5", fast: "claude-haiku-4-5-20251001" },
    embeddings: true,
    features: ws.ai,
    costs: { ...COSTS },
  };
}

// ─── Semantic-ish search ────────────────────────────────────────────────────

const STOP = new Set(
  "a an and are as at be but by can do does for from has have how i if in into is it its me my no not of on or our so that the their them then there this to up was we what when where which who why will with you your can't don't isn't won't get back make need want like just also still please hi hello thanks after before again".split(" "),
);

/** Small concept groups, so "money back" finds "refund" the way embeddings would. */
const SYNONYMS: string[][] = [
  ["refund", "money", "reimburse", "chargeback", "charge", "charged", "billing", "invoice", "payment"],
  ["login", "log", "signin", "sign", "sso", "saml", "password", "locked", "auth", "authentication", "access"],
  ["slow", "lag", "performance", "loading", "speed", "timeout"],
  ["export", "download", "backup", "markdown", "pdf"],
  ["import", "migrate", "migration", "evernote", "notion", "transfer"],
  ["image", "images", "photo", "picture", "attachment", "screenshot"],
  ["search", "find", "lookup", "ocr", "index"],
  ["cancel", "downgrade", "close", "delete", "plan", "subscription"],
  ["sync", "offline", "android", "ios", "mobile", "device"],
  ["team", "seat", "seats", "workspace", "member", "invite"],
  ["broken", "bug", "error", "crash", "fails", "failing", "issue", "problem"],
];
const SYN = new Map<string, number>();
SYNONYMS.forEach((g, i) => g.forEach((w) => SYN.set(w, i)));

export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w))
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/**
 * Score a document against a query: exact term hits count most, concept
 * (synonym group) hits less, title hits double. Normalised by query length so
 * scores are comparable across queries; 0 means unrelated.
 */
export function score(query: string, title: string, body: string): number {
  const qs = [...new Set(terms(query))];
  if (!qs.length) return 0;
  const t = new Set(terms(title));
  const b = new Set(terms(body));
  const groups = (set: Set<string>) => new Set([...set].map((w) => SYN.get(w)).filter((x): x is number => x !== undefined));
  const tg = groups(t);
  const bg = groups(b);
  let s = 0;
  for (const w of qs) {
    const g = SYN.get(w);
    if (t.has(w)) s += 2;
    else if (b.has(w)) s += 1;
    else if (g !== undefined && tg.has(g)) s += 1;
    else if (g !== undefined && bg.has(g)) s += 0.5;
  }
  return s / qs.length;
}

function ticketText(ws: WsData, t: Ticket) {
  return ws.messages
    .filter((m) => m.ticket_id === t.id && m.kind === "reply")
    .map((m) => m.body_text || stripHtml(m.body_html))
    .join(" ");
}

export function semanticSearch(ws: WsData, query: string): SearchResults {
  const tickets = ws.tickets
    .filter((t) => !ws.deletedTickets.has(t.id) && !t.spam)
    .map((t) => ({ t, s: score(query, t.subject, `${t.last_message_preview} ${ticketText(ws, t)}`) }))
    .filter((x) => x.s >= 0.35)
    .sort((a, b) => b.s - a.s || Date.parse(b.t.last_message_at) - Date.parse(a.t.last_message_at))
    .slice(0, 6)
    .map((x) => x.t);
  const articles = ws.articles
    .map((a) => ({ a, s: score(query, a.title, `${a.excerpt} ${stripHtml(a.body_html)}`) }))
    .filter((x) => x.s >= 0.4)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map((x) => x.a);
  return { tickets, contacts: [], articles };
}

// ─── KB article draft ───────────────────────────────────────────────────────

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 240 && !/^(hi|hello|hey|thanks|thank you|best|cheers|regards)\b/i.test(s));
}

/** Lowercase a leading capital unless it starts an acronym (SAML, PDF). */
function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function titleFor(topic: string, tickets: Ticket[]): string {
  const base = topic.trim() || tickets[0]?.subject || "Common questions";
  const clean = base.replace(/^(re|fwd?):\s*/i, "").replace(/^(when|if|why)\s+/i, "").replace(/[?.!]+$/, "");
  if (/^how\b/i.test(clean)) return clean.charAt(0).toUpperCase() + clean.slice(1);
  if (/(loop|fail|error|broken|missing|lost|doesn'?t|can'?t|won'?t|not)/i.test(clean)) return `Troubleshooting: ${lowerFirst(clean)}`;
  return `How to ${lowerFirst(clean)}`;
}

export function draftArticle(ws: WsData, ticketIds: string[], topic: string): KBArticleDraft {
  const tickets = ticketIds.map((id) => ws.tickets.find((t) => t.id === id || String(t.number) === id)).filter((t): t is Ticket => !!t);
  if (!tickets.length && !topic.trim()) throw invalid("Choose at least one ticket or describe a topic");
  const customer = tickets.flatMap((t) =>
    ws.messages.filter((m) => m.ticket_id === t.id && m.kind === "reply" && m.direction === "inbound").flatMap((m) => sentences(m.body_text || stripHtml(m.body_html))),
  );
  // Agent replies become steps; personal asides ("I've raised your limit") don't generalise.
  const agent = tickets
    .flatMap((t) =>
      ws.messages.filter((m) => m.ticket_id === t.id && m.kind === "reply" && m.direction === "outbound").flatMap((m) => sentences(m.body_text || stripHtml(m.body_html))),
    )
    .filter((x) => !/\b(I|I've|I'll|I'm|we've|we'll)\b/.test(x));
  const title = titleFor(topic, tickets);
  const symptom = customer[0] ?? `Customers ask about ${escapeHtml(topic.trim().toLowerCase() || "this")}.`;
  const steps = (agent.length ? agent : ["Open Settings and find the section this applies to.", "Check the option described above and save.", "Reload the app and try again."]).slice(0, 4);
  const related = ws.articles.filter((a) => a.status === "published" && score(`${title} ${topic}`, a.title, a.excerpt) >= 0.35).slice(0, 2);
  const subject = title.replace(/^(How to|Troubleshooting:)\s*/i, "");
  const excerpt = (title.startsWith("Troubleshooting") ? `What to do when ${subject}, with the steps our team uses.` : `How to ${subject}, step by step.`).slice(0, 180);
  const body = [
    `<h2>What you might see</h2>`,
    `<p>${escapeHtml(symptom)}</p>`,
    customer[1] ? `<blockquote><p>${escapeHtml(customer[1])}</p></blockquote>` : "",
    `<h2>Before you start</h2>`,
    `<ul><li>Make sure you're signed in to the right workspace.</li><li>Have admin access if the fix needs a setting change.</li></ul>`,
    `<h2>Steps</h2>`,
    `<ol>${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`,
    `<h2>Still stuck?</h2>`,
    `<p>Reply to your ticket or start a chat, and include what you tried. Screenshots help.</p>`,
    related.length ? `<h3>Related articles</h3><ul>${related.map((a: KbArticle) => `<li>${escapeHtml(a.title)}</li>`).join("")}</ul>` : "",
  ]
    .filter(Boolean)
    .join("");
  return { title, excerpt, body_html: body };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

function settingsPatch(ctx: Ctx): Partial<AISettings> {
  const b = ctx.body;
  const out: Partial<AISettings> = {};
  for (const k of ["enabled", "auto_triage", "auto_summarize", "widget_answers"] as const) {
    if (k in b) {
      if (typeof b[k] !== "boolean") throw invalid(`${k} must be true or false`);
      out[k] = b[k];
    }
  }
  if ("tone" in b) {
    if (typeof b.tone !== "string") throw invalid("tone must be text");
    if (b.tone.length > 200) throw invalid("Keep the tone under 200 characters");
    out.tone = b.tone.trim() || "friendly";
  }
  if ("reply_language" in b) {
    if (b.reply_language !== "customer" && b.reply_language !== "workspace") throw invalid("reply_language must be customer or workspace");
    out.reply_language = b.reply_language;
  }
  if ("instructions" in b) {
    if (typeof b.instructions !== "string") throw invalid("instructions must be text");
    if (b.instructions.length > 2000) throw invalid("Keep the instructions under 2,000 characters");
    out.instructions = b.instructions;
  }
  return out;
}

export function registerAi() {
  get("/v1/ai/config", (ctx) => config(ctx.ws));

  patch("/v1/ai/settings", (ctx) => {
    if (aiOff()) throw new HttpError(404, "ai_disabled", "AI isn't set up on this instance.");
    const r = role(ctx.ws);
    if (r !== "owner" && r !== "admin") throw forbidden("Only admins can change AI settings");
    if (!isRecord(ctx.body)) throw invalid("Body must be an object");
    ctx.ws.ai = { ...ctx.ws.ai, ...settingsPatch(ctx) };
    ctx.ws.workspace.settings = { ...ctx.ws.workspace.settings, ai: ctx.ws.ai };
    publish(ctx.ws, "workspace.updated", { workspace: ctx.ws.workspace, changes: ["settings"] });
    return ctx.ws.ai;
  });

  get("/v1/ai/search", (ctx) => {
    if (aiOff()) throw new HttpError(404, "ai_disabled", "AI isn't set up on this instance.");
    const q = (ctx.query.get("q") ?? "").trim();
    if (!q) return { tickets: [], contacts: [], articles: [] };
    return semanticSearch(ctx.ws, q);
  });

  post("/v1/kb/articles/ai/draft", async (ctx) => {
    assertAi(ctx.ws);
    if (role(ctx.ws) === "viewer") throw forbidden("Viewers can't draft articles");
    reserve(ctx.ws, "kb_draft");
    const draft = draftArticle(ctx.ws, strArr(ctx.body.ticket_ids) ?? [], typeof ctx.body.topic === "string" ? ctx.body.topic.slice(0, 200) : "");
    await new Promise((r) => setTimeout(r, 900));
    spend(ctx.ws, "kb_draft");
    return draft;
  });
}
