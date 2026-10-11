// A single-thumb slider drawn in the product palette: a hairline track, an ink
// fill and a round thumb. Pointer drag, click on the track and the keyboard
// (arrows, Page Up/Down, Home/End) all move it; `onCommit` fires once a change
// settles (pointer up, key up) so callers can save without a request per pixel.

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";

type Props = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  disabled?: boolean;
  "aria-label": string;
  /** Text for screen readers ("70%"). */
  valueText?: (v: number) => string;
  className?: string;
};

export function Slider({ value, min, max, step, onChange, onCommit, disabled, valueText, className, ...aria }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (v: number) => {
    const snapped = Math.round((v - min) / step) * step + min;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
  };
  const frac = (value - min) / (max - min || 1);
  const fromPointer = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width === 0) return value;
    return clamp(min + ((clientX - r.left) / r.width) * (max - min));
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(fromPointer(e.clientX));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onChange(fromPointer(e.clientX));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    onCommit?.(fromPointer(e.clientX));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = step * 10;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp" ? value + step
      : e.key === "ArrowLeft" || e.key === "ArrowDown" ? value - step
      : e.key === "PageUp" ? value + big
      : e.key === "PageDown" ? value - big
      : e.key === "Home" ? min
      : e.key === "End" ? max
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next));
  };
  const keyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) onCommit?.(value);
  };

  return (
    <div
      ref={track}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText?.(value)}
      aria-disabled={disabled || undefined}
      aria-label={aria["aria-label"]}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onKeyUp={keyUp}
      className={cn(
        "group relative flex h-5 cursor-pointer touch-none select-none items-center rounded-full outline-none",
        disabled && "cursor-default opacity-50",
        className,
      )}
    >
      <span className="absolute inset-x-0 h-1 rounded-full bg-line" />
      <span className="absolute left-0 h-1 rounded-full bg-fg" style={{ width: `${frac * 100}%` }} />
      <span
        className={cn(
          "absolute size-3.5 -translate-x-1/2 rounded-full border border-line-strong bg-surface shadow-xs transition-[transform,box-shadow] duration-150",
          "group-focus-visible:shadow-[0_0_0_3px_var(--focus)]",
          dragging ? "scale-110" : "group-hover:scale-105",
        )}
        style={{ left: `${frac * 100}%` }}
      />
    </div>
  );
}
