// Shared AI affordances. AI is marked by a small violet sparkle (AI_TONE, so
// every AI surface reads as one family) and a quiet credit cost in the tooltip.

import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AIFeature } from "@/lib/api/types";
import { useAI } from "@/lib/ai";
import { cn } from "@/lib/cn";
import { AI_TONE, tone } from "@/lib/tones";
import { Tooltip } from "@/components/ui/tooltip";

export function AiIcon({ className }: { className?: string }) {
  return <Sparkles aria-hidden className={cn("size-3.5 shrink-0", tone[AI_TONE].text, className)} strokeWidth={1.75} />;
}

/** "3 credits", for tooltips and menus. Empty when the cost is unknown or AI is unlimited. */
export function useCreditLabel() {
  const { t } = useTranslation();
  const { cost } = useAI();
  return (feature: AIFeature) => {
    const n = cost(feature);
    return n === null ? "" : t("credits", { count: n });
  };
}

/** Wraps an AI control with a tooltip naming the action and its credit cost. */
export function AiTooltip({ feature, label, children }: { feature: AIFeature; label: ReactNode; children: ReactNode }) {
  const credits = useCreditLabel()(feature);
  return (
    <Tooltip
      content={
        <span className="flex items-center gap-2">
          <span>{label}</span>
          {credits && <span className="mono text-[10.5px] opacity-60">{credits}</span>}
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}
