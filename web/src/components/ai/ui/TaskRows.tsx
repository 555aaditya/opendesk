// Adapted from Beautiful UI "Task Rows" (https://www.beautifului.dev/#task-rows).
// MIT, Copyright (c) 2026 Shane Levine. See web/THIRD_PARTY_NOTICES.md.
// A list of steps with live status: a ring while running, a check when done,
// a red mark when it failed. Driven by the caller, not by a timeline.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AI_TONE, tone } from "@/lib/tones";

export type TaskStatus = "pending" | "running" | "done" | "failed";
export type TaskRow = { key: string; label: ReactNode; meta?: ReactNode; status: TaskStatus };

function Ring({ active }: { active: boolean }) {
  const size = 16;
  const r = 6.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={cn(active && "animate-spin")} style={active ? { animationDuration: "1.1s" } : undefined} aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
      {active && <circle cx="8" cy="8" r={r} fill="none" stroke="var(--tone-violet-solid)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray={`${c * 0.28} ${c * 0.72}`} />}
    </svg>
  );
}

function Mark({ status }: { status: TaskStatus }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={status === "running" || status === "pending" ? "ring" : status}
          initial={reduce ? false : { opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className="flex"
        >
          {status === "done" ? (
            <span className={cn("flex size-4 items-center justify-center rounded-xs text-white", tone.green.solid)}>
              <Check className="size-2.5" strokeWidth={3.5} />
            </span>
          ) : status === "failed" ? (
            <span className={cn("flex size-4 items-center justify-center rounded-xs text-white", tone.red.solid)}>
              <X className="size-2.5" strokeWidth={3.5} />
            </span>
          ) : (
            <Ring active={status === "running"} />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function TaskRows({ rows, labels, className }: { rows: TaskRow[]; labels: Record<TaskStatus, string>; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <ol className={cn("flex flex-col overflow-hidden rounded-lg border border-line bg-surface", className)} aria-live="polite">
      {rows.map((r, i) => (
        <motion.li
          key={r.key}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1], delay: reduce ? 0 : i * 0.06 }}
          className="flex h-10 items-center gap-2.5 border-t border-line-soft px-3 first:border-t-0"
        >
          <Mark status={r.status} />
          <span className={cn("min-w-0 flex-1 truncate text-[12.5px] transition-colors", r.status === "pending" ? "text-fg-3" : "text-fg")}>{r.label}</span>
          {r.meta && <span className="mono shrink-0 text-[11px] tabular-nums text-fg-4">{r.meta}</span>}
          <span
            className={cn(
              "inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[11px] font-medium",
              r.status === "done" ? tone.green.chip : r.status === "failed" ? tone.red.chip : r.status === "running" ? tone[AI_TONE].chip : "text-fg-4",
            )}
          >
            {labels[r.status]}
          </span>
        </motion.li>
      ))}
    </ol>
  );
}
