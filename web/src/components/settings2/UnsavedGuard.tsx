import { useBlocker } from "@tanstack/react-router";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

/**
 * Asks before leaving a page with unsaved edits (in-app links and tab close).
 * `allow` lets some destinations through, for pages that keep the draft.
 */
export function UnsavedGuard({ when, allow }: { when: boolean; allow?: (pathname: string) => boolean }) {
  const { t } = useTranslation("settingsInbox");
  const b = useBlocker({
    shouldBlockFn: ({ next }) => when && !allow?.(next.pathname),
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
