import { describe, expect, it } from "vitest";
import type { Billing, BillingUsage } from "@/lib/api/types";
import type { AutoRecharge } from "@/lib/api/types";
import { creditBreakdown, creditsAlert, creditsBanner, daysBetween, formatMoney, limitState, rechargeQuote, stackDays, withPatch, yearlySavings } from "./model";

const price = (unit_amount: number, interval: "month" | "year" | null, currency = "usd") => ({ id: "p", unit_amount, currency, interval });

describe("money", () => {
  it("formats minor units and drops whole decimals", () => {
    expect(formatMoney(1900, "usd")).toBe("$19");
    expect(formatMoney(1950, "usd")).toBe("$19.50");
    expect(formatMoney(2000, "jpy")).toBe("¥2,000");
    expect(formatMoney(19000, "eur", "de")).toMatch(/190\s?€/);
  });

  it("computes yearly savings", () => {
    expect(yearlySavings(price(1900, "month"), price(19000, "year"))).toBe(17);
    expect(yearlySavings(price(1900, "month"), price(22800, "year"))).toBeNull();
    expect(yearlySavings(price(1900, "month"), null)).toBeNull();
    expect(yearlySavings(price(1900, "month"), price(19000, "year", "eur"))).toBeNull();
  });
});

const billing = (over: Partial<Billing> = {}): Billing => ({
  plan: "free",
  billing_enabled: true,
  status: "none",
  interval: "month",
  seats: 0,
  billed_seats: 1,
  current_period_end: null,
  cancel_at_period_end: false,
  limits: { max_mailboxes: 1, max_members: 1 },
  usage: { mailboxes: 1, members: 2 },
  credits: { unlimited: false, monthly: 50, used: 38, purchased: 0, remaining: 12, period_end: "2026-11-01T00:00:00Z" },
  prices: { pro_month: null, pro_year: null, credit_pack: null },
  ...over,
});

describe("limits", () => {
  it("reports at and over the cap", () => {
    expect(limitState(billing(), "mailboxes")).toMatchObject({ limited: true, atLimit: true, over: false });
    expect(limitState(billing(), "members")).toMatchObject({ limited: true, atLimit: true, over: true });
  });
  it("treats 0 as unlimited", () => {
    expect(limitState(billing({ limits: { max_mailboxes: 0, max_members: 0 } }), "members")).toMatchObject({ limited: false, atLimit: false });
    expect(limitState(undefined, "members").limited).toBe(false);
  });
});

describe("credits", () => {
  it("splits the allowance from purchased credits", () => {
    const c = creditBreakdown({ unlimited: false, monthly: 1000, used: 1200, purchased: 1800, remaining: 1800, period_end: "" });
    expect(c).toMatchObject({ monthlyUsed: 1000, monthlyLeft: 0, ratio: 1, purchased: 1800, low: false });
    expect(creditBreakdown(billing().credits).low).toBe(false);
    expect(creditBreakdown({ ...billing().credits, remaining: 4 }).low).toBe(true);
  });
});

describe("usage series", () => {
  it("fills days and stacks the top features plus other", () => {
    const u: BillingUsage = {
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-04T00:00:00Z",
      total_credits: 20,
      total_calls: 9,
      by_feature: [
        { feature: "draft_reply", credits: 9, calls: 3 },
        { feature: "summarize", credits: 5, calls: 5 },
        { feature: "copilot", credits: 4, calls: 2 },
        { feature: "rewrite", credits: 2, calls: 2 },
      ],
      by_day: [
        { date: "2026-10-01", credits: 12, calls: 5, by_feature: { draft_reply: 6, summarize: 3, copilot: 2, rewrite: 1 } },
        { date: "2026-10-03", credits: 8, calls: 4, by_feature: { draft_reply: 3, summarize: 2, copilot: 2, rewrite: 1 } },
      ],
      by_member: [],
    };
    const { series, days } = stackDays(u, { from: "2026-10-01", to: "2026-10-03" });
    expect(series).toEqual(["draft_reply", "summarize", "copilot", "other"]);
    expect(days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(days[0].stacks.map((s) => s.credits)).toEqual([6, 3, 2, 1]);
    expect(days[1].total).toBe(0);
  });

  it("lists every day inclusive", () => {
    expect(daysBetween("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
});

const ar = (over: Partial<AutoRecharge> = {}): AutoRecharge => ({
  enabled: false,
  threshold: 200,
  packs: 1,
  monthly_limit: 5,
  recharges_this_month: 0,
  low_at: 10,
  last_recharge: null,
  failure: null,
  ...over,
});
const pack = { id: "price_credits", unit_amount: 2000, currency: "usd", interval: null, credits: 2000 };

describe("running low", () => {
  const credits = (remaining: number) => ({ ...billing().credits, remaining });

  it("reads out below 3 credits and low below low_at", () => {
    expect(creditsAlert(billing({ credits: credits(2.9), auto_recharge: ar() }))).toBe("out");
    expect(creditsAlert(billing({ credits: credits(9), auto_recharge: ar() }))).toBe("low");
    expect(creditsAlert(billing({ credits: credits(10), auto_recharge: ar() }))).toBeNull();
    // Older servers without auto_recharge: a tenth of the allowance, at least 5.
    expect(creditsAlert(billing({ credits: credits(5) }))).toBe("low");
    expect(creditsAlert(billing({ credits: { ...credits(0), unlimited: true } }))).toBeNull();
    expect(creditsAlert(billing({ billing_enabled: false, credits: credits(0) }))).toBeNull();
    expect(creditBreakdown(credits(150), 200).low).toBe(true);
  });

  it("stays quiet while auto-recharge will refill", () => {
    const low = { credits: credits(150) };
    expect(creditsBanner(billing({ ...low, auto_recharge: ar({ enabled: true, low_at: 200 }) }))).toBeNull();
    expect(creditsBanner(billing({ ...low, auto_recharge: ar({ enabled: true, low_at: 200, recharges_this_month: 5 }) }))).toBe("low");
    expect(creditsBanner(billing({ credits: credits(1), auto_recharge: ar({ failure: { code: "card_declined", at: "" } }) }))).toBe("out");
  });
});

describe("auto-recharge", () => {
  it("quotes packs × the pack price", () => {
    expect(rechargeQuote(pack, 3)).toEqual({ credits: 6000, price: "$60", amount: 6000 });
    expect(rechargeQuote(null, 2)).toEqual({ credits: 4000, price: null, amount: null });
  });

  it("applies a pending patch the way the server will", () => {
    const failed = ar({ failure: { code: "card_declined", at: "2026-10-01T00:00:00Z" } });
    expect(withPatch(failed, { enabled: true })).toMatchObject({ enabled: true, failure: null, low_at: 200 });
    expect(withPatch(ar({ enabled: true, low_at: 200 }), { threshold: 400 }).low_at).toBe(400);
    expect(withPatch(ar(), { threshold: 400 }).low_at).toBe(10);
  });
});
