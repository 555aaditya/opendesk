import type { Sentiment } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { tone } from "@/lib/tones";

const hue: Record<Sentiment, string> = {
  positive: tone.green.solid,
  neutral: "bg-fg-4",
  negative: tone.amber.solid,
  frustrated: tone.red.solid,
};

/** Sentiment as a tiny dot; use SentimentIcon (components/indicators) where there is room for the glyph. */
export function SentimentDot({ sentiment, className }: { sentiment: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", hue[sentiment as Sentiment] ?? "bg-fg-4", className)} />;
}
