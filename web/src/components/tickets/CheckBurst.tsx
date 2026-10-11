// A short celebratory check: a green tile pops in and a ring of small dots
// flies out once. Used when a ticket is solved and for inbox zero. Under
// reduced motion only the check shows, without movement.

import { motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { dur, ease, springs } from "@/lib/motion";
import { tone } from "@/lib/tones";

const DOTS = 8;

export function CheckBurst({ size = 28, className, dots = true }: { size?: number; className?: string; dots?: boolean }) {
  const reduce = useReducedMotion();
  const r = size * 0.95;
  return (
    <span aria-hidden className={cn("pointer-events-none relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      {dots &&
        !reduce &&
        Array.from({ length: DOTS }).map((_, i) => {
          const a = (i / DOTS) * Math.PI * 2;
          return (
            <motion.span
              key={i}
              className={cn("absolute size-1 rounded-full", i % 2 ? tone.green.solid : tone.teal.solid)}
              initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
              animate={{ x: Math.cos(a) * r, y: Math.sin(a) * r, opacity: [0, 1, 0], scale: [0.4, 1, 0.6] }}
              transition={{ duration: dur.slow * 2, ease: ease.out, delay: 0.04 }}
            />
          );
        })}
      <motion.span
        className={cn("flex items-center justify-center rounded-md", tone.green.chip)}
        style={{ width: size, height: size }}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduce ? { duration: dur.fast } : springs.snap}
      >
        <Check style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={2.5} />
      </motion.span>
    </span>
  );
}
