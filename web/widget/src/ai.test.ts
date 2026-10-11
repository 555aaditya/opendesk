import { describe, expect, it } from "vitest";
import { handedOff, handoffTarget, isAiAnswer } from "./ai";
import type { Message } from "./types";

const author = (type: Message["author"]["type"]): Message["author"] => ({ type, user: type === "user" ? { id: "u", name: "Priya", avatar_url: "" } : null, contact: null });
const m = (id: string, type: Message["author"]["type"], dir: Message["direction"], ai?: boolean) => ({ id, author: author(type), direction: dir, ai });

describe("AI answers", () => {
  it("detects system messages marked ai", () => {
    expect(isAiAnswer(m("1", "system", "outbound", true))).toBe(true);
    expect(isAiAnswer(m("1", "system", "outbound"))).toBe(false);
    expect(isAiAnswer(m("1", "user", "outbound", true))).toBe(false);
  });

  it("offers a person on the latest AI answer until a teammate replies", () => {
    const ai = m("ai", "system", "outbound", true);
    expect(handoffTarget([m("q", "contact", "inbound"), ai])).toEqual({ id: "ai", answered: false });
    expect(handoffTarget([m("q", "contact", "inbound"), ai, m("q2", "contact", "inbound")])).toEqual({ id: "ai", answered: false });
    expect(handoffTarget([ai, m("h", "user", "outbound")])).toEqual({ id: "ai", answered: true });
    expect(handoffTarget([m("q", "contact", "inbound")])).toBeNull();
    expect(handedOff({ ai_handoff: true })).toBe(true);
    expect(handedOff(undefined)).toBe(false);
  });
});
