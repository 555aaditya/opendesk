import type { Channel, ReportsOverview } from "@/lib/api/types";
import { ChannelIcon, channelLabel } from "@/components/tickets/bits";
import { Tooltip } from "@/components/ui/tooltip";

const order: Channel[] = ["email", "chat", "portal", "api"];

/** One series, one colour: bar length carries the count, the label carries the share. */
export function ChannelBars({ data }: { data: ReportsOverview["by_channel"] }) {
  const rows = order.map((c) => ({ c, n: data[c] ?? 0 })).sort((a, b) => b.n - a.n);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map(({ c, n }) => {
        const share = total ? Math.round((n / total) * 100) : 0;
        return (
          <li key={c}>
            <Tooltip content={`${channelLabel[c]}: ${n.toLocaleString()} tickets, ${share}%`}>
              <div tabIndex={0} className="group rounded-md outline-none focus-visible:shadow-[0_0_0_2px_var(--focus)]">
                <div className="mb-1.5 flex items-center gap-2 text-[12.5px]">
                  <ChannelIcon channel={c} />
                  <span className="text-fg-2">{channelLabel[c]}</span>
                  <span className="mono ml-auto text-xs text-fg">{n.toLocaleString()}</span>
                  <span className="mono w-9 text-right text-[11px] text-fg-4">{share}%</span>
                </div>
                <div className="h-2.5 w-full">
                  <div
                    className="h-full rounded-r-sm bg-fg-2 transition-opacity group-hover:opacity-80"
                    style={{ width: `${Math.max(n ? 1.5 : 0, (n / max) * 100)}%` }}
                  />
                </div>
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
