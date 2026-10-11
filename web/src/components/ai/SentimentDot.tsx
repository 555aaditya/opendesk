import type { Sentiment } from "@/lib/api/types";
import { cn } from "@/lib/cn";

const tone: Record<Sentiment, string> = {
  positive: "bg-ok",
  neutral: "bg-fg-4",
  negative: "bg-warn",
  frustrated: "bg-danger",
};

/** Sentiment as a tiny semantic dot, the only place it gets colour. */
export function SentimentDot({ sentiment, className }: { sentiment: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", tone[sentiment as Sentiment] ?? "bg-fg-4", className)} />;
}
