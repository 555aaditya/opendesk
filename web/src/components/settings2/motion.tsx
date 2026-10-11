// List motion for settings: rows rise in when added, fold away when removed and
// slide when reordered. Quiet and short; off under reduced motion.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const rowSpring = { type: "spring", stiffness: 500, damping: 40, mass: 0.8 } as const;

/** Wraps a list so its MotionRows animate in and out. `initial={false}` keeps the first paint still. */
export function MotionList({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {children}
    </AnimatePresence>
  );
}

/**
 * One animated row. It carries the hairline between rows itself, so the row
 * inside should not draw its own bottom border.
 */
export function MotionRow({ children, className, layoutId }: { children: ReactNode; className?: string; layoutId?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={reduce ? false : "position"}
      layoutId={layoutId}
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.99, transition: { duration: 0.14 } }}
      transition={rowSpring}
      className={cn("border-b border-line-soft last:border-0 [&>*]:border-b-0", className)}
    >
      {children}
    </motion.div>
  );
}
