// A light line under the list toolbar: what needs attention in this list.
// Urgent narrows the list; the SLA counts sort it by what's due first.

import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import type { InboxSearch } from "@/lib/folders";
import { cn } from "@/lib/cn";
import { tone } from "@/lib/tones";
import { Tooltip } from "@/components/ui/tooltip";
import { PriorityIcon } from "./bits";
import { AnimatedNumber } from "@/components/motion";

function Item({ icon, n, label, onClick, hint, active }: { icon: ReactNode; n: number; label: string; onClick?: () => void; hint?: string; active?: boolean }) {
  const body = (
    <>
      {icon}
      <AnimatedNumber value={n} flash className="mono text-fg-2" />
      <span>{label}</span>
    </>
  );
  const cls = "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-[11.5px] text-fg-3";
  if (!onClick) return <span className={cls}>{body}</span>;
  return (
    <Tooltip content={hint}>
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={cn(cls, "outline-none transition-colors hover:bg-hover hover:text-fg focus-visible:shadow-[0_0_0_2px_var(--focus)] active:scale-[0.985]", active && "bg-hover text-fg")}
      >
        {body}
      </button>
    </Tooltip>
  );
}

export function SummaryStrip({
  total,
  awaiting,
  urgent,
  overdue,
  dueSoon,
  search,
  onSearch,
}: {
  total: number;
  awaiting: number;
  urgent: number;
  overdue: number;
  dueSoon: number;
  search: InboxSearch;
  onSearch: (s: InboxSearch) => void;
}) {
  const { t } = useTranslation("inbox");
  const urgentOnly = search.priority === "urgent";
  const byDue = search.sort === "due";
  if (!awaiting && !urgent && !overdue && !dueSoon) return null;
  const sortDue = () => onSearch({ ...search, sort: byDue ? undefined : "due", order: undefined });
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line-soft px-2.5" aria-label={t("summary.label")} role="group">
      <span className="mr-1 shrink-0 px-1 text-[11.5px] text-fg-4">{t("summary.total", { count: total })}</span>
      {awaiting > 0 && <Item icon={<span className={cn("size-1.5 rounded-full", tone.blue.solid)} />} n={awaiting} label={t("summary.awaiting")} />}
      {urgent > 0 && (
        <Item
          icon={<PriorityIcon priority="urgent" className="size-3" />}
          n={urgent}
          label={t("summary.urgent")}
          hint={urgentOnly ? t("summary.showAll") : t("summary.urgentOnly")}
          active={urgentOnly}
          onClick={() => onSearch({ ...search, priority: urgentOnly ? undefined : "urgent" })}
        />
      )}
      {overdue > 0 && (
        <Item
          icon={<span className={cn("size-1.5 rounded-full animate-pulse-soft motion-reduce:animate-none", tone.red.solid)} />}
          n={overdue}
          label={t("summary.overdue")}
          hint={byDue ? t("summary.unsort") : t("summary.sortDue")}
          active={byDue}
          onClick={sortDue}
        />
      )}
      {dueSoon > 0 && (
        <Item
          icon={<span className={cn("size-1.5 rounded-full", tone.amber.solid)} />}
          n={dueSoon}
          label={t("summary.dueSoon")}
          hint={byDue ? t("summary.unsort") : t("summary.sortDue")}
          active={byDue}
          onClick={sortDue}
        />
      )}
    </div>
  );
}
