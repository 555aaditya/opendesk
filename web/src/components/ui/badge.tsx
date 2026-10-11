import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Badge({
  children,
  className,
  tone = "neutral",
  dot,
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "solid" | "outline" | "ok" | "warn" | "danger";
  dot?: boolean;
}) {
  const toneCls = {
    neutral: "bg-hover text-fg-2",
    solid: "bg-inverse text-inverse-fg",
    outline: "border border-line text-fg-2",
    ok: "border border-line text-fg-2",
    warn: "border border-line text-fg-2",
    danger: "border border-line text-fg-2",
  }[tone];
  const dotCls = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", neutral: "bg-fg-4", solid: "bg-inverse-fg", outline: "bg-fg-4" }[tone];
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-[11px] font-medium", toneCls, className)}>
      {(dot || tone === "ok" || tone === "warn" || tone === "danger") && <span className={cn("size-1.5 rounded-full", dotCls)} />}
      {children}
    </span>
  );
}

export function Dot({ tone, className, pulse }: { tone: "ok" | "warn" | "danger" | "muted" | "fg"; className?: string; pulse?: boolean }) {
  const c = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", muted: "bg-fg-4", fg: "bg-fg" }[tone];
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", c, pulse && "animate-pulse-soft", className)} aria-hidden />;
}

export function TagChip({ name, onRemove, className }: { name: string; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn("inline-flex h-[18px] max-w-[140px] shrink-0 items-center gap-1 rounded-sm border border-line bg-surface pl-1.5 text-[11px] text-fg-2", onRemove ? "pr-0.5" : "pr-1.5", className)}>
      <span className="size-1 shrink-0 rounded-full bg-fg-4" />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex size-3.5 items-center justify-center rounded-xs text-fg-4 hover:bg-hover hover:text-fg"
        >
          <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
            <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  );
}
