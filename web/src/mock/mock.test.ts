import { describe, expect, it } from "vitest";
import { installMock } from "./index";
import { dispatch } from "./router";
import { db } from "./db";
import { socketFactory, teammatePresence } from "./gateway";

async function call(method: string, path: string, body?: unknown) {
  const ws = db.workspaces[0]?.workspace.id;
  const r = await dispatch(`http://mock${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: ws ? { "OD-Workspace": ws } : {},
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}

describe("mock backend", () => {
  installMock();

  it("serves every list endpoint the app reads", async () => {
    for (const path of [
      "/v1/me", "/v1/tickets", "/v1/tickets/counts", "/v1/contacts", "/v1/companies", "/v1/tags", "/v1/views",
      "/v1/sla-policies", "/v1/automations", "/v1/mailboxes", "/v1/members", "/v1/invitations", "/v1/teams",
      "/v1/api-keys", "/v1/webhooks", "/v1/audit-logs", "/v1/notifications", "/v1/kb/collections", "/v1/kb/articles",
      "/v1/saved-replies", "/v1/me/sessions", "/v1/widget/settings", "/v1/workspace", "/v1/search?q=sso",
      "/v1/reports/overview?from=2026-09-12&to=2026-10-11", "/v1/public/help/fieldnote", "/v1/public/csat/demo", "/v1/auth/config",
    ]) {
      expect((await call("GET", path)).status, path).toBe(200);
    }
  });

  it("publishes contiguous events for mutations", async () => {
    const before = db.workspaces[0].seq;
    const t = (await call("GET", "/v1/tickets/%231072")).body;
    await call("PATCH", `/v1/tickets/${t.id}`, { status: "pending", tags: ["sso", "fresh"] });
    const ev = (await call("GET", `/v1/events?since=${before}`)).body;
    expect(ev.resync).toBe(false);
    const seqs = ev.data.map((e: { seq: number }) => e.seq);
    expect(seqs[0]).toBe(before + 1);
    expect(seqs).toEqual(seqs.map((_: number, i: number) => before + 1 + i));
    expect(ev.data.some((e: { type: string }) => e.type === "ticket.updated")).toBe(true);
  });

  it("sends presence_state when a ticket topic is joined", async () => {
    const [tid] = [...teammatePresence.keys()];
    const wid = db.workspaces[0].workspace.id;
    const sock = socketFactory("ws://mock", () => ({ token: "t" }));
    sock.connect();
    await new Promise((r) => setTimeout(r, 150));
    const ch = sock.channel(`ticket:${wid}:${tid}`, { watch: true });
    const got = new Promise((resolve) => ch.on("presence_state", resolve));
    ch.join();
    const state = (await got) as Record<string, unknown>;
    expect(Object.keys(state).length).toBeGreaterThan(0);
  });
});
