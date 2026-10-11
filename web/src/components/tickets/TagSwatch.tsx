import { cn } from "@/lib/cn";
import { isTone, tone, toneFor } from "@/lib/tones";

/** A tag's colour as a small square, for menus and pickers. */
export function TagSwatch({ name, color, className }: { name: string; color?: string | null; className?: string }) {
  const hue = isTone(color) ? color : toneFor(name);
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-xs", tone[hue].solid, className)} />;
}
