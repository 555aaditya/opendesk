import { cn } from "@/lib/cn";

/** A thin usage bar. Full and past full read as "at the limit", in ink, not colour. */
export function Meter({ value, max, className, label }: { value: number; max: number; className?: string; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn("h-1 w-full overflow-hidden rounded-full bg-hover", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", pct >= 100 ? "bg-fg" : "bg-fg-3")} style={{ width: `${pct}%` }} />
    </div>
  );
}
