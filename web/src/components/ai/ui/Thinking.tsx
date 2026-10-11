// Adapted from Beautiful UI "Thinking" (https://www.beautifului.dev/#thinking-state)
// and "Loading State" (#loading-state). MIT, Copyright (c) 2026 Shane Levine.
// See web/THIRD_PARTY_NOTICES.md. Restyled to opendesk tokens, the violet AI
// tone and lucide icons; the trace is driven by real progress, not a script.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AI_TONE, tone } from "@/lib/tones";
import { AiIcon } from "../bits";

const EASE = [0.23, 1, 0.32, 1] as const;

/** Text with a soft light sweep while work is in progress. Static under reduced motion. */
export function ShimmerText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn("bg-clip-text text-transparent", className)}
      style={{
        backgroundImage: "linear-gradient(90deg, var(--fg-3) 35%, var(--fg) 50%, var(--fg-3) 65%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.6s linear infinite",
      }}
    >
      {children}
    </span>
  );
}

/** Seconds since mount, ticking every 100ms while `running`. */
export function useElapsed(running: boolean) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);
  return Math.max(0, (now - start) / 1000);
}

export function formatElapsed(s: number) {
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export type TraceRow = { key: string; label: ReactNode; meta?: ReactNode; href?: string; icon?: ReactNode; done?: boolean };

/**
 * An AI step: a sparkle and a shimmering label while working, a quiet settled
 * label after. When `rows` are given the header toggles a trace list below it.
 */
export function Thinking({
  working,
  label,
  doneLabel,
  rows,
  defaultOpen = false,
  className,
  trailing,
}: {
  working: boolean;
  label: ReactNode;
  doneLabel?: ReactNode;
  rows?: TraceRow[];
  defaultOpen?: boolean;
  className?: string;
  trailing?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const expandable = !!rows?.length;
  const head = (
    <>
      <AiIcon className={cn("size-3.5 transition-opacity", tone[AI_TONE].text, !working && "opacity-70")} />
      <span role="status" aria-live="polite" className="min-w-0 truncate text-[12.5px] font-medium">
        {working ? <ShimmerText>{label}</ShimmerText> : <span className="text-fg-2 animate-fade-in">{doneLabel ?? label}</span>}
      </span>
      {expandable && (
        <ChevronDown aria-hidden className={cn("size-3.5 shrink-0 text-fg-4 transition-transform duration-200", open && "rotate-180")} />
      )}
    </>
  );
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex min-h-6 items-center gap-2">
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover"
          >
            {head}
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-2">{head}</span>
        )}
        {trailing}
      </div>
      <AnimatePresence initial={false}>
        {expandable && open && (
          <motion.div
            key="trace"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="overflow-hidden"
          >
            <ol className="relative ml-[6px] mt-1 flex flex-col gap-0.5 border-l border-line pl-3">
              {rows!.map((r, i) => {
                const body = (
                  <>
                    <span className="flex size-3.5 shrink-0 items-center justify-center text-fg-4">
                      {r.icon ?? (r.done === false ? <span className="size-2.5 rounded-full border-[1.5px] border-line-strong border-t-fg-3 animate-spin" /> : <Check className="size-3" />)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{r.label}</span>
                    {r.meta && <span className="mono shrink-0 text-[10.5px] text-fg-4">{r.meta}</span>}
                  </>
                );
                return (
                  <motion.li
                    key={r.key}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: EASE, delay: reduce ? 0 : i * 0.05 }}
                  >
                    {r.href ? (
                      <a href={r.href} target="_blank" rel="noopener noreferrer" className="-mx-1.5 flex h-6 items-center gap-2 rounded-md px-1.5 transition-colors hover:bg-hover [&:hover>span:nth-child(2)]:text-fg">
                        {body}
                      </a>
                    ) : (
                      <div className="flex h-6 items-center gap-2">{body}</div>
                    )}
                  </motion.li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A 1px indeterminate bar in the AI tone, for the top edge of a working region. */
export function WorkingBar({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 -top-px h-px overflow-hidden", className)} aria-hidden>
      <div className={cn("h-full w-1/3", tone[AI_TONE].solid)} style={{ animation: "pending-bar 1.4s ease-in-out infinite" }} />
    </div>
  );
}
