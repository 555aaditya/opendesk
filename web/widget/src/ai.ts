// The AI answer bot's replies (contracts/ai.md): posted as `author.type =
// "system"` with `ai: true`. The cited articles are links at the end of the
// body; the widget offers a way to reach a person under the answer.

import type { Conversation, Message } from "./types";

export function isAiAnswer(m: Pick<Message, "author" | "ai">): boolean {
  return m.author?.type === "system" && m.ai === true;
}

/**
 * The latest AI answer, and whether a person from the team has replied since.
 * "Talk to a person" is offered on it only until someone does.
 */
export function handoffTarget(msgs: readonly Pick<Message, "id" | "author" | "ai" | "direction">[]): { id: string; answered: boolean } | null {
  let answered = false;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (isAiAnswer(m)) return { id: m.id, answered };
    if (m.direction === "outbound" && m.author?.type === "user") answered = true;
  }
  return null;
}

export function handedOff(c: Pick<Conversation, "ai_handoff"> | undefined): boolean {
  return c?.ai_handoff === true;
}
