import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Floats at the bottom of a settings page while there are unsaved changes. */
export function SaveBar({
  dirty,
  saving,
  disabled,
  onSave,
  onDiscard,
  message,
}: {
  dirty: boolean;
  saving?: boolean;
  disabled?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  message?: string;
}) {
  const { t } = useTranslation("settings");
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {dirty && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { y: 12, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { y: 12, opacity: 0, scale: 0.98 }}
          transition={reduce ? { duration: 0.12 } : { type: "spring", stiffness: 500, damping: 40 }}
          className="pointer-events-none sticky bottom-5 z-20 flex justify-center"
        >
          <div role="region" aria-label={t("saveBar.region")} className="pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-raised py-1.5 pl-3.5 pr-1.5 shadow-float">
            <span className="size-1.5 animate-pulse-soft rounded-full bg-tone-amber-solid motion-reduce:animate-none" aria-hidden />
            <span className="text-[12.5px] text-fg-2">{message ?? t("saveBar.message")}</span>
            <Button size="sm" variant="ghost" onClick={onDiscard} disabled={saving}>
              {t("saveBar.discard")}
            </Button>
            <Button size="sm" variant="primary" onClick={onSave} loading={saving} disabled={disabled}>
              {t("saveBar.save")}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
