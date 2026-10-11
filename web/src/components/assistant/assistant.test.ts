import { describe, expect, it } from "vitest";
import { installMock } from "@/mock/index";
import { dispatch, parseSse } from "./testing";
import { contextFor } from "./context";
import { parseBlocks } from "./Markdown";
import { pickTip } from "./JevTip";
import { toEntries } from "./store";
import { db } from "@/mock/db";

describe("Jev helpers", () => {
  it("reads the page into context", () => {
    expect(contextFor("/inbox/mine/0190a3b2-1111-7000-8000-000000000001")).toMatchObject({ page: "ticket", folder: "mine", ticket_id: "0190a3b2-1111-7000-8000-000000000001" });
    expect(contextFor("/views/0190a3b2-1111-7000-8000-000000000002", "?priority=high")).toMatchObject({ page: "view", filters: { priority: "high" } });
    expect(contextFor("/reports").page).toBe("reports");
  });

  it("parses light markdown into blocks", () => {
    const nodes = parseBlocks("Hi **there**\n\n- one\n- two\n\n1. first");
    expect(nodes.map((n) => n.kind)).toEqual(["p", "ul", "ol"]);
  });

  it("rate limits tips", () => {
    const tips = [{ key: "a", text: "", prompt: "", severity: "high" as const, count: 1 }];
    const now = Date.now();
    expect(pickTip(tips, {}, now)?.key).toBe("a");
    expect(pickTip(tips, { last: now - 60_000 }, now)).toBeNull();
    expect(pickTip(tips, { paused: now + 1000 }, now)).toBeNull();
    expect(pickTip(tips, { seen: { a: now - 3_600_000 } }, now)).toBeNull();
    expect(pickTip(tips, { seen: { a: now - 2 * 86_400_000 } }, now)?.key).toBe("a");
  });

  it("merges assistant items into one entry", () => {
    const e = toEntries({
      session: { id: "s", title: "", created_at: "", updated_at: "" },
      approval: null,
      items: [
        { role: "user", text: "Hi", steps: [] },
        { role: "assistant", text: "", steps: [{ id: "c", tool: "search_tickets", label: "Searched", status: "done" }] },
        { role: "assistant", text: "Found it", steps: [] },
      ],
    });
    expect(e).toHaveLength(2);
    expect(e[1].blocks.map((b) => b.kind)).toEqual(["step", "text"]);
  });
});

describe("mock Jev", () => {
  installMock();

  it("proposes a change and applies it only on approval, as Jev", async () => {
    const ws = db.workspaces[0];
    const s = await dispatch("POST", "/v1/assistant/sessions", {});
    const sid = ((await s.json()) as { id: string }).id;
    const ticket = ws.tickets.find((t) => !t.assignee && t.status === "open")!;
    const r = await dispatch("POST", `/v1/assistant/sessions/${sid}/messages`, { text: "Who should take this?", context: { page: "ticket", ticket_id: ticket.id } });
    const evs = await parseSse(r);
    const ap = evs.find((e) => e.event === "approval")?.data as { action_id: string; token: string };
    expect(ap).toBeTruthy();
    expect(evs.at(-1)).toMatchObject({ event: "done", data: { status: "awaiting_approval" } });
    expect(ticket.assignee).toBeNull();

    const bad = await dispatch("POST", `/v1/assistant/actions/${ap.action_id}/decision`, { decision: "approve", token: "nope" });
    expect(bad.status).toBe(403);

    const before = ws.activities.length;
    const ok = await parseSse(await dispatch("POST", `/v1/assistant/actions/${ap.action_id}/decision`, { decision: "approve", token: ap.token }));
    expect(ok.at(-1)).toMatchObject({ event: "done", data: { status: "complete" } });
    expect(ticket.assignee).not.toBeNull();
    const added = ws.activities.slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((a) => a.actor.type === "ai")).toBe(true);

    // Single use.
    const again = await dispatch("POST", `/v1/assistant/actions/${ap.action_id}/decision`, { decision: "approve", token: ap.token });
    expect(again.status).toBe(403);
  });
});
