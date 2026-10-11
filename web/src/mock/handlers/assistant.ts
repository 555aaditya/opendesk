// Mock Jev (contracts/ai.md, Assistant): conversations, a scripted agent that
// streams text and tool steps over SSE, approval cards that change the ticket
// only once approved (attributed to Jev), and tips from simple counts.

import type { AssistantSession, AssistantStep, Approval, Preview, Tip, TranscriptItem } from "@/components/assistant/api";
import type { Ticket, UserRef } from "@/lib/api/types";
import { db, userRef, type WsData } from "../db";
import { reserve, spend } from "../credits";
import { HttpError, del, get, invalid, patch, post, respond, type Ctx } from "../router";
import { applyPatch, findTicket } from "../tickets";
import { nowIso, uuid } from "../util";
import { assertAi } from "./ai";

type Pending = { id: string; callId: string; ticketIds: string[]; patch: Record<string, unknown>; summary: string; token: string; step: AssistantStep };
type Sess = AssistantSession & { wid: string; items: TranscriptItem[]; pending: Pending | null };

const sessions: Sess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mine(ctx: Ctx): Sess[] {
  return sessions.filter((s) => s.wid === ctx.ws.workspace.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function session(ctx: Ctx): Sess {
  const s = mine(ctx).find((x) => x.id === ctx.params.id);
  if (!s) throw new HttpError(404, "not_found", "Conversation not found");
  return s;
}

function out(s: Sess): AssistantSession {
  return { id: s.id, title: s.title, created_at: s.created_at, updated_at: s.updated_at };
}

function check(ws: WsData) {
  assertAi(ws);
  if (ws.ai.assistant === false) throw new HttpError(403, "assistant_off", "The assistant is turned off for this workspace.");
}

function approvalOf(p: Pending, preview: Preview): Approval {
  return { action_id: p.id, call_id: p.callId, tool: p.step.tool, preview, token: p.token, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() };
}

// ─── The scripted agent ────────────────────────────────────────────────────

type Emit = (event: string, data: unknown) => Promise<void>;

function open(ws: WsData): Ticket[] {
  return ws.tickets.filter((t) => !ws.deletedTickets.has(t.id) && !t.spam && (t.status === "open" || t.status === "pending"));
}

function ref(t: Ticket) {
  return { kind: "ticket" as const, id: t.id, label: t.subject, number: t.number };
}

function line(t: Ticket) {
  return `#${t.number} ${t.subject} (${t.priority}${t.assignee ? `, ${t.assignee.name}` : ", unassigned"})`;
}

function teammates(ws: WsData): { user: UserRef; open: number }[] {
  return ws.members
    .filter((m) => m.role !== "viewer")
    .map((m) => userRef(m.user_id))
    .filter((u): u is UserRef => !!u)
    .map((u) => ({ user: u, open: open(ws).filter((t) => t.assignee?.id === u.id).length }))
    .sort((a, b) => a.open - b.open);
}

async function step(emit: Emit, s: AssistantStep, run: () => Partial<AssistantStep>, item: TranscriptItem): Promise<AssistantStep> {
  await emit("tool", s);
  await sleep(550);
  const done = { ...s, status: "done" as const, ...run() };
  await emit("tool", done);
  item.steps.push(done);
  return done;
}

async function say(emit: Emit, item: TranscriptItem, text: string) {
  const words = text.split(/(\s+)/);
  for (let i = 0; i < words.length; i += 4) {
    const part = words.slice(i, i + 4).join("");
    item.text += part;
    await emit("text", { text: part });
    await sleep(28);
  }
}

async function agent(ctx: Ctx, s: Sess, text: string, ticketId: string | undefined, emit: Emit) {
  const ws = ctx.ws;
  const item: TranscriptItem = { role: "assistant", text: "", steps: [] };
  s.items.push(item);
  const lower = text.toLowerCase();
  const id = () => `call_${uuid().slice(0, 8)}`;
  const current = (ticketId && findTicket(ws, ticketId)) || open(ws).find((t) => !t.assignee) || open(ws)[0];

  if (/\b(who should|assign|take this|take it)\b/.test(lower) && current) {
    await step(emit, { id: id(), tool: "get_ticket", label: "Reading the ticket", status: "running" }, () => ({ label: "Read the ticket", summary: `#${current.number}`, refs: [ref(current)] }), item);
    const team = teammates(ws);
    await step(emit, { id: id(), tool: "list_team", label: "Checking the team's workload", status: "running" }, () => ({ label: "Checked the team's workload", summary: `${team.length} teammates` }), item);
    const pick = team[0];
    await say(emit, item, `**${pick.user.name}** has the lightest load right now, with ${pick.open} open tickets. I can assign #${current.number} to them and raise it to high, since the customer is blocked.`);
    const pid = uuid();
    const st: AssistantStep = { id: id(), tool: "update_ticket", label: "Preparing a ticket change", status: "awaiting_approval", action_id: pid };
    await emit("tool", st);
    item.steps.push(st);
    const preview: Preview = {
      title: `Update #${current.number}`,
      summary: current.subject,
      changes: [
        { field: "Assignee", from: current.assignee?.name ?? "Unassigned", to: pick.user.name },
        ...(current.priority === "high" || current.priority === "urgent" ? [] : [{ field: "Priority", from: current.priority, to: "high" }]),
      ],
      targets: [ref(current)],
    };
    s.pending = { id: pid, callId: st.id, ticketIds: [current.id], patch: { assignee_id: pick.user.id, priority: current.priority === "urgent" ? "urgent" : "high" }, summary: `#${current.number} is now with **${pick.user.name}** at high priority.`, token: uuid(), step: st };
    await emit("approval", approvalOf(s.pending, preview));
    return "awaiting_approval";
  }

  if (/\blabel|tag\b/.test(lower)) {
    const hits = open(ws).filter((t) => /bill|invoice|refund|charge|payment|subscription/i.test(t.subject)).slice(0, 8);
    await step(emit, { id: id(), tool: "search_tickets", label: "Searching tickets", status: "running" }, () => ({ label: "Searched tickets", summary: `Found ${hits.length} tickets`, refs: hits.map(ref) }), item);
    if (!hits.length) {
      await say(emit, item, "I couldn't find open billing tickets to label.");
      return "complete";
    }
    await say(emit, item, `${hits.length} open tickets look like billing questions. Here's the change:`);
    const pid = uuid();
    const st: AssistantStep = { id: id(), tool: "bulk_update_tickets", label: "Preparing a bulk change", status: "awaiting_approval", action_id: pid };
    await emit("tool", st);
    item.steps.push(st);
    const preview: Preview = { title: `Label ${hits.length} tickets`, summary: "Billing questions from this week", changes: [{ field: "Labels", from: "", to: "+ Billing" }], targets: hits.map(ref), total: hits.length };
    s.pending = { id: pid, callId: st.id, ticketIds: hits.map((t) => t.id), patch: { add_tags: ["Billing"] }, summary: `Labeled ${hits.length} tickets **Billing**.`, token: uuid(), step: st };
    await emit("approval", approvalOf(s.pending, preview));
    return "awaiting_approval";
  }

  if (/\bsummar/.test(lower) && current) {
    await step(emit, { id: id(), tool: "get_ticket", label: "Reading the ticket", status: "running" }, () => ({ label: "Read the ticket", summary: `#${current.number}, ${current.message_count} messages`, refs: [ref(current)] }), item);
    const who = current.contact?.name ?? "The customer";
    await say(
      emit,
      item,
      `**${who}** wrote in about "${current.subject}".\n\n- It is ${current.status}, ${current.priority} priority, ${current.assignee ? `with ${current.assignee.name}` : "and nobody has it yet"}.\n- Latest: ${current.last_message_preview || "no messages yet"}\n\nNext step: ${current.assignee ? "a reply from the assignee." : "assign it, then reply."}`,
    );
    return "complete";
  }

  if (/\breport|how are we|this week\b/.test(lower)) {
    await step(emit, { id: id(), tool: "get_report", label: "Pulling the numbers", status: "running" }, () => ({ label: "Pulled the numbers", summary: "Last 7 days" }), item);
    const all = open(ws);
    await say(emit, item, `This week: **${all.length} open** tickets, ${all.filter((t) => !t.assignee).length} unassigned and ${all.filter((t) => t.priority === "urgent" || t.priority === "high").length} high or urgent. Median first reply is about 42 minutes, and CSAT is holding at 94%.`);
    return "complete";
  }

  // Triage: urgent first, then old unassigned.
  const urgent = open(ws)
    .filter((t) => t.priority === "urgent" || t.priority === "high" || !t.assignee)
    .slice(0, 5);
  await step(emit, { id: id(), tool: "search_tickets", label: "Searching tickets", status: "running" }, () => ({ label: "Searched tickets", summary: `Found ${urgent.length} tickets`, refs: urgent.map(ref) }), item);
  await say(emit, item, urgent.length ? `These need a look first:\n\n${urgent.map((t) => `- ${line(t)}`).join("\n")}\n\nWant me to find owners for the unassigned ones?` : "Nothing urgent right now. The queue is in good shape.");
  return "complete";
}

function stream(run: (emit: Emit) => Promise<void>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = async (event, data) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await run(emit);
      } catch (e) {
        const err = e instanceof HttpError ? e : new HttpError(500, "server_error", "Internal error in mock assistant");
        await emit("error", { status: err.status, code: err.code, detail: err.detail });
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function tips(ws: WsData): Tip[] {
  const all = open(ws);
  const day = Date.now() - 86_400_000;
  const out: Tip[] = [];
  const urgent = all.filter((t) => t.priority === "urgent" && !t.assignee).length;
  if (urgent) out.push({ key: "urgent_unassigned", text: `${urgent} urgent ${urgent === 1 ? "ticket has" : "tickets have"} no owner yet.`, prompt: "Which urgent tickets have no owner, and who should take each?", severity: "high", count: urgent });
  const old = all.filter((t) => !t.assignee && Date.parse(t.created_at) < day).length;
  if (old) out.push({ key: "unassigned_old", text: `${old} unassigned ${old === 1 ? "ticket is" : "tickets are"} older than a day.`, prompt: "Show the open unassigned tickets older than a day and suggest an assignee for each, based on the team's workload.", severity: "medium", count: old });
  return out;
}

export function registerAssistant() {
  get("/v1/assistant/sessions", (ctx) => {
    check(ctx.ws);
    return { data: mine(ctx).map(out) };
  });
  post("/v1/assistant/sessions", (ctx) => {
    check(ctx.ws);
    const now = nowIso();
    const s: Sess = { id: uuid(), title: typeof ctx.body.title === "string" ? ctx.body.title.slice(0, 120) : "", created_at: now, updated_at: now, wid: ctx.ws.workspace.id, items: [], pending: null };
    sessions.push(s);
    return out(s);
  });
  get("/v1/assistant/sessions/:id", (ctx) => {
    check(ctx.ws);
    const s = session(ctx);
    return { session: out(s), items: s.items, approval: null };
  });
  patch("/v1/assistant/sessions/:id", (ctx) => {
    const s = session(ctx);
    const title = typeof ctx.body.title === "string" ? ctx.body.title.trim().slice(0, 120) : "";
    if (!title) throw invalid("title is required");
    s.title = title;
    return out(s);
  });
  del("/v1/assistant/sessions/:id", (ctx) => {
    const s = session(ctx);
    sessions.splice(sessions.indexOf(s), 1);
    return respond(204);
  });
  get("/v1/assistant/tips", (ctx) => {
    check(ctx.ws);
    return { tips: tips(ctx.ws) };
  });

  post("/v1/assistant/sessions/:id/messages", (ctx) => {
    check(ctx.ws);
    const s = session(ctx);
    const text = typeof ctx.body.text === "string" ? ctx.body.text.trim() : "";
    if (!text) throw invalid("text must be 1 to 8,000 characters");
    reserve(ctx.ws, "assistant");
    const context = (ctx.body.context ?? {}) as { ticket_id?: string };
    // A new message moves on from a change still waiting.
    if (s.pending) {
      s.pending.step.status = "expired";
      s.pending = null;
    }
    s.items.push({ role: "user", text, steps: [] });
    if (!s.title) s.title = text.length > 60 ? `${text.slice(0, 57)}…` : text;
    s.updated_at = nowIso();
    return stream(async (emit) => {
      await emit("session", out(s));
      await sleep(350);
      const status = await agent(ctx, s, text, context.ticket_id, emit);
      spend(ctx.ws, "assistant");
      await emit("done", { status });
    });
  });

  post("/v1/assistant/actions/:id/decision", (ctx) => {
    check(ctx.ws);
    const s = sessions.find((x) => x.pending?.id === ctx.params.id && x.wid === ctx.ws.workspace.id);
    const p = s?.pending;
    if (!s || !p || ctx.body.token !== p.token) throw new HttpError(403, "approval_invalid", "This approval is no longer valid.");
    const approve = ctx.body.decision === "approve";
    s.pending = null;
    const item: TranscriptItem = { role: "assistant", text: "", steps: [] };
    s.items.push(item);
    return stream(async (emit) => {
      if (!approve) {
        p.step.status = "denied";
        await emit("tool", p.step);
        await say(emit, item, "Okay, I left it as it is. What would you like instead?");
        await emit("done", { status: "complete" });
        return;
      }
      p.step.status = "approved";
      await emit("tool", p.step);
      await sleep(450);
      const me = userRef(db.meId);
      for (const tid of p.ticketIds) {
        const t = findTicket(ctx.ws, tid);
        if (!t) continue;
        const before = ctx.ws.activities.length;
        applyPatch(ctx.ws, t, p.patch, me, true, { createLabels: true, lenient: true });
        // Jev made the change on the user's behalf.
        for (const a of ctx.ws.activities.slice(before)) a.actor = { type: "ai", user: me };
      }
      p.step.status = "done";
      p.step.label = p.step.tool === "bulk_update_tickets" ? "Updated the tickets" : "Updated the ticket";
      p.step.summary = p.ticketIds.length === 1 ? "Done" : `${p.ticketIds.length} tickets`;
      await emit("tool", p.step);
      await say(emit, item, `Done. ${p.summary}`);
      spend(ctx.ws, "assistant");
      await emit("done", { status: "complete" });
    });
  });
}
