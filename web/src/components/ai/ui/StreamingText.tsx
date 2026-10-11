// Adapted from Beautiful UI "Streaming Text" (https://www.beautifului.dev/#streaming-text)
// and "Tool Chips" (#tool-chips). MIT, Copyright (c) 2026 Shane Levine.
// See web/THIRD_PARTY_NOTICES.md. Streams real model output (sanitized HTML)
// with a caret, and shows knowledge base sources as compact chips.

import { motion, useReducedMotion } from "motion/react";
import { BookOpen, X } from "lucide-react";
import type { ReactNode } from "react";
import type { KBSource } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { AI_TONE, tone } from "@/lib/tones";
import { Tooltip } from "@/components/ui/tooltip";

const proseCls = "prose-od text-[12.5px] leading-[19px] [&_li]:my-0.5 [&_p]:my-1 [&_p:first-child]:mt-0 [&_ul]:my-1 [&_ul]:pl-4";

/** Already-sanitized HTML. While `streaming`, a caret blinks after the last word. */
export function StreamingHtml({ html, streaming, className }: { html: string; streaming?: boolean; className?: string }) {
  return (
    <div className={cn("relative", className)} data-ph-mask>
      <div
        className={cn(proseCls, streaming && "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:h-3 [&>*:last-child]:after:w-0.5 [&>*:last-child]:after:translate-y-0.5 [&>*:last-child]:after:animate-pulse-soft [&>*:last-child]:after:rounded-xs [&>*:last-child]:after:bg-tone-violet-solid [&>*:last-child]:after:content-['']")}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/** One knowledge base article, as an inline chip. */
export function SourceChip({ source, index = 0 }: { source: KBSource; index?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1], delay: reduce ? 0 : index * 0.04 }}
      className="inline-flex h-5 max-w-[220px] items-center gap-1 rounded-sm border border-line bg-surface pl-1 pr-1.5 text-[11px] text-fg-2 transition-colors hover:border-line-strong hover:bg-hover hover:text-fg"
    >
      <span className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-xs", tone[AI_TONE].soft)}>
        <BookOpen className={cn("size-2.5", tone[AI_TONE].text)} strokeWidth={2} />
      </span>
      <span className="truncate">{source.title}</span>
    </motion.a>
  );
}

/** A row of source chips with a quiet label and an optional dismiss. */
export function SourceChips({
  sources,
  label,
  onDismiss,
  dismissLabel,
  className,
  children,
}: {
  sources: KBSource[];
  label: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
  children?: ReactNode;
}) {
  if (!sources.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="text-[11px] text-fg-4">{label}</span>
      {sources.map((s, i) => (
        <SourceChip key={s.article_id} source={s} index={i} />
      ))}
      {children}
      {onDismiss && (
        <Tooltip content={dismissLabel}>
          <button type="button" aria-label={dismissLabel} onClick={onDismiss} className="flex size-5 items-center justify-center rounded-sm text-fg-4 transition-colors hover:bg-hover hover:text-fg">
            <X className="size-3" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
