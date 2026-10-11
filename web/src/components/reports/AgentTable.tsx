import type { ReportsOverview } from "@/lib/api/types";
import { Avatar } from "@/components/ui/avatar";
import { minutes } from "@/lib/format";

export function AgentTable({ rows }: { rows: ReportsOverview["by_agent"] }) {
  const sorted = [...rows].sort((a, b) => b.solved - a.solved);
  const max = Math.max(1, ...sorted.map((r) => r.solved));
  return (
    <table className="w-full text-[13px]">
      <caption className="sr-only">Tickets solved and first response time by agent</caption>
      <thead>
        <tr className="border-b border-line text-left">
          <th className="label-caps py-2 pl-4 font-normal">Agent</th>
          <th className="label-caps w-[45%] py-2 font-normal">Solved</th>
          <th className="label-caps py-2 pr-4 text-right font-normal">First response p50</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.user.id} className="border-b border-line-soft last:border-0">
            <td className="py-2.5 pl-4">
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar name={r.user.name} src={r.user.avatar_url} size="md" />
                <span className="truncate">{r.user.name}</span>
              </span>
            </td>
            <td className="py-2.5 pr-6">
              <span className="flex items-center gap-3">
                <span className="mono w-8 shrink-0 text-right text-xs tabular-nums">{r.solved}</span>
                <span className="h-1.5 flex-1">
                  <span className="block h-full rounded-r-[3px] bg-fg-2" style={{ width: `${(r.solved / max) * 100}%` }} />
                </span>
              </span>
            </td>
            <td className="mono py-2.5 pr-4 text-right text-xs tabular-nums text-fg-2">{minutes(r.first_response_p50_minutes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
