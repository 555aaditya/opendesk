import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import { BarChart3 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RangePicker } from "@/components/reports/RangePicker";
import { Sparkline, VolumeChart, VolumeLegend, VolumeTable } from "@/components/reports/VolumeChart";
import { ChannelBars } from "@/components/reports/ChannelBars";
import { AgentTable } from "@/components/reports/AgentTable";
import type { ReportsOverview, ReportsRange } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { minutes } from "@/lib/format";
import { q } from "@/lib/queries";
import { reportsRange } from "@/router";

const route = getRouteApi("/app/reports");

/** The same-length period just before `r`, for deltas. */
function previous(r: ReportsRange): ReportsRange {
  const from = parseISO(r.from);
  const len = differenceInCalendarDays(parseISO(r.to), from) + 1;
  return { from: format(subDays(from, len), "yyyy-MM-dd"), to: format(subDays(from, 1), "yyyy-MM-dd") };
}

export default function ReportsPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const range = reportsRange(search);
  const report = useQuery({ ...q.reports(range), placeholderData: keepPreviousData });
  const prev = useQuery({ ...q.reports(previous(range)), placeholderData: keepPreviousData });
  const [view, setView] = useState<"chart" | "table">("chart");
  const d = report.data;
  const p = prev.data;
  const refetching = report.isFetching && report.isPlaceholderData;
  const empty = d && d.created === 0 && d.solved === 0 && d.open_now === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Reports" icon={<BarChart3 />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 pb-16 pt-5">
          <div className="flex items-center gap-2">
            <RangePicker value={range} onChange={(r) => void navigate({ search: r })} />
            <span className="text-xs text-fg-4">Compared with the previous {differenceInCalendarDays(parseISO(range.to), parseISO(range.from)) + 1} days</span>
          </div>

          {report.isLoading ? (
            <ReportSkeleton />
          ) : report.error ? (
            <EmptyState lit={3} title="Reports couldn't load" description="Check your connection and try again." action={<Button onClick={() => void report.refetch()}>Retry</Button>} />
          ) : !d || empty ? (
            <EmptyState lit={1} title="Nothing to report yet" description="Once tickets come in, volume, response times and satisfaction show up here." />
          ) : (
            <div className={cn("flex flex-col gap-5 transition-opacity duration-150", refetching && "opacity-60")}>
              <Kpis d={d} p={p} />

              <Card
                title="Volume by day"
                actions={
                  <>
                    <VolumeLegend />
                    <Segmented
                      size="xs"
                      value={view}
                      onChange={setView}
                      options={[
                        { value: "chart", label: "Chart" },
                        { value: "table", label: "Table" },
                      ]}
                    />
                  </>
                }
              >
                {view === "chart" ? <VolumeChart days={d.by_day} /> : <VolumeTable days={d.by_day} />}
              </Card>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <Card title="By channel" subtitle="Tickets created in the period">
                  <ChannelBars data={d.by_channel} />
                </Card>
                <Card title="By agent" flush>
                  {d.by_agent.length ? (
                    <AgentTable rows={d.by_agent} />
                  ) : (
                    <EmptyState compact lit={0} title="No solved tickets" description="Agents appear here once they solve tickets in this period." />
                  )}
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, subtitle, actions, children, flush }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex min-h-11 items-center justify-between gap-4 px-4 pt-3">
        <div>
          <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h2>
          {subtitle && <p className="text-xs text-fg-3">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
      <div className={flush ? "pt-2" : "px-4 pb-4 pt-3"}>{children}</div>
    </section>
  );
}

type Tile = {
  label: string;
  value: string;
  unit?: string;
  delta?: { now: number | null; before: number | null; upIsGood: boolean | null };
  trend?: number[];
  note?: string;
};

function Kpis({ d, p }: { d: ReportsOverview; p?: ReportsOverview }) {
  const tiles: Tile[] = [
    { label: "Created", value: d.created.toLocaleString(), delta: { now: d.created, before: p?.created ?? null, upIsGood: null }, trend: d.by_day.map((x) => x.created) },
    { label: "Solved", value: d.solved.toLocaleString(), delta: { now: d.solved, before: p?.solved ?? null, upIsGood: true }, trend: d.by_day.map((x) => x.solved) },
    { label: "Open now", value: d.open_now.toLocaleString(), note: "Right now" },
    {
      label: "First response",
      value: minutes(d.first_response_p50_minutes),
      note: "Median",
      delta: { now: d.first_response_p50_minutes, before: p?.first_response_p50_minutes ?? null, upIsGood: false },
    },
    {
      label: "Resolution",
      value: minutes(d.resolution_p50_minutes),
      note: "Median",
      delta: { now: d.resolution_p50_minutes, before: p?.resolution_p50_minutes ?? null, upIsGood: false },
    },
    {
      label: "CSAT",
      value: d.csat_avg === null ? "–" : d.csat_avg.toFixed(1),
      unit: d.csat_avg === null ? undefined : "/ 5",
      note: `${d.csat_count.toLocaleString()} ratings`,
      delta: { now: d.csat_avg, before: p?.csat_avg ?? null, upIsGood: true },
    },
    { label: "SLA breached", value: d.sla_breached.toLocaleString(), delta: { now: d.sla_breached, before: p?.sla_breached ?? null, upIsGood: false } },
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-4 xl:grid-cols-7">
      {tiles.map((t) => (
        <div key={t.label} className="flex flex-col gap-2 border-b border-r border-line-soft px-4 py-3.5 last:border-r-0 xl:border-b-0">
          <span className="label-caps">{t.label}</span>
          <div className="flex items-end justify-between gap-2">
            <span className="flex items-baseline gap-1">
              <span className="mono text-[22px] font-medium leading-7 tracking-[-0.03em] text-fg">{t.value}</span>
              {t.unit && <span className="mono text-xs text-fg-4">{t.unit}</span>}
            </span>
            {t.trend && <Sparkline values={t.trend} />}
          </div>
          <span className="flex min-h-4 items-center gap-1.5 text-[11.5px] text-fg-3">
            {t.delta ? <Delta {...t.delta} /> : null}
            {t.note && !t.delta?.before && <span>{t.note}</span>}
            {t.note && t.delta?.before ? <span className="text-fg-4">{t.note}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function Delta({ now, before, upIsGood }: { now: number | null; before: number | null; upIsGood: boolean | null }) {
  if (now === null || before === null || before === 0) return null;
  const change = (now - before) / before;
  const pct = Math.round(change * 100);
  if (pct === 0) return <span className="mono text-fg-4">No change</span>;
  const good = pct > 0 === upIsGood;
  return (
    <span className="mono flex items-center gap-1 text-fg-2" title="Compared with the previous period">
      {upIsGood !== null && <span className={cn("size-1.5 rounded-full", good ? "bg-ok" : "bg-danger")} aria-hidden />}
      {pct > 0 ? "↑" : "↓"} {Math.abs(pct)}%
      {upIsGood !== null && <span className="sr-only">{good ? "better" : "worse"} than the previous period</span>}
    </span>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading reports">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line sm:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 px-4 py-4">
            <Skeleton className="h-2 w-14" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-2 w-10 opacity-60" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-line p-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-6 h-[220px] w-full opacity-50" />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_3fr]">
        <div className="rounded-lg border border-line p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-5 h-24 w-full opacity-50" />
        </div>
        <div className="rounded-lg border border-line p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-5 h-24 w-full opacity-50" />
        </div>
      </div>
    </div>
  );
}
