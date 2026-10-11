import { describe, expect, it } from "vitest";
import { diffStats, diffWords, tokenize } from "./diff";

describe("diffWords", () => {
  it("keeps unchanged text and marks edits", () => {
    const parts = diffWords("Thanks for the note. We fixed it.", "Thanks so much for the note. We fixed it.");
    expect(parts.map((p) => p.kind)).toEqual(["same", "add", "same"]);
    expect(parts.map((p) => p.text).join("")).toBe("Thanks so much for the note. We fixed it.");
  });

  it("reconstructs both sides losslessly", () => {
    const a = "Hello there, this is the old draft";
    const b = "Hi there, this is a new draft";
    const parts = diffWords(a, b);
    expect(parts.filter((p) => p.kind !== "add").map((p) => p.text).join("")).toBe(a);
    expect(parts.filter((p) => p.kind !== "del").map((p) => p.text).join("")).toBe(b);
  });

  it("counts words and similarity", () => {
    const s = diffStats(diffWords("one two three", "one four three"));
    expect(s).toMatchObject({ added: 1, removed: 1, same: 2 });
    expect(s.similarity).toBeCloseTo(2 / 3);
  });

  it("falls back to a block replace for long texts", () => {
    const long = Array.from({ length: 700 }, (_, i) => `w${i}`).join(" ");
    expect(diffWords(long, "short").map((p) => p.kind)).toEqual(["del", "add"]);
  });

  it("tokenizes words with trailing space", () => {
    expect(tokenize("a  b\nc")).toEqual(["a  ", "b\n", "c"]);
  });
});
