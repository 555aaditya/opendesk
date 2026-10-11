import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";

/** Floats at the bottom of a settings page while there are unsaved changes. */
export function SaveBar({
  dirty,
  saving,
  disabled,
  onSave,
  onDiscard,
  message = "You have unsaved changes",
}: {
  dirty: boolean;
  saving?: boolean;
  disabled?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  message?: string;
}) {
  return (
    <AnimatePresence>
      {dirty && (
        <motion.div
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 16, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none sticky bottom-5 z-20 flex justify-center"
        >
          <div role="region" aria-label="Unsaved changes" className="pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-raised py-1.5 pl-3.5 pr-1.5 shadow-float">
            <span className="size-1.5 rounded-full bg-warn" aria-hidden />
            <span className="text-[12.5px] text-fg-2">{message}</span>
            <Button size="sm" variant="ghost" onClick={onDiscard} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" variant="primary" onClick={onSave} loading={saving} disabled={disabled}>
              Save changes
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
