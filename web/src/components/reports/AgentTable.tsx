import { useTranslation } from "react-i18next";
import type { ReportsOverview } from "@/lib/api/types";
import { Avatar } from "@/components/ui/avatar";
import { minutes } from "@/lib/format";
import { SERIES } from "@/lib/tones";
import { cn } from "@/lib/cn";
import { Bar } from "./Bars";

/** Leaderboard: agents ranked by tickets solved, with their share and first response median. */
export function AgentTable({ rows }: { rows: ReportsOverview["by_agent"] }) {
  const { t } = useTranslation("reports");
  const sorted = [...rows].sort((a, b) => b.solved - a.solved);
  const max = Math.max(1, ...sorted.map((r) => r.solved));
  const total = sorted.reduce((a, r) => a + r.solved, 0);
  return (
    <table className="w-full text-[13px]">
      <caption className="sr-only">{t("agents.caption")}</caption>
      <thead>
        <tr className="border-b border-line text-left">
          <th className="label-caps w-10 py-2 pl-4 font-normal">#</th>
          <th className="label-caps py-2 font-normal">{t("agents.agent")}</th>
          <th className="label-caps w-[38%] py-2 font-normal">{t("agents.solved")}</th>
          <th className="label-caps py-2 text-right font-normal">{t("agents.share")}</th>
          <th className="label-caps py-2 pr-4 text-right font-normal">{t("agents.firstResponse")}</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => (
          <tr key={r.user.id} className="border-b border-line-soft transition-colors last:border-0 hover:bg-sunken">
            <td className="py-2.5 pl-4">
              <span
                className={cn(
                  "mono inline-flex size-5 items-center justify-center rounded-sm text-[10.5px] tabular-nums",
                  i === 0 ? "bg-tone-amber-soft text-tone-amber" : "text-fg-4",
                )}
              >
                {i + 1}
              </span>
            </td>
            <td className="py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar name={r.user.name} src={r.user.avatar_url} size="md" />
                <span className="truncate font-medium">{r.user.name}</span>
              </span>
            </td>
            <td className="py-2.5 pr-6">
              <span className="flex items-center gap-3">
                <span className="mono w-7 shrink-0 text-right text-xs tabular-nums">{r.solved}</span>
                <Bar pct={(r.solved / max) * 100} tone={SERIES[0]} />
              </span>
            </td>
            <td className="mono py-2.5 text-right text-xs tabular-nums text-fg-3">{total ? Math.round((r.solved / total) * 100) : 0}%</td>
            <td className="mono py-2.5 pr-4 text-right text-xs tabular-nums text-fg-2">{minutes(r.first_response_p50_minutes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
