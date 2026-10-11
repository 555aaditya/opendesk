// A slim banner at the top of the work panel when the live connection drops
// after having been up, and a short "back" line when it returns. The header's
// connection dot stays the steady indicator; this only speaks up on change.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRealtime } from "@/lib/realtime/store";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { tone } from "@/lib/tones";

type Shown = "lost" | "back" | null;

export function ConnectionBanner() {
  const { t } = useTranslation("shell");
  const status = useRealtime((s) => s.status);
  const reduce = useReducedMotion();
  const wasLive = useRef(false);
  const [shown, setShown] = useState<Shown>(null);

  useEffect(() => {
    if (status === "live") {
      if (wasLive.current && shown === "lost") {
        setShown("back");
        const id = setTimeout(() => setShown(null), 2500);
        return () => clearTimeout(id);
      }
      wasLive.current = true;
      return;
    }
    if (wasLive.current && (status === "reconnecting" || status === "offline")) {
      // A blip under a second and a half is not worth a banner.
      const id = setTimeout(() => setShown("lost"), 1500);
      return () => clearTimeout(id);
    }
  }, [status, shown]);

  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          key={shown}
          role="status"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={springs.row}
          className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center"
        >
          <span
            className={cn(
              "inline-flex h-7 items-center gap-2 rounded-md px-2.5 text-[12px] font-medium shadow-float",
              shown === "lost" ? tone.amber.chip : tone.green.chip,
              "bg-raised",
            )}
          >
            <span className={cn("size-1.5 rounded-full", shown === "lost" ? cn(tone.amber.solid, "animate-pulse-soft") : tone.green.solid)} />
            {shown === "lost" ? t("connection.lost") : t("connection.back")}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
