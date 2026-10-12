import { describe, expect, it } from "vitest";
import { aggregateUsage } from "./billing";
import { meter, modelFactor } from "../credits";

const sonnet = "anthropic/claude-sonnet-5.5";
const haiku = "anthropic/claude-haiku-5.5";
const rows = [
  { feature: "draft_reply" as const, user_id: "u1", credits: 3.1, model: sonnet, input_tokens: 4478, output_tokens: 482, at: "2026-10-01T09:00:00Z" },
  { feature: "summarize" as const, user_id: "u2", credits: 0.2, model: haiku, input_tokens: 867, output_tokens: 93, at: "2026-10-01T10:00:00Z" },
  { feature: "answer" as const, user_id: null, credits: 2.7, model: sonnet, input_tokens: 3900, output_tokens: 420, at: "2026-10-03T23:59:00Z" },
  { feature: "answer_check" as const, user_id: null, credits: 0.005, model: "jev", input_tokens: 333, output_tokens: 0, at: "2026-10-03T23:59:30Z" },
  { feature: "summarize" as const, user_id: "u1", credits: 1, model: haiku, input_tokens: 10, output_tokens: 10, at: "2026-09-30T23:59:00Z" },
];
const ref = (id: string | null) => (id ? { id, name: id.toUpperCase(), email: `${id}@x.io`, avatar_url: "" } : null);

describe("aggregateUsage", () => {
  it("groups the range by day, feature, member and model, in decimals without float noise", () => {
    const u = aggregateUsage(rows, "2026-10-01", "2026-10-03", ref);
    expect([u.total_credits, u.total_calls]).toEqual([6.005, 4]);
    expect([u.from, u.to]).toEqual(["2026-10-01T00:00:00.000Z", "2026-10-04T00:00:00.000Z"]);
    // Days without usage are left out, as the server does.
    expect(u.by_day.map((d) => [d.date, d.credits])).toEqual([
      ["2026-10-01", 3.3],
      ["2026-10-03", 2.705],
    ]);
    expect(u.by_day[0].by_feature).toEqual({ draft_reply: 3.1, summarize: 0.2 });
    expect(u.by_feature[0]).toEqual({ feature: "draft_reply", credits: 3.1, calls: 1 });
    expect(u.by_member.map((m) => [m.user?.id ?? null, m.credits])).toEqual([
      ["u1", 3.1],
      [null, 2.705],
      ["u2", 0.2],
    ]);
    expect(u.by_model).toEqual([
      { model: sonnet, credits: 5.8, calls: 2, input_tokens: 8378, output_tokens: 902 },
      { model: haiku, credits: 0.2, calls: 1, input_tokens: 867, output_tokens: 93 },
      { model: "jev", credits: 0.005, calls: 1, input_tokens: 333, output_tokens: 0 },
    ]);
  });
});

describe("metering", () => {
  it("charges typical × model × length, rounded up to 0.001", () => {
    const mid = () => 0.5; // length factor 1.125
    expect(meter("draft_reply", sonnet, mid).credits).toBe(3.375);
    expect(meter("draft_reply", haiku, mid).credits).toBe(1.013);
    expect(meter("triage", "jev", mid)).toMatchObject({ credits: 0.057, output_tokens: 0 });
    expect(modelFactor("anthropic/claude-opus-5.5")).toBe(3.2);
    const r = meter("answer", sonnet);
    expect(r.credits).toBeGreaterThanOrEqual(1.05);
    expect(r.credits).toBeLessThanOrEqual(5.7);
    expect(r.input_tokens).toBeGreaterThan(r.output_tokens);
  });
});
