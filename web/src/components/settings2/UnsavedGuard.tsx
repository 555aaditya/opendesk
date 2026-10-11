import { useBlocker } from "@tanstack/react-router";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Asks before leaving a page with unsaved edits (in-app links and tab close). */
export function UnsavedGuard({ when }: { when: boolean }) {
  const b = useBlocker({ shouldBlockFn: () => when, enableBeforeUnload: () => when, withResolver: true });
  return (
    <Dialog
      open={b.status === "blocked"}
      onOpenChange={(o) => !o && b.reset?.()}
      title="Leave without saving?"
      description="Your changes on this page will be lost."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => b.reset?.()}>
            Keep editing
          </Button>
          <Button variant="danger-solid" onClick={() => b.proceed?.()}>
            Discard changes
          </Button>
        </>
      }
    />
  );
}
