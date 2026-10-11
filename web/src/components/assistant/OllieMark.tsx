// Ollie's mark. A soft violet blob with light swirling inside and two small eyes:
// it breathes at rest, squishes when the pointer arrives (the shine and the eyes
// follow the pointer), boops on each composer keystroke when it `listen`s, swirls
// faster while working, hops in amber while a change waits for approval, and
// bounces in green when a run finishes. `variant="spark"` is a 3x3 pixel spark
// for inline loaders. Reduced motion stills all of it. Styles live in ollie.css.

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { onOlliePulse } from "./pulse";
import "./ollie.css";

export type OllieState = "idle" | "thinking" | "attention";

type Props = {
  size?: number;
  state?: OllieState;
  /** muted greys a resting mark that should not compete. */
  tone?: "color" | "muted";
  /** Boop on composer keystrokes. */
  listen?: boolean;
  /** Whether a run ending now went well; only then does Ollie cheer. */
  celebrate?: boolean;
  /** Show the eyes (on by default from 14px). */
  eyes?: boolean;
  variant?: "blob" | "spark";
  className?: string;
};

export function OllieMark({ variant = "blob", ...props }: Props) {
  return variant === "spark" ? <OllieSpark {...props} /> : <OllieBlob {...props} />;
}

/** True for a moment after a run finishes well. */
function useCheer(state: OllieState, celebrate: boolean) {
  const [on, setOn] = useState(false);
  const prev = useRef(state);
  useEffect(() => {
    if (prev.current === "thinking" && state === "idle" && celebrate) setOn(true);
    prev.current = state;
  }, [state, celebrate]);
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setOn(false), 1500);
    return () => window.clearTimeout(t);
  }, [on]);
  return on && state === "idle";
}

/** Restarts a one-shot animation class without a render. */
function replay(el: HTMLElement | null, cls: string) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function OllieBlob({ size = 18, state = "idle", tone = "color", listen = false, celebrate = true, eyes, className }: Omit<Props, "variant">) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const cheer = useCheer(state, celebrate);

  useEffect(() => {
    if (!listen || reduce) return;
    return onOlliePulse(() => replay(ref.current, "ollie-boop"));
  }, [listen, reduce]);

  // Squish on arrival; the shine and eyes follow the pointer. Written to the
  // element directly, so moving the pointer never renders.
  useEffect(() => {
    const el = ref.current;
    if (!el || reduce) return;
    const host = (el.closest(".ollie-host") as HTMLElement | null) ?? el;
    const enter = () => replay(el, "ollie-squish");
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      el.style.setProperty("--ollie-sx", `${Math.round(8 + x * 52)}%`);
      el.style.setProperty("--ollie-sy", `${Math.round(8 + y * 46)}%`);
      el.style.setProperty("--ollie-lx", `${((x - 0.5) * 0.12).toFixed(3)}em`);
      el.style.setProperty("--ollie-ly", `${((y - 0.5) * 0.1).toFixed(3)}em`);
    };
    const leave = () => {
      for (const p of ["--ollie-sx", "--ollie-sy", "--ollie-lx", "--ollie-ly"]) el.style.removeProperty(p);
    };
    const end = (e: AnimationEvent) => {
      if (e.animationName === "ollie-squish") el.classList.remove("ollie-squish");
      if (e.animationName === "ollie-boop") el.classList.remove("ollie-boop");
    };
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    el.addEventListener("animationend", end);
    return () => {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      el.removeEventListener("animationend", end);
    };
  }, [reduce]);

  const look = cheer ? "done" : tone === "muted" && state === "idle" ? "muted" : state;
  const showEyes = eyes ?? size >= 14;
  return (
    <span
      ref={ref}
      aria-hidden
      data-state={look}
      className={cn("ollie ollie-blob", `ollie-${look}`, className)}
      style={{ width: size, height: size, fontSize: size }}
    >
      <span className="ollie-body">
        <span className="ollie-swirl" />
      </span>
      <span className="ollie-shine" />
      {showEyes && (
        <span className="ollie-eyes">
          <span className="ollie-eye" />
          <span className="ollie-eye" style={{ animationDelay: "0.06s" }} />
        </span>
      )}
    </span>
  );
}

// '#' lit, '+' half lit, '.' off; row-major from the top left.
const SPARK = ".+.+#+.+.".split("").map((c) => (c === "#" ? 1 : c === "+" ? 0.6 : 0));
// The outer ring, clockwise from the top left.
const RING = [0, 1, 2, 5, 8, 7, 6, 3];

function OllieSpark({ size = 14, state = "idle", tone = "color", celebrate = true, className }: Omit<Props, "variant">) {
  const reduce = useReducedMotion();
  const cheer = useCheer(state, celebrate);
  const cell = size * 0.26;
  const gap = Math.max(0.5, size * 0.1);
  const look = cheer ? "done" : tone === "muted" && state === "idle" ? "muted" : state;
  return (
    <span aria-hidden data-state={look} className={cn("ollie ollie-spark", `ollie-${look}`, className)} style={{ width: size, height: size }}>
      <span className="ollie-grid" style={{ gridTemplateColumns: `repeat(3, ${cell}px)`, gap }}>
        {SPARK.map((base, i) => {
          let o = base;
          let animation: string | undefined;
          if (state === "thinking" && !reduce) {
            const r = RING.indexOf(i);
            o = r === -1 ? 1 : 0.18;
            if (r !== -1) animation = `ollie-px-chase 0.9s linear ${r * 0.11}s infinite`;
          } else if (state === "attention" && !reduce && o > 0) {
            animation = "ollie-px-pulse 1.2s ease-in-out infinite";
          }
          return <span key={i} className="ollie-px" style={{ width: cell, height: cell, animation, "--o": o } as CSSProperties} />;
        })}
      </span>
    </span>
  );
}
