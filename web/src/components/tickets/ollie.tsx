// The AI teammate's identity inside tickets: its name (assistant_name from the
// AI config, "Ollie" by default), a small violet mark for things it set, and the
// Ollie blob as the avatar on timeline lines it authored.

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { tone } from "@/lib/tones";
import { useQuery } from "@tanstack/react-query";
import { q } from "@/lib/queries";
import { OllieMark } from "@/components/assistant/OllieMark";
import { useAssistantName } from "@/components/assistant/name";
import { Tooltip } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";

export { useAssistantName };

/** An activity or message the AI authored (contracts/ai.md: actor_type "ai"). */
export function isAIActor(actor: { type: string } | null | undefined) {
  return actor?.type === "ai";
}

/** A tiny violet sparkle with "Set by Ollie"; sits on a value the AI chose. */
export function SetByOllie({ className }: { className?: string }) {
  const { t } = useTranslation("inbox");
  const name = useAssistantName();
  return (
    <Tooltip content={t("ollie.setBy", { name })}>
      <span
        role="img"
        aria-label={t("ollie.setBy", { name })}
        className={cn("inline-flex size-3 shrink-0 items-center justify-center rounded-xs", tone.violet.soft, tone.violet.text, className)}
      >
        <Sparkles className="size-2" strokeWidth={2.25} />
      </span>
    </Tooltip>
  );
}

/** The actor avatar on timeline lines and messages the AI wrote. */
export function OllieAvatar({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <OllieMark size={size} eyes={size >= 16} />
    </span>
  );
}

/**
 * Which of a ticket's current values the AI chose last: the latest activity of
 * each kind decides, so an agent changing it afterwards clears the mark.
 */
export function useAISet(ticketId: string) {
  const { data } = useQuery(q.activities(ticketId));
  const last: Record<string, boolean> = {};
  const tags = new Set<string>();
  for (const a of [...(data ?? [])].sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const ai = isAIActor(a.actor);
    if (a.type === "priority_changed" || a.type === "status_changed" || a.type === "assigned") last[a.type] = ai;
    const tag = typeof a.data.tag === "string" ? a.data.tag : undefined;
    if (tag && a.type === "tagged") {
      if (ai) tags.add(tag);
      else tags.delete(tag);
    }
    if (tag && a.type === "untagged") tags.delete(tag);
  }
  return { priority: !!last.priority_changed, status: !!last.status_changed, assignee: !!last.assigned, tags };
}
