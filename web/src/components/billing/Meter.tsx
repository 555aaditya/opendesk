import { cn } from "@/lib/cn";
import { tone as tones, type Tone } from "@/lib/tones";

/** The hue for how full a meter is: green with room, amber near or at the cap, red past it. */
export function meterTone(value: number, max: number): Tone {
  if (max <= 0) return "green";
  const r = value / max;
  return r > 1 ? "red" : r >= 0.8 ? "amber" : "green";
}

/** A thin usage bar, coloured by how close it is to the limit. */
export function Meter({ value, max, className, label, tone }: { value: number; max: number; className?: string; label: string; tone?: Tone }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const hue = tone ?? meterTone(value, max);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn("h-1 w-full overflow-hidden rounded-full bg-hover", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none", tones[hue].solid)}
        style={{ width: `${Math.max(pct, value > 0 ? 3 : 0)}%` }}
      />
    </div>
  );
}
