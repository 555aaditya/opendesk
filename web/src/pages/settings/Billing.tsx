// Settings > Plan and billing (contracts/billing.md): the plan, seats, limits,
// AI credits and usage. Stripe Checkout and the billing portal are hosted by
// Stripe; this page only starts them and reflects billing.updated live.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowUpRight, Check, CreditCard, Server, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Section, SettingsPage } from "@/components/layout";
import { presets, RangePicker } from "@/components/reports/RangePicker";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { NumberInput } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Segmented } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { useBilling, useBuyCredits, useCanManageBilling, useCheckout, useFmt, usePortal } from "@/components/billing/hooks";
import { Meter } from "@/components/billing/Meter";
import { creditBreakdown, formatMoney, formatPrice, hasSubscription, isSelfHosted, limitState, stackDays, yearlySavings } from "@/components/billing/model";
import { UsageChart, UsageDayTable, UsageLegend } from "@/components/billing/UsageChart";
import { isApiError } from "@/lib/api/client";
import type { Billing, BillingStatus, ReportsRange } from "@/lib/api/types";
import { q, qk } from "@/lib/queries";
import { cn } from "@/lib/cn";

export default function BillingPage() {
  const { t } = useTranslation("billing");
  const { data: b, isPending, isError, refetch } = useBilling();
  const confirming = useCheckoutReturn(b);

  return (
    <SettingsPage title={t("page.title")} description={b && isSelfHosted(b) ? t("page.descriptionSelfHosted") : t("page.description")}>
      {isPending ? (
        <PageSkeleton />
      ) : isError || !b ? (
        <Section>
          <EmptyState lit={3} title={t("errors.load")} description={t("errors.loadBody")} action={<Button onClick={() => void refetch()}>{t("retry")}</Button>} />
        </Section>
      ) : isSelfHosted(b) ? (
        <>
          <SelfHosted />
          <Usage />
        </>
      ) : (
        <>
          {confirming && <Notice icon={<Spinner className="size-3.5" />} title={t("notice.confirming")} body={t("notice.confirmingBody")} />}
          <Notices b={b} />
          <PlanCard b={b} />
          {b.plan === "free" && <Upgrade b={b} />}
          {b.plan === "free" && <Limits b={b} />}
          <Credits b={b} />
          <Usage />
        </>
      )}
    </SettingsPage>
  );
}

// ─── Returning from Stripe ─────────────────────────────────────────────────

/** Handles ?checkout= and ?credits=, then waits for billing.updated to confirm. */
function useCheckoutReturn(b: Billing | undefined) {
  const { t } = useTranslation("billing");
  const search = useSearch({ from: "/app/settings/billing" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const creditsBase = useRef<number | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || (!search.checkout && !search.credits)) return;
    handled.current = true;
    if (search.checkout === "success") setConfirming(true);
    else if (search.checkout === "cancel") toast.info(t("toast.checkoutCancel"));
    if (search.credits === "success") {
      creditsBase.current = qc.getQueryData<Billing>(qk.billing)?.credits.purchased ?? 0;
      toast.info(t("toast.creditsPending"));
    }
    void qc.invalidateQueries({ queryKey: qk.billing });
    void navigate({ to: "/settings/billing", search: {}, replace: true });
  }, [search.checkout, search.credits, navigate, qc, t]);

  // The webhook may land after the customer is back; billing.updated (or a refetch) confirms it.
  useEffect(() => {
    if (!b) return;
    if (confirming && b.plan === "pro") {
      setConfirming(false);
      toast.success(t("toast.pro"), { description: t("toast.proBody") });
    }
    if (creditsBase.current !== null && b.credits.purchased > creditsBase.current) {
      creditsBase.current = null;
      toast.success(t("toast.credits"), { description: t("toast.creditsBody") });
    }
  }, [b, confirming, t]);

  useEffect(() => {
    if (!confirming) return;
    const poll = setInterval(() => void qc.invalidateQueries({ queryKey: qk.billing, exact: true }), 4000);
    const stop = setTimeout(() => setConfirming(false), 45_000);
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, [confirming, qc]);

  return confirming;
}

// ─── Pieces ────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-hidden>
      {[132, 96, 220].map((h, i) => (
        <div key={i} className="rounded-lg border border-line p-4" style={{ height: h }}>
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-4 h-5 w-32" />
          <Skeleton className="mt-3 h-2.5 w-[60%]" />
        </div>
      ))}
    </div>
  );
}

