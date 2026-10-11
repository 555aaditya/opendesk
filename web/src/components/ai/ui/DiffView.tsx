// Adapted from Beautiful UI "Diff Table" (https://www.beautifului.dev/#diff-table).
// MIT, Copyright (c) 2026 Shane Levine. See web/THIRD_PARTY_NOTICES.md.
// The proposed edit rests on the completed diff: removals tinted red and struck,
// additions tinted green, a counts summary and the actions in the footer.

import { motion, useReducedMotion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { tone } from "@/lib/tones";
import { diffStats, diffWords, type DiffPart } from "./diff";

const delCls = cn(tone.red.soft, tone.red.text, "line-through decoration-1 [text-decoration-color:color-mix(in_srgb,var(--tone-red-solid)_55%,transparent)]");
const addCls = cn(tone.green.soft, tone.green.text);

function Inline({ parts }: { parts: DiffPart[] }) {
  return (
    <p className="whitespace-pre-wrap text-[12.5px] leading-[20px] text-fg-2">
      {parts.map((p, i) =>
        p.kind === "same" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span key={i}>
            {/^\s/.test(p.text) && p.text.match(/^\s+/)![0]}
            {p.text.trim() && (
              <span className={cn("rounded-xs px-px [box-decoration-break:clone]", p.kind === "add" ? addCls : delCls)}>
                <span className="sr-only">{p.kind === "add" ? "+" : "-"}</span>
                {p.text.trim()}
              </span>
            )}
            {/\S\s+$/.test(p.text) && p.text.match(/\s+$/)![0]}
          </span>
        ),
      )}
    </p>
  );
}

function Block({ kind, text, label }: { kind: "add" | "del"; text: string; label: string }) {
  return (
    <div className={cn("flex gap-2.5 px-3 py-2", kind === "add" ? tone.green.soft : tone.red.soft)}>
      <span className={cn("mono w-3 shrink-0 select-none pt-px text-[11px]", kind === "add" ? tone.green.text : tone.red.text)} aria-hidden>
        {kind === "add" ? "+" : "-"}
      </span>
      <p className={cn("min-w-0 whitespace-pre-wrap text-[12.5px] leading-[20px]", kind === "add" ? "text-fg" : cn("text-fg-3 line-through decoration-1 [text-decoration-color:color-mix(in_srgb,var(--tone-red-solid)_45%,transparent)]"))}>
        <span className="sr-only">{label}: </span>
        {text}
      </p>
    </div>
  );
}

/**
 * Before and after, as one diff. Similar texts render inline by word;
 * mostly-new text (a translation) renders as a removed block and an added block.
 */
export function DiffView({
  before,
  after,
  title,
  summary,
  actions,
  labels,
  className,
}: {
  before: string;
  after: string;
  title: ReactNode;
  summary?: (s: { added: number; removed: number }) => ReactNode;
  actions?: ReactNode;
  labels: { before: string; after: string };
  className?: string;
}) {
  const reduce = useReducedMotion();
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  const stats = useMemo(() => diffStats(parts), [parts]);
  const inline = stats.similarity >= 0.35;
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className={cn("overflow-hidden rounded-lg border border-line bg-surface", className)}
    >
      <div className="flex h-8 items-center gap-2 border-b border-line-soft px-3">
        <span className="min-w-0 truncate text-[12px] font-medium text-fg">{title}</span>
        {summary && <span className="mono ml-auto shrink-0 text-[10.5px] tabular-nums text-fg-4">{summary(stats)}</span>}
      </div>
      <div className="max-h-[180px] overflow-y-auto" data-ph-mask>
        {inline ? (
          <div className="px-3 py-2">
            <Inline parts={parts} />
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-line-soft">
            {before && <Block kind="del" text={before} label={labels.before} />}
            {after && <Block kind="add" text={after} label={labels.after} />}
          </div>
        )}
      </div>
      {actions && <div className="flex h-9 items-center justify-end gap-1.5 border-t border-line-soft bg-sunken px-2">{actions}</div>}
    </motion.div>
  );
}
