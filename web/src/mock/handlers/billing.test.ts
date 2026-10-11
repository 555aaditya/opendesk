import { describe, expect, it } from "vitest";
import { aggregateUsage } from "./billing";

const rows = [
  { feature: "draft_reply" as const, user_id: "u1", credits: 3, at: "2026-10-01T09:00:00Z" },
  { feature: "summarize" as const, user_id: "u2", credits: 1, at: "2026-10-01T10:00:00Z" },
  { feature: "answer" as const, user_id: null, credits: 3, at: "2026-10-03T23:59:00Z" },
  { feature: "summarize" as const, user_id: "u1", credits: 1, at: "2026-09-30T23:59:00Z" },
];
const ref = (id: string | null) => (id ? { id, name: id.toUpperCase(), email: `${id}@x.io`, avatar_url: "" } : null);

describe("aggregateUsage", () => {
  it("groups the range by day, feature and member", () => {
    const u = aggregateUsage(rows, "2026-10-01", "2026-10-03", ref);
    expect(u.total).toEqual({ credits: 7, calls: 3 });
    expect(u.by_day.map((d) => [d.date, d.credits])).toEqual([
      ["2026-10-01", 4],
      ["2026-10-02", 0],
      ["2026-10-03", 3],
    ]);
    expect(u.by_day[0].by_feature).toEqual({ draft_reply: 3, summarize: 1 });
    expect(u.by_feature[0]).toEqual({ feature: "draft_reply", credits: 3, calls: 1 });
    expect(u.by_member.map((m) => [m.user?.id ?? null, m.credits])).toEqual([
      ["u1", 3],
      [null, 3],
      ["u2", 1],
    ]);
  });
});
