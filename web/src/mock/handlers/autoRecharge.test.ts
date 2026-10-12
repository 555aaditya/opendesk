import { afterEach, describe, expect, it, vi } from "vitest";
import type { Billing } from "@/lib/api/types";
import { installMock } from "../index";
import { dispatch } from "../router";
import { db } from "../db";
import { spend } from "../credits";
import { OUT_OF_CREDITS_BELOW, RECHARGE_DELAY, billingOut, saveCard, setRechargeFailure } from "./billing";

async function call(method: string, path: string, body?: unknown) {
  const ws = db.workspaces[0].workspace.id;
  const r = await dispatch(`http://mock${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { "OD-Workspace": ws } });
  return { status: r.status, body: await r.json() };
}

const ws = () => db.workspaces[0];
const billing = async () => (await call("GET", "/v1/billing")).body as Billing;

/** Leaves exactly `left` credits: the allowance used up and `left` purchased credits remaining. */
function leave(left: number) {
  const b = billingOut(ws());
  const c = ws().billing.credits;
  // Purchased credits are what's left of all packs after the overflow past the allowance.
  c.used = Math.round((c.monthly + b.credits.purchased + (c.used > c.monthly ? c.used - c.monthly : 0) - left) * 1000) / 1000;
  expect(billingOut(ws()).credits.remaining).toBeCloseTo(left, 3);
}

describe("mock auto-recharge", () => {
  installMock();
  afterEach(() => {
    vi.useRealTimers();
    setRechargeFailure(null);
  });

  it("starts off with the defaults and validates changes", async () => {
    const b = await billing();
    expect(b.auto_recharge).toMatchObject({ enabled: false, threshold: 200, packs: 1, monthly_limit: 5, recharges_this_month: 0, last_recharge: null, failure: null });
    for (const bad of [{ packs: 0 }, { packs: 21 }, { threshold: 0 }, { monthly_limit: 31 }, { threshold: 2.5 }, { enabled: "yes" }]) {
      expect((await call("PATCH", "/v1/billing/auto-recharge", bad)).status, JSON.stringify(bad)).toBe(422);
    }
  });

  it("needs a saved payment method to turn on", async () => {
    saveCard(ws(), false);
    const r = await call("PATCH", "/v1/billing/auto-recharge", { enabled: true });
    expect([r.status, r.body.code]).toEqual([409, "payment_method_required"]);
    const pm = await call("POST", "/v1/billing/payment-method");
    expect(pm.body.url).toBe("/settings/billing?payment_method=success");
    const on = await call("PATCH", "/v1/billing/auto-recharge", { enabled: true, threshold: 500, packs: 2, monthly_limit: 2 });
    expect(on.status).toBe(200);
    expect(on.body.auto_recharge).toMatchObject({ enabled: true, threshold: 500, packs: 2, monthly_limit: 2, low_at: 500 });
  });

  it("recharges below the threshold, up to the monthly limit, then tells admins when credits run out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    leave(501);
    spend(ws(), "draft_reply");
    spend(ws(), "summarize"); // one recharge in flight, not two
    await vi.advanceTimersByTimeAsync(RECHARGE_DELAY);
    let b = await billing();
    // 501 less two calls (a few credits), plus two packs.
    expect(b.credits.remaining).toBeGreaterThan(4490);
    expect(b.credits.remaining).toBeLessThan(4501);
    expect(b.auto_recharge).toMatchObject({ recharges_this_month: 1, last_recharge: { packs: 2, credits: 4000, amount: 4000, currency: "usd" } });

    leave(501);
    spend(ws(), "draft_reply");
    await vi.advanceTimersByTimeAsync(RECHARGE_DELAY);
    expect((await billing()).auto_recharge?.recharges_this_month).toBe(2);

    // At the limit: no third recharge; crossing below 3 credits notifies once.
    const outBefore = ws().notifications.filter((n) => n.type === "credits_out").length;
    leave(OUT_OF_CREDITS_BELOW + 0.5);
    spend(ws(), "draft_reply");
    spend(ws(), "summarize");
    await vi.advanceTimersByTimeAsync(RECHARGE_DELAY);
    b = await billing();
    expect(b.auto_recharge?.recharges_this_month).toBe(2);
    expect(b.credits.remaining).toBeLessThan(OUT_OF_CREDITS_BELOW);
    expect(ws().notifications.filter((n) => n.type === "credits_out").length).toBe(outBefore + 1);
  });

  it("turns itself off when the payment fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await call("PATCH", "/v1/billing/auto-recharge", { monthly_limit: 10 });
    setRechargeFailure("card_declined");
    leave(100);
    spend(ws(), "summarize");
    await vi.advanceTimersByTimeAsync(RECHARGE_DELAY);
    const b = await billing();
    expect(b.auto_recharge?.enabled).toBe(false);
    expect(b.auto_recharge?.failure?.code).toBe("card_declined");
    expect(ws().notifications[0]).toMatchObject({ type: "auto_recharge_failed", data: { reason: "card_declined" } });
    // Turning it back on clears the failure and, still below the threshold, recharges.
    setRechargeFailure(null);
    const on = await call("PATCH", "/v1/billing/auto-recharge", { enabled: true });
    expect(on.body.auto_recharge.failure).toBeNull();
    await vi.advanceTimersByTimeAsync(RECHARGE_DELAY);
    expect((await billing()).auto_recharge?.recharges_this_month).toBe(3);
  });

  it("with auto-recharge off, notices low once and out once", async () => {
    await call("PATCH", "/v1/billing/auto-recharge", { enabled: false, threshold: 200 });
    const lowAt = (await billing()).auto_recharge!.low_at;
    const count = (t: string) => ws().notifications.filter((n) => n.type === t).length;
    const low0 = count("credits_low");
    const out0 = count("credits_out");
    leave(lowAt + 0.5);
    spend(ws(), "draft_reply");
    spend(ws(), "summarize");
    expect(count("credits_low")).toBe(low0 + 1);
    leave(OUT_OF_CREDITS_BELOW + 0.5);
    spend(ws(), "draft_reply");
    expect(count("credits_out")).toBe(out0 + 1);
    // Once a period: crossing again sends nothing more.
    leave(OUT_OF_CREDITS_BELOW + 0.5);
    spend(ws(), "draft_reply");
    expect(count("credits_out")).toBe(out0 + 1);
    expect(count("credits_low")).toBe(low0 + 1);
  });
});
