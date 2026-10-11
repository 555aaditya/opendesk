// Adapted from Beautiful UI "Recommendation Card" (https://www.beautifului.dev/#recommendation-card)
// and "Approval Card" (#approval-card). MIT, Copyright (c) 2026 Shane Levine.
// See web/THIRD_PARTY_NOTICES.md. The signal meter, the confidence label, the
// per-change approval rows and the settled "done" pill, in opendesk tokens.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { tone, type Tone } from "@/lib/tones";
import { Checkbox } from "@/components/ui/checkbox";

export type Signal = 0 | 1 | 2 | 3;

const signalTone: Record<Signal, Tone> = { 0: "gray", 1: "amber", 2: "amber", 3: "green" };

/** Three short bars; filled bars take the tone for the signal. */
export function ConfidenceMeter({ signal, className }: { signal: Signal; className?: string }) {
  const t = signalTone[signal];
  return (
    <span aria-hidden className={cn("flex h-2.5 items-end gap-0.5", className)}>
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className={cn("w-[3px] rounded-xs transition-colors duration-300", bar < signal ? tone[t].solid : "bg-line-strong")}
          style={{ height: 4 + bar * 3 }}
        />
      ))}
    </span>
  );
}

/** Meter plus its label, e.g. "High confidence". */
export function Confidence({ signal, label, hint }: { signal: Signal; label: ReactNode; hint?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ConfidenceMeter signal={signal} />
      <span className="truncate text-[12px] font-medium text-fg-2">{label}</span>
      {hint}
    </span>
  );
}

export type ApprovalRow = { key: string; label: ReactNode; value: ReactNode; checked: boolean; disabled?: boolean };

/** Proposed changes as checkable rows; each row is one change to approve. */
export function ApprovalRows({ rows, onToggle, className }: { rows: ApprovalRow[]; onToggle: (key: string, checked: boolean) => void; className?: string }) {
  return (
    <ul className={cn("flex flex-col", className)}>
      {rows.map((r) => {
        const id = `approve-${r.key}`;
        return (
          <li key={r.key}>
            <label
              htmlFor={id}
              className={cn(
                "-mx-1.5 flex min-h-8 cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-hover",
                r.disabled && "pointer-events-none opacity-50",
              )}
            >
              <Checkbox id={id} checked={r.checked} disabled={r.disabled} onCheckedChange={(v) => onToggle(r.key, v)} className="mt-px" />
              <span className="w-[62px] shrink-0 text-[12px] leading-4 text-fg-3">{r.label}</span>
              <span className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[12px] leading-4 text-fg transition-opacity", !r.checked && "opacity-50")}>{r.value}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** The settled state after approval: a soft green pill with a check. */
export function DonePill({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className={cn("inline-flex h-6 items-center gap-1.5 rounded-sm pl-1 pr-2 text-[12px] font-medium", tone.green.chip)}
    >
      <span className={cn("flex size-4 items-center justify-center rounded-xs text-white", tone.green.solid)}>
        <Check className="size-2.5" strokeWidth={3} />
      </span>
      {children}
    </motion.span>
  );
}

/** Height-animated reveal used for drawers inside AI cards. */
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
