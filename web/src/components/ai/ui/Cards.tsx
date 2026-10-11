// Adapted from Beautiful UI "Insight Cards" (https://www.beautifului.dev/#insight-cards)
// and "Context Cards" (#context-cards). MIT, Copyright (c) 2026 Shane Levine.
// See web/THIRD_PARTY_NOTICES.md. Kept to the card shell, the pager-style
// header and the retrieved-chunk list; charts are not used here.

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AI_TONE, tone } from "@/lib/tones";
import { AiIcon } from "../bits";

const EASE = [0.23, 1, 0.32, 1] as const;

/** The card every AI result sits in: a hairline, a white surface, a soft lift. */
export function AiCard({ children, className, label, busy }: { children: ReactNode; className?: string; label?: string; busy?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      aria-label={label}
      aria-busy={busy || undefined}
      className={cn("overflow-hidden rounded-lg border border-line bg-surface shadow-xs", className)}
    >
      {children}
    </motion.section>
  );
}

/** Card header: violet sparkle, an eyebrow title, optional count and actions. */
export function AiCardHeader({ title, count, children, className }: { title: ReactNode; count?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-9 items-center gap-2 px-3", className)}>
      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-xs", tone[AI_TONE].soft)}>
        <AiIcon className={cn("size-2.5", tone[AI_TONE].text)} />
      </span>
      <h3 className="text-[12.5px] font-medium text-fg">{title}</h3>
      {count !== undefined && <span className="mono text-[11px] tabular-nums text-fg-4">{count}</span>}
      <span className="ml-auto flex items-center gap-0.5">{children}</span>
    </div>
  );
}

/** Footer strip on a sunken fill, for meta and actions. */
export function AiCardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-h-10 items-center gap-2 border-t border-line-soft bg-sunken px-3 py-1.5", className)}>{children}</div>;
}

/** Retrieved points as a numbered list of small chunks that enter once. */
export function ContextList({ items, className }: { items: ReactNode[]; className?: string }) {
  const reduce = useReducedMotion();
  if (!items.length) return null;
  return (
    <ol className={cn("flex flex-col", className)}>
      {items.map((item, i) => (
        <motion.li
          key={i}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: EASE, delay: reduce ? 0 : 0.04 + i * 0.05 }}
          className="flex gap-2.5 border-t border-line-soft py-2 first:border-t-0"
        >
          <span className="mono mt-px flex h-4 min-w-4 shrink-0 items-center justify-center rounded-xs bg-sunken px-0.5 text-[10px] tabular-nums text-fg-3 ring-1 ring-inset ring-line-soft">
            {i + 1}
          </span>
          <span className="min-w-0 text-[12px] leading-[18px] text-fg-2">{item}</span>
        </motion.li>
      ))}
    </ol>
  );
}
