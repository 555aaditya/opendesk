// Settings > Plan and billing > Auto-recharge (contracts/billing.md "Auto-recharge").
// The switch saves at once; stepper edits save together after a short pause.
// Both are optimistic (the billing cache changes first and rolls back on error).

import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Row, Section } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Stepper } from "@/components/settings2/Stepper";
import { isApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import type { AutoRechargePatch, Billing } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/queries";
import { tone, type Tone } from "@/lib/tones";
import { RESUME_AUTO_RECHARGE_KEY, useAddPaymentMethod, useAutoRecharge, useCanManageBilling, useFmt } from "./hooks";
import { CREDIT_PACK_SIZE, formatMoney, rechargeQuote, withPatch } from "./model";

const SAVE_DELAY = 600;

export function AutoRechargeSection({ b }: { b: Billing }) {
  const { t } = useTranslation("billing");
  const fmt = useFmt();
  const qc = useQueryClient();
  const canManage = useCanManageBilling();
  const save = useAutoRecharge();
  const addCard = useAddPaymentMethod();
  const [needsCard, setNeedsCard] = useState(false);
  const [draft, setDraft] = useState<AutoRechargePatch>({});
  const pending = useRef<AutoRechargePatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Leaving the page within the pause still saves the last edit.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const p = pending.current;
      if (Object.keys(p).length === 0) return;
      pending.current = {};
      void api.billing
        .autoRecharge(p)
        .then((next) => qc.setQueryData(qk.billing, next))
        .catch(() => qc.invalidateQueries({ queryKey: qk.billing, exact: true }));
    },
    [qc],
  );

  const ar = b.auto_recharge;
  const pack = b.prices.credit_pack;
  if (!ar || !pack || !canManage) return null;
  const v = withPatch(ar, draft);

  const flush = (extra: AutoRechargePatch = {}) => {
    clearTimeout(timer.current);
    const p = { ...pending.current, ...extra };
    pending.current = {};
    setDraft({});
    if (Object.keys(p).length === 0) return;
    save.mutate(p, {
      onError: (e) => {
        if (isApiError(e, "payment_method_required")) setNeedsCard(true);
      },
    });
  };
  const edit = (patch: AutoRechargePatch) => {
    pending.current = { ...pending.current, ...patch };
    setDraft(pending.current);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), SAVE_DELAY);
  };
  const toggle = (enabled: boolean) => {
    if (!enabled) setNeedsCard(false);
    flush({ enabled });
  };
  const goAddCard = () => {
    try {
      sessionStorage.setItem(RESUME_AUTO_RECHARGE_KEY, JSON.stringify({ enabled: true, threshold: v.threshold, packs: v.packs, monthly_limit: v.monthly_limit }));
    } catch {
      /* private mode: the customer turns it on again after adding the card */
    }
    addCard.mutate();
  };

  const quote = rechargeQuote(pack, v.packs, fmt.locale);
  // One recharge must lift the balance back above the threshold, so each bounds the other.
  const size = pack.credits ?? CREDIT_PACK_SIZE;
  const maxThreshold = Math.max(50, Math.min(100000, v.packs * size - 50));
  const minPacks = Math.min(20, Math.floor(v.threshold / size) + 1);
  const monthMax = quote.amount !== null ? formatMoney(quote.amount * v.monthly_limit, pack.currency, fmt.locale) : null;
  const last = ar.last_recharge;
  const failure = !v.enabled ? ar.failure : null;

  return (
    <div id="auto-recharge" className="scroll-mt-6">
      <Section
        title={t("autoRecharge.title")}
        description={t("autoRecharge.description")}
        actions={
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-fg-3">
            {v.enabled ? t("autoRecharge.on") : t("autoRecharge.off")}
            <Switch checked={v.enabled} onCheckedChange={toggle} aria-label={t("autoRecharge.toggle")} />
          </label>
        }
      >
        {failure && (
          <Callout
            hue="red"
            icon={<CreditCard className="size-3.5" />}
            title={t("autoRecharge.failedTitle", { date: fmt.date(failure.at) })}
            body={t(`autoRecharge.failure.${failure.code}`)}
            action={
              failure.code !== "unavailable" ? (
                <Button size="sm" loading={addCard.isPending} onClick={goAddCard}>
                  {t("autoRecharge.addCard")}
                </Button>
              ) : undefined
            }
          />
        )}
        {needsCard && !v.enabled && !failure && (
          <Callout
            hue="amber"
            icon={<CreditCard className="size-3.5" />}
            title={t("autoRecharge.needCardTitle")}
            body={t("autoRecharge.needCardBody")}
            action={
              <Button size="sm" variant="primary" loading={addCard.isPending} onClick={goAddCard}>
                {t("autoRecharge.addCard")}
              </Button>
            }
          />
        )}
        <Row label={t("autoRecharge.threshold")} description={t("autoRecharge.thresholdHint")}>
          <Stepper
            value={v.threshold}
            onChange={(threshold) => edit({ threshold })}
            min={50}
            max={maxThreshold}
            step={50}
            suffix={t("autoRecharge.thresholdSuffix")}
            aria-label={t("autoRecharge.threshold")}
            className="w-[176px]"
          />
        </Row>
        <Row label={t("autoRecharge.packs")} description={quote.price ? t("autoRecharge.packsQuote", { credits: fmt.num(quote.credits), price: quote.price }) : undefined}>
          <Stepper value={v.packs} onChange={(packs) => edit({ packs })} min={minPacks} max={20} aria-label={t("autoRecharge.packs")} className="w-[120px]" />
        </Row>
        <Row label={t("autoRecharge.limit")} description={monthMax ? t("autoRecharge.limitHint", { amount: monthMax }) : t("autoRecharge.limitHintNoPrice")}>
          <Stepper
            value={v.monthly_limit}
            onChange={(monthly_limit) => edit({ monthly_limit })}
            min={1}
            max={30}
            suffix={t("autoRecharge.limitSuffix")}
            aria-label={t("autoRecharge.limit")}
            className="w-[176px]"
          />
        </Row>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-[12px]">
          <span className="flex min-w-0 items-center gap-2 text-fg-3">
            <RefreshCw className="size-3 shrink-0 text-fg-4" aria-hidden />
            <span className="truncate">
              {last
                ? t("autoRecharge.last", { date: fmt.date(last.at), credits: fmt.num(last.credits), price: formatMoney(last.amount, last.currency, fmt.locale) })
                : v.enabled
                  ? t("autoRecharge.none")
                  : t("autoRecharge.offHint")}
            </span>
          </span>
          {v.enabled && (
            <span className="mono shrink-0 text-[11.5px] tabular-nums text-fg-4">
              {t("autoRecharge.thisMonth", { used: v.recharges_this_month, limit: v.monthly_limit })}
            </span>
          )}
        </div>
      </Section>
    </div>
  );
}

function Callout({ hue, icon, title, body, action }: { hue: Tone; icon: ReactNode; title: ReactNode; body: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className={cn("-mx-4 flex animate-rise-in items-start gap-3 border-b px-4 py-3 motion-reduce:animate-none", tone[hue].soft, tone[hue].line)}>
      <span className={cn("mt-[2px] flex shrink-0", tone[hue].text)}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium">{title}</div>
        <div className="mt-0.5 text-[12px] leading-[18px] text-fg-3">{body}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
