import { describe, expect, it } from "vitest";
import { installMock } from "./index";
import { dispatch } from "./router";
import { db } from "./db";

async function call(method: string, path: string, body?: unknown) {
  const ws = db.workspaces[0]?.workspace.id;
  const r = await dispatch(`http://mock${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: ws ? { "OD-Workspace": ws } : {},
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}

type Named = { name: string; group_id: string | null };

describe("mock labels and custom fields", () => {
  installMock();

  it("seeds coloured labels, an exclusive Type group and fields", async () => {
    const groups = (await call("GET", "/v1/tag-groups")).body.data;
    expect(groups[0]).toMatchObject({ name: "Type", exclusive: true });
    const tags = (await call("GET", "/v1/tags")).body.data;
    expect(tags.find((t: Named) => t.name === "Bug")).toMatchObject({ color: "red", group_id: groups[0].id });
    expect(tags.find((t: Named) => t.name === "Bug").usage.tickets).toBeGreaterThan(0);
    const fields = (await call("GET", "/v1/custom-fields?entity=ticket")).body.data;
    expect(fields.some((f: { key: string; required_on_solve: boolean }) => f.key === "resolution" && f.required_on_solve)).toBe(true);
  });

  it("keeps one label per exclusive group, the last named", async () => {
    const t = (await call("GET", "/v1/tickets/%231072")).body;
    const r = await call("PATCH", `/v1/tickets/${t.id}`, { add_tags: ["Question", "Bug"] });
    const names = r.body.tags.map((x: Named) => x.name);
    expect(names).toContain("Bug");
    expect(names).not.toContain("Question");
  });

  it("refuses solving with an empty required field, then accepts once it's set", async () => {
    const t = (await call("GET", "/v1/tickets/%231072")).body;
    await call("PATCH", `/v1/tickets/${t.id}`, { fields: { resolution: null } });
    const bad = await call("PATCH", `/v1/tickets/${t.id}`, { status: "solved" });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("field_required");
    const ok = await call("PATCH", `/v1/tickets/${t.id}`, { status: "solved", fields: { resolution: "fixed" } });
    expect(ok.status).toBe(200);
    expect(ok.body.fields.resolution).toBe("fixed");
  });

  it("filters and sorts by field values", async () => {
    const list = (await call("GET", "/v1/tickets?field.product_area[any]=sync,export&limit=100")).body.data;
    expect(list.length).toBeGreaterThan(0);
    for (const t of list) expect(["sync", "export"]).toContain(t.fields.product_area);
    const bad = await call("GET", "/v1/tickets?field.app_version[gt]=1");
    expect(bad.status).toBe(422);
    const sorted = (await call("GET", "/v1/tickets?sort=field.affected_users&order=desc&limit=100")).body.data;
    const nums = sorted.map((t: { fields: Record<string, number> }) => t.fields.affected_users).filter((x: number | undefined) => x !== undefined);
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
  });

  it("merges a label into another", async () => {
    const tags = (await call("GET", "/v1/tags")).body.data;
    const sso = tags.find((t: Named) => t.name === "SSO");
    const api = tags.find((t: Named) => t.name === "API");
    const into = await call("POST", `/v1/tags/${sso.id}/merge`, { into: api.id });
    expect(into.status).toBe(200);
    expect(into.body.usage.tickets).toBeGreaterThanOrEqual(api.usage.tickets);
    expect((await call("GET", `/v1/tags/${sso.id}`)).status).toBe(404);
  });

  it("labels contacts and validates field values", async () => {
    const c = (await call("GET", "/v1/contacts?limit=1")).body.data[0];
    const r = await call("PATCH", `/v1/contacts/${c.id}`, { add_tags: ["Churn risk", "Healthy"], fields: { nps: 7 } });
    expect(r.status).toBe(200);
    const names = r.body.tags.map((x: Named) => x.name);
    expect(names).toContain("Healthy");
    expect(names).not.toContain("Churn risk");
    expect((await call("PATCH", `/v1/contacts/${c.id}`, { fields: { nps: "seven" } })).status).toBe(422);
    expect((await call("PATCH", `/v1/contacts/${c.id}`, { fields: { nope: 1 } })).status).toBe(422);
  });
});
