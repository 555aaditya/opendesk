import { ArrowDown, ArrowUp } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/** Up/down reorder buttons for ordered settings lists. */
export function ReorderButtons({
  onUp,
  onDown,
  first,
  last,
  label,
  disabled,
}: {
  onUp: () => void;
  onDown: () => void;
  first: boolean;
  last: boolean;
  label: string;
  disabled?: boolean;
}) {
  const btn =
    "flex size-6 items-center justify-center rounded-[6px] text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-30";
  return (
    <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
      <Tooltip content="Move up">
        <button type="button" aria-label={`Move ${label} up`} disabled={first || disabled} onClick={onUp} className={btn}>
          <ArrowUp className="size-3.5" />
        </button>
      </Tooltip>
      <Tooltip content="Move down">
        <button type="button" aria-label={`Move ${label} down`} disabled={last || disabled} onClick={onDown} className={btn}>
          <ArrowDown className="size-3.5" />
        </button>
      </Tooltip>
    </span>
  );
}

/** A small rounded scope/event chip in mono. */
export function MonoChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("mono inline-flex h-[18px] shrink-0 items-center rounded-[5px] border border-line px-1.5 text-[10.5px] text-fg-2", className)}>
      {children}
    </span>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-12 items-center gap-3 border-b border-line-soft px-4 last:border-0">
          <div className="skeleton h-2.5" style={{ width: `${28 + ((i * 13) % 25)}%` }} />
          <div className="skeleton ml-auto h-2.5 w-16" />
        </div>
      ))}
    </div>
  );
}
