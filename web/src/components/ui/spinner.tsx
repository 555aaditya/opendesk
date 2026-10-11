import { cn } from "@/lib/cn";

// The loader is the mark itself: its four modules fill in turn, the circle last.
const cells = [
  { x: 1, y: 1, circle: false, delay: 0 },
  { x: 9, y: 1, circle: true, delay: 0.45 },
  { x: 9, y: 9, circle: false, delay: 0.3 },
  { x: 1, y: 9, circle: false, delay: 0.15 },
];

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4", className)} aria-hidden fill="currentColor">
      {cells.map((c, i) =>
        c.circle ? (
          <circle key={i} cx={c.x + 3} cy={c.y + 3} r={3} className="animate-module-fill" style={{ animationDelay: `${c.delay}s` }} />
        ) : (
          <rect key={i} x={c.x} y={c.y} width={6} height={6} rx={1.5} className="animate-module-fill" style={{ animationDelay: `${c.delay}s` }} />
        ),
      )}
    </svg>
  );
}
