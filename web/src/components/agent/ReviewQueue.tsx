// "Needs review" on the agent overview (contracts/agent.md "Review queue"):
// recent Ollie replies visitors rated not helpful, or that ended in a handoff,
// each a click away from the conversation or a better answer. Dismissing is
// optimistic and live for every admin (ai_agent_review.updated).

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Hand, ThumbsDown, Wand2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { MotionList, MotionRow } from "@/components/settings2/motion";
import { useListMutation } from "@/components/settings2/optimistic";
import { ImproveAnswerDialog } from "@/components/agent/quality";
import { api } from "@/lib/api/endpoints";
import type { AgentReviewItem } from "@/lib/api/types";
import { number, relShort } from "@/lib/format";
import { q, qk } from "@/lib/queries";
import { tone } from "@/lib/tones";
import { cn } from "@/lib/cn";

export function ReviewQueue() {
  const { t } = useTranslation("agentQuality");
  const { data, isLoading } = useQuery(q.agentReview());
  const [improving, setImproving] = useState<AgentReviewItem | null>(null);
  const dismiss = useListMutation<AgentReviewItem, string>(qk.agentReview, (id) => api.ai.agent.review.dismiss(id), (rows, id) => rows.filter((r) => r.id !== id), {
    errorText: t("review.dismissError"),
  });
  const items = data ?? [];

  return (
    <Section title={t("review.title")} description={t("review.description")} flush actions={items.length ? <span className="mono text-[11px] tabular-nums text-fg-3">{number(items.length)}</span> : undefined}>
      {isLoading ? (
        <div className="flex flex-col gap-2 p-4" aria-hidden>
          <Skeleton className="h-12 rounded-md" />
          <Skeleton className="h-12 rounded-md" />
        </div>
      ) : !items.length ? (
        <EmptyState compact art="ai" title={t("review.empty")} description={t("review.emptyBody")} />
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          <MotionList>
            {items.map((it) => (
              <MotionRow key={it.id}>
                <ReviewRow it={it} onImprove={() => setImproving(it)} onDismiss={() => dismiss.mutate(it.id)} />
              </MotionRow>
            ))}
          </MotionList>
        </div>
      )}
      {improving && <ImproveAnswerDialog question={improving.question} answer={improving.answer} messageId={improving.id} onClose={() => setImproving(null)} />}
    </Section>
  );
}

function ReviewRow({ it, onImprove, onDismiss }: { it: AgentReviewItem; onImprove: () => void; onDismiss: () => void }) {
  const { t } = useTranslation("agentQuality");
  const down = it.reason === "rated_down";
  return (
    <div className="group flex items-start gap-3 px-4 py-3">
      <span className={cn("mt-0.5 inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-[11px] font-medium", down ? tone.red.chip : tone.amber.chip)}>
        {down ? <ThumbsDown className="size-3" aria-hidden /> : <Hand className="size-3" aria-hidden />}
        {down ? t("review.ratedDown") : t("review.handoff")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[12.5px] font-medium leading-[18px] text-fg" data-ph-mask>
          {it.question || t("review.noQuestion")}
        </div>
        <div className="mt-0.5 line-clamp-1 text-[12px] leading-[18px] text-fg-3" data-ph-mask>
          {t("review.ollie")}: {it.answer}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-fg-4">
          <span className="mono">#{it.ticket_number}</span>
          {it.contact_name && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate" data-ph-mask>
                {it.contact_name}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{relShort(it.created_at)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button asChild size="xs" variant="ghost">
          <Link to="/inbox/$folder/{-$ticketId}" params={{ folder: "open", ticketId: it.ticket_id }}>
            <ArrowUpRight className="size-3" />
            {t("review.open")}
          </Link>
        </Button>
        <Button size="xs" variant="secondary" icon={<Wand2 />} onClick={onImprove}>
          {t("improve.action")}
        </Button>
        <Tooltip content={t("review.dismiss")}>
          <Button square size="xs" variant="ghost" aria-label={t("review.dismiss")} onClick={onDismiss}>
            <X className="size-3" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
