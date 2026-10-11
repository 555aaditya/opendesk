// Ollie's suggestions: decisions below the workspace's confidence threshold
// (custom.ai_suggestions, contracts/ai.md "Decisions"). Each is a quiet chip an
// agent accepts (which sets the field, as any edit would) or dismisses.

import { useQuery } from "@tanstack/react-query";
import { Check, Users, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { Priority, Severity, Suggestion, SuggestionField, Ticket, TicketPatch } from "@/lib/api/types";
import { aiSuggestions, pct } from "@/lib/decisions";
import { cn } from "@/lib/cn";
import { springs } from "@/lib/motion";
import { q } from "@/lib/queries";
import { tone, AI_TONE } from "@/lib/tones";
import { TagChip } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { PriorityIcon, SeverityChip, severityLabel, SpamIcon } from "../bits";
import { useDisplay } from "../fields";
import { OllieAvatar, useAssistantName } from "../ollie";
import { useDismissSuggestion, useUpdateTicket } from "../useTicketActions";

/** The PATCH that accepts a suggestion. */
export function acceptPatch(field: SuggestionField, s: Suggestion): TicketPatch {
  switch (field) {
    case "priority":
      return { priority: s.value as Priority };
    case "severity":
      return { severity: s.value as Severity };
    case "team":
      return { team_id: s.value as string };
    case "labels":
      return { add_tags: s.value as string[] };
    case "spam":
      return { spam: true };
  }
}

export function OllieSuggestions({ t }: { t: Ticket }) {
  const { t: tr } = useTranslation("inbox");
  const name = useAssistantName();
  const reduce = useReducedMotion();
  const list = aiSuggestions(t);
  const update = useUpdateTicket();
  const dismiss = useDismissSuggestion();
  if (!list.length) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1 border-t border-line-soft px-1 pt-2">
      <Tooltip content={tr("suggest.hint", { name })}>
        <span className="flex w-fit items-center gap-1.5 text-[11px] text-fg-3">
          <OllieAvatar size={12} />
          {tr("suggest.title", { name })}
        </span>
      </Tooltip>
      <AnimatePresence initial={false}>
        {list.map(([field, s]) => (
          <motion.div
            key={field}
            layout={reduce ? false : "position"}
            initial={reduce ? false : { opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
            transition={springs.row}
          >
            <SuggestionChip
              field={field}
              s={s}
              onAccept={() => update.mutate({ id: t.id, patch: acceptPatch(field, s) })}
              onDismiss={() => dismiss.mutate({ id: t.id, field })}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function SuggestionChip({ field, s, onAccept, onDismiss }: { field: SuggestionField; s: Suggestion; onAccept: () => void; onDismiss: () => void }) {
  const { t: tr } = useTranslation("inbox");
  const display = useDisplay();
  const { data: teams } = useQuery(q.teams());
  const sure = pct(s.confidence);
  let value: React.ReactNode;
  let text: string;
  switch (field) {
    case "severity":
      text = severityLabel[s.value as Severity];
      value = (
        <>
          <SeverityChip severity={s.value as Severity} />
          {text}
        </>
      );
      break;
    case "priority":
      text = display.priority(s.value as Priority);
      value = (
        <>
          <PriorityIcon priority={s.value as Priority} />
          {text}
        </>
      );
      break;
    case "team": {
      text = teams?.find((x) => x.id === s.value)?.name ?? tr("suggest.fields.team");
      value = (
        <>
          <Users className="size-3.5 text-fg-3" />
          <span className="truncate">{text}</span>
        </>
      );
      break;
    }
    case "labels":
      text = (s.value as string[]).join(", ");
      value = (
        <span className="flex min-w-0 flex-wrap gap-1">
          {(s.value as string[]).map((n) => (
            <TagChip key={n} name={n} color="gray" className="text-[11px]" />
          ))}
        </span>
      );
      break;
    case "spam":
      text = tr("suggest.spam");
      value = (
        <>
          <SpamIcon />
          {text}
        </>
      );
      break;
  }
  const what = `${tr(`suggest.fields.${field}`)}: ${text}`;
  return (
    <div
      className={cn(
        "group flex min-h-7 items-center gap-2 rounded-md border border-dashed px-2 py-1 text-[12px] transition-colors duration-150",
        tone[AI_TONE].line,
        "bg-surface hover:bg-sunken/60",
      )}
    >
      <span className="w-[58px] shrink-0 text-[11px] text-fg-3">{tr(`suggest.fields.${field}`)}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-fg-2">{value}</span>
      {sure != null && <span className={cn("mono shrink-0 text-[10.5px] tabular-nums", tone[AI_TONE].text)}>{sure}%</span>}
      <span className="flex shrink-0 items-center">
        <Tooltip content={tr("suggest.accept")}>
          <button
            type="button"
            aria-label={tr("suggest.acceptAria", { what })}
            onClick={onAccept}
            className="flex size-5 items-center justify-center rounded-sm text-fg-3 outline-none transition-colors hover:bg-hover hover:text-fg focus-visible:shadow-[0_0_0_2px_var(--focus)] active:scale-95"
          >
            <Check className="size-3.5" />
          </button>
        </Tooltip>
        <Tooltip content={tr("suggest.dismiss")}>
          <button
            type="button"
            aria-label={tr("suggest.dismissAria", { what })}
            onClick={onDismiss}
            className="flex size-5 items-center justify-center rounded-sm text-fg-4 outline-none transition-colors hover:bg-hover hover:text-fg focus-visible:shadow-[0_0_0_2px_var(--focus)] active:scale-95"
          >
            <X className="size-3.5" />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}
