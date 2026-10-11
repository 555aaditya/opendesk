// The AI answer bot's replies (contracts/ai.md): posted as `author.type =
// "system"` with `custom.ai = true`, citing knowledge base articles, with a way
// to reach a person.

import type { AiSource, Conversation, Message } from "./types";

export function isAiAnswer(m: Pick<Message, "author" | "custom">): boolean {
  return m.author?.type === "system" && m.custom?.ai === true;
}

/** Cited articles with safe http(s) links, deduplicated, at most five. */
export function sourcesOf(m: Pick<Message, "custom">): AiSource[] {
  const raw = m.custom?.sources;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AiSource[] = [];
  for (const s of raw) {
    if (!s || typeof s.url !== "string" || typeof s.title !== "string") continue;
    let url: URL;
    try {
      url = new URL(s.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({ title: s.title.trim() || url.hostname, url: url.href });
    if (out.length === 5) break;
  }
  return out;
}

/**
 * The latest AI answer, and whether a person from the team has replied since.
 * "Talk to a person" is offered on it only until someone does.
 */
export function handoffTarget(msgs: readonly Pick<Message, "id" | "author" | "custom" | "direction">[]): { id: string; answered: boolean } | null {
  let answered = false;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (isAiAnswer(m)) return { id: m.id, answered };
    if (m.direction === "outbound" && m.author?.type === "user") answered = true;
  }
  return null;
}

export function handedOff(c: Pick<Conversation, "custom"> | undefined): boolean {
  return c?.custom?.ai_handoff === true;
}
