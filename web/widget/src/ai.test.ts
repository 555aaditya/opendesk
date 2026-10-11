import { describe, expect, it } from "vitest";
import { handedOff, handoffTarget, isAiAnswer, sourcesOf } from "./ai";
import type { Message } from "./types";

const author = (type: Message["author"]["type"]): Message["author"] => ({ type, user: type === "user" ? { id: "u", name: "Priya", avatar_url: "" } : null, contact: null });
const m = (id: string, type: Message["author"]["type"], dir: Message["direction"], custom?: Message["custom"]) => ({ id, author: author(type), direction: dir, custom });

describe("AI answers", () => {
  it("detects system messages marked custom.ai", () => {
    expect(isAiAnswer(m("1", "system", "outbound", { ai: true }))).toBe(true);
    expect(isAiAnswer(m("1", "system", "outbound"))).toBe(false);
    expect(isAiAnswer(m("1", "user", "outbound", { ai: true }))).toBe(false);
  });

  it("keeps only safe, unique source links", () => {
    const s = sourcesOf({
      custom: {
        sources: [
          { title: "SAML", url: "https://help.example.com/a" },
          { title: "dup", url: "https://help.example.com/a" },
          { title: "bad", url: "javascript:alert(1)" },
          { title: "", url: "https://help.example.com/b" },
          { title: "rel", url: "/relative" },
        ],
      },
    });
    expect(s).toEqual([
      { title: "SAML", url: "https://help.example.com/a" },
      { title: "help.example.com", url: "https://help.example.com/b" },
    ]);
    expect(sourcesOf({})).toEqual([]);
  });

  it("offers a person on the latest AI answer until a teammate replies", () => {
    const ai = m("ai", "system", "outbound", { ai: true });
    expect(handoffTarget([m("q", "contact", "inbound"), ai])).toEqual({ id: "ai", answered: false });
    expect(handoffTarget([m("q", "contact", "inbound"), ai, m("q2", "contact", "inbound")])).toEqual({ id: "ai", answered: false });
    expect(handoffTarget([ai, m("h", "user", "outbound")])).toEqual({ id: "ai", answered: true });
    expect(handoffTarget([m("q", "contact", "inbound")])).toBeNull();
    expect(handedOff({ custom: { ai_handoff: true } })).toBe(true);
    expect(handedOff(undefined)).toBe(false);
  });
});
