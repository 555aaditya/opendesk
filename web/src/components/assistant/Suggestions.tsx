// Quick asks that fit the page: a ticket gets "summarize" and "who should take
// this", the inbox gets triage, reports get the week in numbers.

import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { pageContext } from "./context";

type Key = "summarize" | "assign" | "reply" | "note" | "triage" | "unassigned" | "report" | "kb" | "label" | "breach" | "mine";

export function suggestionKeys(page: string | undefined): Key[] {
  switch (page) {
    case "ticket":
      return ["summarize", "assign", "reply", "note"];
    case "reports":
      return ["report", "breach", "unassigned"];
    case "kb":
      return ["kb", "report"];
    case "inbox":
    case "view":
      return ["triage", "unassigned", "label", "mine"];
    default:
      return ["triage", "breach", "mine", "report"];
  }
}

export function Suggestions({ onPick, compact }: { onPick: (prompt: string) => void; compact?: boolean }) {
  const { t } = useTranslation("assistant");
  // Re-read on navigation; the preview pane also counts as an open ticket.
  useRouterState({ select: (s) => s.location.href });
  const all = suggestionKeys(pageContext().page);
  const keys = compact ? all.slice(0, 3) : all;
  return (
    <div className={cn("flex gap-1.5", compact ? "-mx-3 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "flex-wrap")} role="list" aria-label={t("suggested")}>
      {keys.map((k, i) => (
        <button
          key={k}
          type="button"
          role="listitem"
          onClick={() => onPick(t(`prompts.${k}`))}
          style={{ animationDelay: `${60 + i * 40}ms` }}
          className={cn("animate-item-in rounded-full border border-line bg-surface px-2.5 py-1 text-left text-[12px] text-fg-2 shadow-xs transition-[border-color,color,background-color,transform] hover:border-[color-mix(in_srgb,var(--tone-violet-solid)_40%,var(--line))] hover:bg-tone-violet-soft hover:text-fg active:scale-[0.98] motion-reduce:animate-none", compact && "shrink-0 whitespace-nowrap py-0.5 text-[11.5px]")}
        >
          {t(`prompts.${k}`)}
        </button>
      ))}
    </div>
  );
}
