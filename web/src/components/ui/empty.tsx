import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The Module mark drawn in hairlines: four modules, one of them reshaped.
 * Which one is "lit" varies by context so empty states feel related but not
 * identical.
 */
export function ModuleArt({ lit = 1, className }: { lit?: 0 | 1 | 2 | 3; className?: string }) {
  const cells = [
    { x: 4, y: 4, circle: false },
    { x: 34, y: 4, circle: true },
    { x: 4, y: 34, circle: false },
    { x: 34, y: 34, circle: false },
  ];
  return (
    <svg viewBox="0 0 64 64" className={cn("size-14", className)} fill="none" aria-hidden>
      {cells.map((c, i) =>
        c.circle ? (
          <circle
            key={i}
            cx={c.x + 13}
            cy={c.y + 13}
            r={13}
            className={cn("animate-rise-in", i === lit ? "fill-fg" : "stroke-line-strong")}
            style={{ animationDelay: `${i * 70}ms` }}
            strokeWidth={i === lit ? 0 : 1}
            strokeDasharray={i === lit ? undefined : "2 2.5"}
          />
        ) : (
          <rect
            key={i}
            x={c.x + 0.5}
            y={c.y + 0.5}
            width={25}
            height={25}
            rx={6.5}
            className={cn("animate-rise-in", i === lit ? "fill-fg" : "stroke-line-strong")}
            style={{ animationDelay: `${i * 70}ms` }}
            strokeWidth={i === lit ? 0 : 1}
            strokeDasharray={i === lit ? undefined : "2 2.5"}
          />
        ),
      )}
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  lit = 1,
  className,
  compact,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  lit?: 0 | 1 | 2 | 3;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 py-8" : "gap-3 py-16", className)}>
      {icon ?? <ModuleArt lit={lit} className={compact ? "size-9" : "size-12"} />}
      <div className="flex max-w-[320px] flex-col gap-1">
        <p className="text-[14px] font-semibold tracking-[-0.03em] text-fg">{title}</p>
        {description && <p className="text-[12.5px] leading-5 text-fg-3">{description}</p>}
      </div>
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  );
}
