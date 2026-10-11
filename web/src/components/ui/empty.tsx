import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The Module mark as quiet tiles: four modules, one of them reshaped. One
 * module is "lit" in ink and the rest sit in mist with an ash hairline, so
 * the shape reads clearly without competing with the copy. The modules snap
 * in one after another (skipped under reduced motion).
 */
export function ModuleArt({ lit = 1, className }: { lit?: 0 | 1 | 2 | 3; className?: string }) {
  const cells = [
    { x: 2, y: 2, circle: false },
    { x: 34, y: 2, circle: true },
    { x: 2, y: 34, circle: false },
    { x: 34, y: 34, circle: false },
  ];
  return (
    <svg viewBox="0 0 64 64" className={cn("size-16", className)} fill="none" aria-hidden>
      {cells.map((c, i) => {
        const on = i === lit;
        const cls = cn(
          "origin-center animate-module-snap [transform-box:fill-box] motion-reduce:animate-none",
          on ? "fill-fg" : "fill-hover stroke-line-strong",
        );
        const style = { animationDelay: `${i * 45}ms` };
        return c.circle ? (
          <circle key={i} cx={c.x + 14} cy={c.y + 14} r={on ? 14 : 13.5} className={cls} strokeWidth={on ? 0 : 1} style={style} />
        ) : (
          <rect
            key={i}
            x={c.x + (on ? 0 : 0.5)}
            y={c.y + (on ? 0 : 0.5)}
            width={on ? 28 : 27}
            height={on ? 28 : 27}
            rx={4}
            className={cls}
            strokeWidth={on ? 0 : 1}
            style={style}
          />
        );
      })}
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
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        // A full empty state fills its scroll area and centres itself in it.
        compact ? "gap-2 px-4 py-8" : "min-h-full flex-1 gap-4 px-6 py-16",
        className,
      )}
    >
      {icon ?? <ModuleArt lit={lit} className={compact ? "size-10" : "size-16"} />}
      <div className="flex max-w-[340px] flex-col gap-1">
        <p className="text-[14px] font-medium tracking-[-0.01em] text-fg">{title}</p>
        {description && <p className="text-[12.5px] leading-5 text-fg-3">{description}</p>}
      </div>
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  );
}
