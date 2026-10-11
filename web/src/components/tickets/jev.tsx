// The AI teammate's identity inside tickets: its name (from the workspace's AI
// settings, "Jev" by default), a small violet mark for things it set, and an
// avatar for timeline lines it authored. Kept here until the assistant's own
// blob component lands in components/assistant.

import { Sparkles } from "lucide-react";
import type { AISettings } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { tone } from "@/lib/tones";
import { useQuery } from "@tanstack/react-query";
import { q } from "@/lib/queries";
import { Tooltip } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";

export const DEFAULT_ASSISTANT_NAME = "Jev";

export function useAssistantName(): string {
  const { data } = useQuery(q.workspace());
  const ai = data?.settings.ai as (AISettings & { assistant_name?: string }) | undefined;
  return ai?.assistant_name?.trim() || DEFAULT_ASSISTANT_NAME;
}

/** An activity or message the AI authored (contracts/ai.md: actor_type "ai"). */
export function isAIActor(actor: { type: string } | null | undefined) {
  return actor?.type === "ai";
}

/** A tiny violet sparkle with "Set by Jev"; sits on a value the AI chose. */
export function SetByJev({ className }: { className?: string }) {
  const { t } = useTranslation("inbox");
  const name = useAssistantName();
  return (
    <Tooltip content={t("jev.setBy", { name })}>
      <span
        role="img"
        aria-label={t("jev.setBy", { name })}
        className={cn("inline-flex size-3 shrink-0 items-center justify-center rounded-xs", tone.violet.soft, tone.violet.text, className)}
      >
        <Sparkles className="size-2" strokeWidth={2.25} />
      </span>
    </Tooltip>
  );
}

/** The actor avatar on timeline lines and messages the AI wrote. */
export function JevAvatar({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", tone.violet.chip, className)}
      style={{ width: size, height: size }}
    >
      <Sparkles style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={2} />
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
