import { describe, expect, it } from "vitest";
import { htmlToText, rewriteText, textToParagraphs } from "./aiTicket";

const draft = "Hi Dana,\n\nThanks for confirming. I've added the new certificate and kept the old one active. It works with either until next week.\n\nCould you try the Okta tile again? If it loops, a hard refresh helps.\n\nBest,\nMaya";

describe("mock AI rewrite", () => {
  it("shorter keeps the greeting, the substance and the sign-off", () => {
    const out = rewriteText(draft, "shorter");
    expect(out.startsWith("Hi Dana,")).toBe(true);
    expect(out).toContain("I've added the new certificate");
    expect(out).not.toContain("Thanks for confirming");
    expect(out.endsWith("Best,\nMaya")).toBe(true);
    expect(out.length).toBeLessThan(draft.length);
  });
  it("more formal expands contractions and formalises the frame", () => {
    const out = rewriteText(draft, "more_formal");
    expect(out).toMatch(/^Dear Dana,/);
    expect(out).toContain("I have added");
    expect(out).toContain("Kind regards,");
  });
  it("fixes common typos and missing punctuation", () => {
    expect(rewriteText("i dont think teh export worked", "fix_grammar")).toBe("I don't think the export worked.");
  });
  it("longer adds a paragraph before the sign-off", () => {
    const out = rewriteText(draft, "longer");
    expect(out.split("\n\n").length).toBe(draft.split("\n\n").length + 1);
    expect(out.endsWith("Best,\nMaya")).toBe(true);
  });
});

describe("html round trip", () => {
  it("keeps paragraphs and line breaks", () => {
    const html = "<p>Hi,</p><p>One<br>two</p><ul><li>a</li><li>b</li></ul>";
    expect(htmlToText(html)).toBe("Hi,\n\nOne\ntwo\n\n- a\n- b");
    expect(textToParagraphs("Hi,\n\nOne\ntwo")).toBe("<p>Hi,</p><p>One<br>two</p>");
  });
});
