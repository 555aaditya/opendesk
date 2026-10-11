// The one upgrade prompt for 402 plan_limit and no_credits, wherever they
// happen. Calm: it explains the limit, then offers the next step.

import { Link } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpgrade, upgrade } from "@/lib/upgrade";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useBilling, useBuyCredits, useCanManageBilling, useCheckout, useFmt } from "./hooks";
import { formatPrice } from "./model";

export default function UpgradeDialog() {
  const { t } = useTranslation("billing");
  const reason = useUpgrade((s) => s.reason);
  const { data: b } = useBilling();
  const canManage = useCanManageBilling();
  const checkout = useCheckout();
  const buy = useBuyCredits();
  const fmt = useFmt();
  if (!reason) return null;

  const credits = reason.code === "no_credits";
  const month = b?.prices.pro_month ?? null;
  const pack = b?.prices.credit_pack ?? null;
  const onFree = !b || b.plan === "free";
  const price = month ? formatPrice(month, fmt.locale) : null;

  const body = credits
    ? b?.credits.period_end
      ? t("dialog.creditsBody", { date: fmt.date(b.credits.period_end) })
      : t("dialog.creditsBodyNoDate")
    : price
      ? t("dialog.limitBody", { price })
      : t("dialog.limitBodyNoPrice");

  const close = () => upgrade.close();
  const busy = checkout.isPending || buy.isPending;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      size="sm"
      title={credits ? t("dialog.creditsTitle") : t("dialog.limitTitle")}
      footer={
        canManage && b?.billing_enabled ? (
          <>
            <Button variant="ghost" asChild onClick={close}>
              <Link to="/settings/billing">{t("dialog.seePlans")}</Link>
            </Button>
            {credits && pack && (
              <Button variant={onFree ? "secondary" : "primary"} loading={buy.isPending} disabled={busy} onClick={() => buy.mutate(1)}>
                {t("dialog.buyPack", { credits: fmt.num(pack.credits ?? 2000) })}
              </Button>
            )}
            {onFree && (
              <Button variant="primary" loading={checkout.isPending} disabled={busy} onClick={() => checkout.mutate("month")}>
                {t("upgrade.cta")}
              </Button>
            )}
          </>
        ) : (
          <Button variant="primary" onClick={close}>
            {t("dialog.notNow")}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3.5 pb-1">
        {!credits && reason.detail && <p className="text-[13px] leading-5 text-fg">{reason.detail}</p>}
        <p className="text-[12.5px] leading-[19px] text-fg-3">{body}</p>
        {credits && !onFree && <p className="text-[12.5px] text-fg-3">{t("dialog.creditsPro")}</p>}
        {onFree && (
          <ul className="flex flex-col gap-1.5 rounded-md border border-line bg-sunken/50 px-3 py-2.5">
            {(["mailboxes", "members", "credits"] as const).map((k) => (
              <li key={k} className="flex items-center gap-2 text-[12.5px] text-fg-2">
                {k === "credits" ? <Sparkles className="size-3.5 text-fg-3" strokeWidth={1.75} /> : <Check className="size-3.5 text-fg-3" strokeWidth={2} />}
                {t(`upgrade.benefit.${k}`)}
              </li>
            ))}
          </ul>
        )}
        {(!canManage || !b?.billing_enabled) && <p className="text-[12.5px] text-fg-3">{credits ? t("dialog.askAdminCredits") : t("dialog.askAdmin")}</p>}
      </div>
    </Dialog>
  );
}
