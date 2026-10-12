import { describe, expect, it } from "vitest";
import { hostVars, pageUrl, resolveConfig } from "./config";
import { splitSources } from "./html";
import { actionStatus } from "./ai";

describe("widget config", () => {
  it("fills in defaults for an older server", () => {
    const c = resolveConfig({ workspace_name: "Acme", brand_color: null, greeting: "", help_center_url: null, require_email: false });
    expect(c).toMatchObject({
      theme: "auto",
      position: "right",
      offset_x: 20,
      offset_y: 20,
      launcher: "icon",
      launcher_label: "",
      radius: "soft",
      title: "",
      subtitle: "",
      suggestions: [],
      sound: false,
      team: [],
      ai_answers: false,
      bot: { name: "Ollie", avatar_url: null },
    });
  });

  it("keeps values in range and drops invalid ones", () => {
    const c = resolveConfig({
      workspace_name: "Acme",
      brand_color: "nope",
      greeting: "",
      help_center_url: "javascript:alert(1)",
      require_email: false,
      theme: "neon" as never,
      position: "left",
      offset_x: 999,
      offset_y: -4,
      radius: "round",
      suggestions: ["a", "Where is my order?", "  Reset password  ", "Billing", "Plans", "Extra"],
      team: [{ name: "Priya", avatar_url: "ftp://x" }, { name: "Tom", avatar_url: null }, { name: "Mei", avatar_url: null }, { name: "Ana", avatar_url: null }],
      bot: { name: "", avatar_url: "https://cdn.test/bot.png" },
    });
    expect(c.brand_color).toBeNull();
    expect(c.help_center_url).toBeNull();
    expect(c.theme).toBe("auto");
    expect(c.position).toBe("left");
    expect([c.offset_x, c.offset_y]).toEqual([200, 0]);
    expect(c.suggestions).toEqual(["Where is my order?", "Reset password", "Billing", "Plans"]);
    expect(c.team).toHaveLength(3);
    expect(c.team?.[0].avatar_url).toBeNull();
    expect(c.bot).toEqual({ name: "Ollie", avatar_url: "https://cdn.test/bot.png" });
  });

  it("maps appearance onto host CSS variables", () => {
    const v = hostVars(resolveConfig({ workspace_name: "A", brand_color: "#ffd43b", greeting: "", help_center_url: null, require_email: false, radius: "round", offset_x: 32 }));
    expect(v["--brand"]).toBe("#ffd43b");
    expect(v["--brand-fg"]).toBe("#0a0a0a");
    expect(v["--r-launcher"]).toBe("999px");
    expect(v["--ox"]).toBe("32px");
    expect(hostVars(resolveConfig(null))["--brand"]).toBeUndefined();
  });

  it("reports the page URL over https only, without fragment, capped at 500", () => {
    expect(pageUrl("https://shop.test/cart?x=1#token=abc")).toBe("https://shop.test/cart?x=1");
    expect(pageUrl("http://shop.test/cart")).toBeUndefined();
    expect(pageUrl("https://user:pw@shop.test/")).toBe("https://shop.test/");
    const long = pageUrl(`https://shop.test/p?q=${"x".repeat(600)}`);
    expect(long).toBe("https://shop.test/p");
    expect(pageUrl(`https://shop.test/${"y".repeat(600)}`)!.length).toBe(500);
  });
});

describe("agent reply parts", () => {
  it("splits trailing source links into chips", () => {
    const r = splitSources('<p>Answer.</p><ul><li><a href="https://h.test/a">Guide A</a></li><li><a href="https://h.test/b">Guide B</a></li></ul>');
    expect(r.html).toBe("<p>Answer.</p>");
    expect(r.sources).toEqual([
      { href: "https://h.test/a", title: "Guide A" },
      { href: "https://h.test/b", title: "Guide B" },
    ]);
    // A list that is part of the answer stays.
    const keep = "<p>Steps:</p><ul><li>Open settings</li></ul>";
    expect(splitSources(keep)).toEqual({ html: keep, sources: [] });
  });

  it("shows the action's server status, else the decision in flight", () => {
    expect(actionStatus({ status: "pending" }, undefined)).toBe("pending");
    expect(actionStatus({ status: "pending" }, { busy: "confirm" })).toBe("pending");
    expect(actionStatus({ status: "pending" }, { status: "confirmed" })).toBe("confirmed");
    expect(actionStatus({ status: "failed" }, { status: "confirmed" })).toBe("failed");
    expect(actionStatus({ status: "expired" }, undefined)).toBe("expired");
  });
});
