import { describe, expect, it } from "vitest";
import { actionNeedsValue, aiActions, offered, opsFor, sentimentLabel } from "./automation";

describe("automation AI helpers", () => {
  it("offers AI actions only when AI is on, but keeps one in use", () => {
    const keys = ["add_tag", "ai_triage"] as const;
    expect(offered([...keys], aiActions, false)).toEqual(["add_tag"]);
    expect(offered([...keys], aiActions, true)).toEqual(["add_tag", "ai_triage"]);
    expect(offered([...keys], aiActions, false, "ai_triage")).toEqual(["add_tag", "ai_triage"]);
  });

  it("uses eq for sentiment and needs no value for triage", () => {
    expect(opsFor("sentiment")).toEqual(["eq"]);
    expect(actionNeedsValue("ai_triage")).toBe(false);
    expect(sentimentLabel("frustrated")).toBe("Frustrated");
    expect(sentimentLabel("custom")).toBe("custom");
  });
});