function Notice({ icon, title, body, action }: { icon: ReactNode; title: ReactNode; body: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-line bg-sunken/60 px-4 py-3">
      <span className="mt-[3px] flex shrink-0 text-fg-3">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-[18px] text-fg-3">{body}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function Notices({ b }: { b: Billing }) {
  const { t } = useTranslation("billing");
  const fmt = useFmt();
  const canManage = useCanManageBilling();
  const portal = usePortal();
  const portalButton = (label: string) =>
    canManage && hasSubscription(b) ? (
      <Button size="sm" loading={portal.isPending} onClick={() => portal.mutate()}>
        {label}
      </Button>
    ) : undefined;
  return (
    <>
      {b.status === "past_due" && (
        <Notice
          icon={<span className="block size-1.5 translate-y-[3px] rounded-full bg-warn" />}
          title={t("notice.pastDueTitle")}
          body={t("notice.pastDueBody")}
          action={portalButton(t("notice.updatePayment"))}
        />
      )}
      {b.cancel_at_period_end && b.current_period_end && (
        <Notice
          icon={<span className="block size-1.5 translate-y-[3px] rounded-full bg-fg-4" />}
          title={t("notice.cancelTitle", { date: fmt.date(b.current_period_end) })}
          body={t("notice.cancelBody")}
          action={portalButton(t("notice.resume"))}
        />
      )}
    </>
  );
}

const statusTone: Partial<Record<BillingStatus, "ok" | "warn" | "danger" | "neutral">> = {
  active: "ok",
  trialing: "ok",
  past_due: "warn",
  unpaid: "danger",
  incomplete: "warn",
};

function Fact({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label-caps mb-1">{label}</div>
      <div className="mono truncate text-[13px] text-fg">{value}</div>
      {hint && <div className="mt-1 text-[11.5px] leading-4 text-fg-4">{hint}</div>}
    </div>
  );
}

function PlanCard({ b }: { b: Billing }) {
  const { t } = useTranslation("billing");
  const fmt = useFmt();
  const canManage = useCanManageBilling();
  const portal = usePortal();
  const pro = b.plan === "pro";
  const price = b.interval === "year" ? b.prices.pro_year : b.prices.pro_month;

  return (
    <Section flush>
      <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-4">
        <div className="min-w-0">
          <div className="label-caps">{t("plan.current")}</div>
          <div className="mt-1.5 flex items-center gap-2.5">
            <span className="text-[22px] font-semibold leading-7 tracking-[-0.03em]">{t(`plans.${b.plan}`)}</span>
            {pro && b.status !== "none" && (
              <Badge tone={b.cancel_at_period_end ? "neutral" : (statusTone[b.status] ?? "neutral")} dot>
                {b.cancel_at_period_end && b.current_period_end ? t("status.ending", { date: fmt.date(b.current_period_end) }) : t(`status.${b.status as Exclude<BillingStatus, "none">}`)}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[12.5px] text-fg-3">{pro ? t("plan.proSummary") : t("plan.freeSummary")}</p>
        </div>
        {canManage && hasSubscription(b) && (
          <Button icon={<CreditCard className="size-3.5 text-fg-3" />} iconRight={<ArrowUpRight className="size-3 text-fg-4" />} loading={portal.isPending} onClick={() => portal.mutate()}>
            {t("plan.manage")}
          </Button>
        )}
      </div>
      {pro && (
        <div className="grid grid-cols-1 gap-4 border-t border-line-soft px-5 py-3.5 sm:grid-cols-3">
          <Fact
            label={t("plan.seats")}
            value={t("plan.seatsValue", { count: b.seats })}
            hint={b.billed_seats !== b.seats ? t("plan.seatsNext", { count: b.billed_seats }) : t("plan.seatsHint")}
          />
          <Fact
            label={t("plan.price")}
            value={
              price
                ? b.interval === "year"
                  ? t("plan.perSeatYear", { price: formatPrice(price, fmt.locale) })
                  : t("plan.perSeatMonth", { price: formatPrice(price, fmt.locale) })
                : "–"
            }
          />
          <Fact
            label={b.cancel_at_period_end ? t("plan.endsLabel") : t("plan.renewsLabel")}
            value={b.current_period_end ? fmt.date(b.current_period_end) : "–"}
            hint={canManage ? t("plan.manageHint") : t("plan.readOnly")}
          />
        </div>
      )}
      {!pro && !canManage && <div className="border-t border-line-soft px-5 py-3 text-[12.5px] text-fg-3">{t("plan.readOnly")}</div>}
    </Section>
  );
}

function Upgrade({ b }: { b: Billing }) {
  const { t } = useTranslation("billing");
  const fmt = useFmt();
  const canManage = useCanManageBilling();
  const checkout = useCheckout();
  const month = b.prices.pro_month;
  const year = b.prices.pro_year;
  const [interval, setBillingInterval] = useState<"month" | "year">("month");
  const save = yearlySavings(month, year);
  const price = interval === "year" ? year : month;
  const seats = Math.max(1, b.billed_seats);
  if (!canManage) return null;

  return (
    <Section title={t("upgrade.title")} description={t("upgrade.description")} flush>
      <div className="grid gap-0 sm:grid-cols-[1fr_auto]">
        <div className="px-5 py-4">
          {year && (
            <Segmented
              value={interval}
              onChange={setBillingInterval}
              options={[
                { value: "month", label: t("upgrade.monthly") },
                {
                  value: "year",
                  label: (
                    <span className="flex items-center gap-1.5">
                      {t("upgrade.yearly")}
                      {save && <span className="mono text-[10.5px] font-normal text-fg-3">{t("upgrade.save", { pct: save })}</span>}
                    </span>
                  ),
                },
              ]}
            />
          )}
          {price && (
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{formatPrice(price, fmt.locale)}</span>
              <span className="text-[12.5px] text-fg-3">
                {t("upgrade.perSeat")} {interval === "year" ? t("upgrade.perYear") : t("upgrade.perMonth")}
              </span>
            </div>
          )}
          {price && (
            <p className="mono mt-2 text-[11.5px] text-fg-4">
              {t("upgrade.estimate", {
                count: seats,
                total: formatMoney(price.unit_amount * seats, price.currency, fmt.locale),
                per: interval === "year" ? t("upgrade.perYear") : t("upgrade.perMonth"),
              })}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="md" loading={checkout.isPending} onClick={() => checkout.mutate(interval)}>
              {checkout.isPending ? t("upgrade.redirecting") : interval === "year" ? t("upgrade.ctaYearly") : t("upgrade.cta")}
            </Button>
            <span className="text-[11.5px] text-fg-4">{t("upgrade.secure")}</span>
          </div>
        </div>
        <ul className="flex flex-col justify-center gap-2 border-t border-line-soft px-5 py-4 sm:border-l sm:border-t-0 sm:pr-8">
          {(["mailboxes", "members", "credits", "same"] as const).map((k) => (
            <li key={k} className="flex items-center gap-2 text-[12.5px] text-fg-2">
              {k === "credits" ? <Sparkles className="size-3.5 text-fg-3" strokeWidth={1.75} /> : <Check className="size-3.5 text-fg-3" strokeWidth={2} />}
              {t(`upgrade.benefit.${k}`)}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Limits({ b }: { b: Billing }) {
  const { t } = useTranslation("billing");
  const rows = [
    { kind: "mailboxes" as const, label: t("limits.mailboxes"), hint: undefined },
    { kind: "members" as const, label: t("limits.members"), hint: t("limits.membersHint") },
  ];
  return (
    <Section title={t("limits.title")} description={t("limits.description")}>
      {rows.map((r) => {
        const l = limitState(b, r.kind);
        return (
          <div key={r.kind} className="flex items-center gap-4 border-b border-line-soft py-3.5 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{r.label}</div>
              <div className="mt-0.5 text-[12.5px] leading-[18px] text-fg-3">{l.over ? t("limits.over") : r.hint}</div>
            </div>
            <Meter value={l.used} max={l.max} label={`${r.label}: ${t("limits.of", { used: l.used, max: l.max })}`} className="hidden w-24 sm:block" />
            <span className={cn("mono w-24 whitespace-nowrap text-right text-[12.5px] tabular-nums", l.atLimit ? "text-fg" : "text-fg-2")}>
              {!l.limited ? t("limits.unlimited") : l.over ? t("limits.overOf", { used: l.used, max: l.max }) : t("limits.of", { used: l.used, max: l.max })}
            </span>
          </div>
        );
      })}
    </Section>
  );
}

function Credits({ b }: { b: Billing }) {
  const { t } = useTranslation("billing");
  const fmt = useFmt();
  const canManage = useCanManageBilling();
  const buy = useBuyCredits();
  const [packs, setPacks] = useState(1);
  const c = creditBreakdown(b.credits);
  const pack = b.prices.credit_pack;
  const perPack = pack?.credits ?? 2000;

  return (
    <Section title={t("credits.title")} description={t("credits.description")} flush>
      <div className="grid gap-5 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{fmt.num(c.remaining)}</span>
            <span className="text-[12.5px] text-fg-3">{t("credits.remaining")}</span>
            {c.low && <span className="size-1.5 self-center rounded-full bg-warn" aria-hidden />}
          </div>
          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]">
              <span className="text-fg-2">{t("credits.monthly")}</span>
              <span className="mono text-fg-3 tabular-nums">{t("credits.monthlyUsed", { used: fmt.num(c.monthlyUsed), total: fmt.num(c.monthly) })}</span>
            </div>
            <Meter value={c.monthlyUsed} max={c.monthly} label={t("credits.meterLabel", { used: c.monthlyUsed, total: c.monthly })} className="h-1.5" />
            <div className="mono mt-1.5 text-[11px] text-fg-4">{t("credits.resets", { date: fmt.date(b.credits.period_end) })}</div>
          </div>
          {c.low && <p className="mt-3 text-[12.5px] text-fg-2">{t("credits.low")}</p>}
        </div>
        <div className="flex gap-6 sm:flex-col sm:gap-3 sm:border-l sm:border-line-soft sm:pl-6">
          <Fact label={t("credits.purchased")} value={fmt.num(c.purchased)} hint={t("credits.purchasedHint")} />
        </div>
      </div>
      {canManage && pack && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-soft px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{t("credits.buyTitle")}</div>
            <div className="mono mt-0.5 text-[11.5px] text-fg-3">{t("credits.packSize", { credits: fmt.num(perPack) })}</div>
          </div>
          <NumberInput value={packs} onChange={(n) => setPacks(Math.max(1, Math.min(20, Math.round(n) || 1)))} min={1} max={20} aria-label={t("credits.packs")} className="w-[76px]" />
          <span className="mono whitespace-nowrap text-right text-[12px] text-fg-2 tabular-nums">
            {t("credits.packTotal", { credits: fmt.num(perPack * packs), price: formatPrice(pack, fmt.locale, packs) })}
          </span>
          <Button loading={buy.isPending} onClick={() => buy.mutate(packs)}>
            {t("credits.buy")}
          </Button>
        </div>
      )}
    </Section>
  );
}

function SelfHosted() {
  const { t } = useTranslation("billing");
  return (
    <Section flush>
      <div className="flex items-start gap-4 px-5 py-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken text-fg-2">
          <Server className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold tracking-[-0.01em]">{t("selfHosted.title")}</div>
          <p className="mt-1 max-w-[520px] text-[12.5px] leading-[19px] text-fg-3">{t("selfHosted.body")}</p>
          <ul className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1.5">
            {(["mailboxes", "members", "ai"] as const).map((k) => (
              <li key={k} className="flex items-center gap-1.5 text-[12.5px] text-fg-2">
                {k === "ai" ? <Sparkles className="size-3.5 text-fg-3" strokeWidth={1.75} /> : <Check className="size-3.5 text-fg-3" strokeWidth={2} />}
                {t(`selfHosted.${k}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

// ─── Usage ─────────────────────────────────────────────────────────────────

function Usage() {
  const { t } = useTranslation("billing");
  const fmt = useFmt();
  const canManage = useCanManageBilling();
  const [range, setRange] = useState<ReportsRange>(() => presets()[1].range);
  const [asTable, setAsTable] = useState(false);
  const { data, isPending, isError, error, refetch } = useQuery({ ...q.billingUsage(range), enabled: canManage, retry: (n, e) => !isApiError(e, "billing_disabled") && n < 2 });
  const stacked = useMemo(() => (data ? stackDays(data) : null), [data]);

  if (!canManage) return null;
  // Instances without Stripe don't serve usage (404 billing_disabled).
  if (isError && isApiError(error, "billing_disabled")) return null;

  const total = data?.total.credits ?? 0;
  return (
    <Section
      title={t("usage.title")}
      description={t("usage.description")}
      actions={<RangePicker value={range} onChange={setRange} />}
      flush
    >
      {isPending ? (
        <div className="px-5 py-5" aria-hidden>
          <Skeleton className="h-2.5 w-28" />
          <Skeleton className="mt-5 h-[180px] w-full rounded-md" />
        </div>
      ) : isError || !data || !stacked ? (
        <EmptyState compact lit={3} title={t("usage.error")} action={<Button onClick={() => void refetch()}>{t("retry")}</Button>} />
      ) : total === 0 ? (
        <EmptyState compact lit={0} title={t("usage.empty")} description={t("usage.emptyBody")} />
      ) : (
        <>
          <div className="px-5 pb-3 pt-4">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-baseline gap-5">
                <div>
                  <div className="label-caps mb-1">{t("usage.total")}</div>
                  <div className="text-[20px] font-semibold leading-6 tracking-[-0.02em] tabular-nums">{fmt.num(total)}</div>
                </div>
                <div>
                  <div className="label-caps mb-1">{t("usage.calls")}</div>
                  <div className="text-[20px] font-semibold leading-6 tracking-[-0.02em] tabular-nums text-fg-3">{fmt.num(data.total.calls)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <UsageLegend series={stacked.series} />
                <Button size="xs" variant="ghost" onClick={() => setAsTable((v) => !v)}>
                  {asTable ? t("usage.chart") : t("usage.table")}
                </Button>
              </div>
            </div>
            {asTable ? <UsageDayTable days={stacked.days} series={stacked.series} /> : <UsageChart days={stacked.days} series={stacked.series} />}
          </div>
          <div className="grid border-t border-line-soft md:grid-cols-2">
            <Breakdown
              title={t("usage.byFeature")}
              rows={data.by_feature.map((f) => ({ key: f.feature, label: t(`features.${f.feature}`), calls: f.calls, credits: f.credits }))}
              total={total}
            />
            <Breakdown
              title={t("usage.byMember")}
              className="border-t border-line-soft md:border-l md:border-t-0"
              rows={data.by_member.map((m) => ({
                key: m.user?.id ?? "widget",
                label: m.user?.name ?? t("usage.widget"),
                icon: m.user ? <Avatar name={m.user.name} src={m.user.avatar_url} size="xs" /> : <span className="flex size-4 items-center justify-center rounded-full border border-line"><Sparkles className="size-2.5 text-fg-3" /></span>,
                calls: m.calls,
                credits: m.credits,
              }))}
              total={total}
            />
          </div>
        </>
      )}
    </Section>
  );
}

function Breakdown({
  title,
  rows,
  total,
  className,
}: {
  title: string;
  rows: { key: string; label: string; icon?: ReactNode; calls: number; credits: number }[];
  total: number;
  className?: string;
}) {
  const { t } = useTranslation("billing");
  const fmt = useFmt();
  const max = Math.max(1, ...rows.map((r) => r.credits));
  return (
    <div className={cn("min-w-0 px-5 py-3.5", className)}>
      <table className="w-full text-[12.5px]">
        <caption className="mb-1 text-left">
          <span className="label-caps">{title}</span>
        </caption>
        <thead>
          <tr className="text-left">
            <th className="sr-only">{title}</th>
            <th className="w-16 pb-1 text-right text-[10.5px] font-normal text-fg-4">{t("usage.calls")}</th>
            <th className="w-16 pb-1 text-right text-[10.5px] font-normal text-fg-4">{t("usage.total")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.key} title={`${r.label}: ${total ? Math.round((r.credits / total) * 100) : 0}%`}>
              <td className="max-w-0 py-1.5 pr-3">
                <span className="flex min-w-0 items-center gap-2">
                  {r.icon}
                  <span className="truncate text-fg-2">{r.label}</span>
                </span>
                <div className="mt-1 h-[3px] rounded-full bg-hover">
                  <div className="h-full rounded-full bg-fg-3" style={{ width: `${(r.credits / max) * 100}%` }} />
                </div>
              </td>
              <td className="mono py-1.5 text-right align-top tabular-nums text-fg-4">{fmt.num(r.calls)}</td>
              <td className="mono py-1.5 text-right align-top tabular-nums">{fmt.num(r.credits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
