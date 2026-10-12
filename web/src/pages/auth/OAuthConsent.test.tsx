import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n";
import { installMock } from "@/mock";
import { db } from "@/mock/db";
import { dispatch } from "@/mock/router";
import { resetAiClients } from "@/mock/handlers/aiClients";
import { api } from "@/lib/api/endpoints";
import type { OAuthRequest } from "@/lib/api/types";
import { useSession } from "@/lib/session";
import { ConsentForm, initialWorkspace, leave, safeRedirect } from "./OAuthConsent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REQ = "6f1c2a4e-8b0d-4c3e-9a51-2d7e0b9f4c11";

async function call(method: string, path: string, body?: unknown) {
  const ws = db.workspaces[0]?.workspace.id;
  const r = await dispatch(`http://mock${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: ws ? { "OD-Workspace": ws } : {} });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}

describe("consent helpers", () => {
  it("only leaves for http(s) URLs and native app schemes", () => {
    expect(safeRedirect("https://claude.ai/api/mcp/auth_callback?code=x&state=y")).toBe(true);
    expect(safeRedirect("http://127.0.0.1:33418/callback?code=x")).toBe(true);
    expect(safeRedirect("javascript:alert(1)")).toBe(false);
    expect(safeRedirect("cursor://anysphere.cursor-retrieval/oauth")).toBe(true);
    expect(safeRedirect("data:text/html,hi")).toBe(false);
    expect(safeRedirect("/relative")).toBe(false);
  });

  it("preselects the current workspace, else the first", () => {
    const req = { workspaces: [{ id: "a", name: "A", role: "agent", scopes: [] }, { id: "b", name: "B", role: "viewer", scopes: [] }] } satisfies Pick<OAuthRequest, "workspaces">;
    expect(initialWorkspace(req, "b")).toBe("b");
    expect(initialWorkspace(req, "zzz")).toBe("a");
    expect(initialWorkspace(req, null)).toBe("a");
    expect(initialWorkspace({ workspaces: [] }, "a")).toBeUndefined();
  });
});

describe("mock OAuth consent and AI clients", () => {
  installMock();
  beforeEach(() => resetAiClients());

  it("serves a request with the scopes each workspace allows", async () => {
    const r = await call("GET", `/v1/oauth/requests/${REQ}`);
    expect(r.status).toBe(200);
    expect(r.body.client.name).toBe("Claude");
    expect(r.body.scopes).toContain("tickets:write");
    expect(r.body.workspaces.length).toBeGreaterThan(0);
    expect(r.body.workspaces[0].scopes).toContain("tickets:read");
    expect((await call("GET", "/v1/oauth/requests/not-an-id")).status).toBe(404);
  });

  it("approves once, lists the connection, then answers 410", async () => {
    const before = (await call("GET", "/v1/ai-clients/connections")).body.data.length;
    const wid = db.workspaces[0].workspace.id;
    const ok = await call("POST", `/v1/oauth/requests/${REQ}/approve`, { workspace_id: wid });
    expect(ok.status).toBe(200);
    expect(ok.body.redirect_to).toMatch(/\?code=/);
    const list = (await call("GET", "/v1/ai-clients/connections")).body.data;
    // Approving again for the same client replaces the old connection.
    expect(list.length).toBe(Math.max(before, 1));
    expect(list[0].mine).toBe(true);
    expect(db.workspaces[0].audit[0].action).toBe("oauth.grant_created");
    const again = await call("POST", `/v1/oauth/requests/${REQ}/approve`, { workspace_id: wid });
    expect(again.status).toBe(410);
    expect(again.body.code).toBe("request_expired");
  });

  it("refuses a workspace the user isn't in", async () => {
    const r = await call("POST", `/v1/oauth/requests/${REQ}/approve`, { workspace_id: "00000000-0000-0000-0000-000000000000" });
    expect(r.status).toBe(422);
  });

  it("denies with access_denied", async () => {
    const r = await call("POST", `/v1/oauth/requests/${REQ}/deny`);
    expect(r.body.redirect_to).toMatch(/error=access_denied/);
  });

  it("disconnects a client", async () => {
    const [first] = (await call("GET", "/v1/ai-clients/connections")).body.data;
    expect(first).toBeTruthy();
    expect((await call("DELETE", `/v1/ai-clients/connections/${first.id}`)).status).toBe(204);
    expect((await call("GET", "/v1/ai-clients/connections")).body.data.find((c: { id: string }) => c.id === first.id)).toBeUndefined();
    expect((await call("DELETE", `/v1/ai-clients/connections/${first.id}`)).status).toBe(404);
  });

  it("describes the server and its tools", async () => {
    const r = await call("GET", "/v1/ai-clients/server");
    expect(r.body.url).toMatch(/\/mcp$/);
    expect(r.body.tools.map((t: { name: string }) => t.name)).toContain("reply_to_ticket");
    expect(r.body.scopes).not.toContain("settings:write");
  });

  it("computes the agent setup from the workspace", async () => {
    const ws = db.workspaces[0];
    const prev = { ...ws.ai };
    ws.ai = { ...ws.ai, enabled: false, widget_answers: false };
    let s = (await call("GET", "/v1/ai/agent/setup")).body;
    expect(s.steps.find((x: { id: string }) => x.id === "ai_on").done).toBe(false);
    expect(s.complete).toBe(false);
    ws.ai = { ...ws.ai, enabled: true, widget_answers: true };
    s = (await call("GET", "/v1/ai/agent/setup")).body;
    expect(s.steps.find((x: { id: string }) => x.id === "ai_on").done).toBe(true);
    expect(s.steps.find((x: { id: string }) => x.id === "answers_on").done).toBe(true);
    expect(s.total).toBe(s.steps.filter((x: { optional: boolean }) => !x.optional).length);
    ws.ai = prev;
  });
});

describe("consent form", () => {
  installMock();
  let root: Root;
  let el: HTMLDivElement;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  beforeEach(() => {
    resetAiClients();
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.restoreAllMocks();
  });

  const mount = async (req: OAuthRequest) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <ConsentForm req={req} />
        </QueryClientProvider>,
      );
    });
  };
  const button = (label: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;

  it("shows the client, where it returns to, and what it may do", async () => {
    const req = await api.oauth.request(REQ);
    useSession.setState({ workspaceId: req.workspaces[0].id });
    await mount(req);
    expect(el.textContent).toContain("Connect Claude to opendesk");
    expect(el.textContent).toContain("you go back to claude.ai");
    expect(el.textContent).toContain("Reply to and update tickets");
    expect(button("Approve").disabled).toBe(false);
  });

  it("marks scopes a viewer can't use and blocks approval without any", async () => {
    const req: OAuthRequest = {
      id: REQ,
      client: { name: "Tool", uri: "", redirect_host: "127.0.0.1:4000", local: true },
      scopes: ["tickets:write"],
      workspaces: [{ id: "w1", name: "Acme", role: "viewer", scopes: [] }],
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    await mount(req);
    expect(el.textContent).toContain("Not included");
    expect(el.textContent).toContain("an app on this computer (127.0.0.1:4000)");
    expect(button("Approve").disabled).toBe(true);
  });

  it("approves and leaves for the client's redirect", async () => {
    const to = vi.spyOn(leave, "to").mockImplementation(() => {});
    const req = await api.oauth.request(REQ);
    await mount(req);
    await act(async () => button("Approve").click());
    await vi.waitFor(() => expect(to).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(to.mock.calls[0][0]).toMatch(/\?code=mock_/);
  });

  it("denies and leaves with access_denied", async () => {
    const to = vi.spyOn(leave, "to").mockImplementation(() => {});
    const req = await api.oauth.request(REQ);
    await mount(req);
    await act(async () => button("Deny").click());
    await vi.waitFor(() => expect(to).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(to.mock.calls[0][0]).toMatch(/error=access_denied/);
  });
});
