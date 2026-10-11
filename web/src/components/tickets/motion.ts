// Shared motion for ticket lists and the ticket view: short, springy, subtle.
// Rows slide in when a ticket arrives live, collapse away when one leaves the
// list (solved, assigned elsewhere) and glide when the order changes.

import type { Transition } from "motion/react";

export const spring: Transition = { type: "spring", stiffness: 500, damping: 40, mass: 0.8 };
const ease = [0.16, 1, 0.3, 1] as const;

/** Props for a list row, by whether motion is reduced. */
export function rowMotion(reduced: boolean | null) {
  if (reduced)
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.12 },
    } as const;
  return {
    layout: "position" as const,
    initial: { opacity: 0, height: 0, y: -6 },
    animate: { opacity: 1, height: "auto", y: 0 },
    exit: { opacity: 0, height: 0, transition: { duration: 0.18, ease } },
    transition: { layout: spring, height: { duration: 0.2, ease }, opacity: { duration: 0.18 }, y: spring },
  } as const;
}

// Opening a ticket to reply from the list or the preview: the ticket view
// focuses its composer once it mounts.
let replyIntent: string | null = null;
export const intent = {
  reply(ticketId: string) {
    replyIntent = ticketId;
  },
  take(ticketId: string, number?: number) {
    if (!replyIntent || (replyIntent !== ticketId && replyIntent !== String(number))) return false;
    replyIntent = null;
    return true;
  },
};
