import { useBlocker } from "@tanstack/react-router";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

/** Asks before leaving a page with unsaved edits (in-app links and tab close). */
export function UnsavedGuard({ when }: { when: boolean }) {
  const { t } = useTranslation("settingsInbox");
  const b = useBlocker({
    shouldBlockFn: () => when,
    enableBeforeUnload: () => when,
    withResolver: true,
  });
  return (
    <Dialog
      open={b.status === "blocked"}
      onOpenChange={(o) => !o && b.reset?.()}
      title={t("unsaved.title")}
      description={t("unsaved.body")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => b.reset?.()}>
            {t("unsaved.keep")}
          </Button>
          <Button variant="danger-solid" onClick={() => b.proceed?.()}>
            {t("unsaved.discard")}
          </Button>
        </>
      }
    />
  );
}
