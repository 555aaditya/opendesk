// A compact number stepper: minus, a typed value, plus. No native number
// spinner; the field is a plain text input that accepts digits, and Arrow
// Up/Down (Shift for x10) step it. Out-of-range input snaps on blur.

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

export function Stepper({
  value,
  onChange,
  min = 0,
  max = Infinity,
  step = 1,
  suffix,
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  decLabel = "Decrease",
  incLabel = "Increase",
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  decLabel?: string;
  incLabel?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = (n: number) => {
    setText(null);
    if (Number.isFinite(n)) onChange(clamp(Math.round(n)));
  };
  const bump = (dir: -1 | 1, mult = 1) => commit(value + dir * step * mult);
  const btn =
    "flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-3 transition-colors duration-100 hover:bg-hover hover:text-fg active:scale-95 disabled:pointer-events-none disabled:opacity-40 motion-reduce:active:scale-100 [&_svg]:size-3.5";
  return (
    <div
      className={cn(
        "inline-flex h-8 items-center rounded-md border border-line bg-surface p-0.5 shadow-xs transition-[border-color,box-shadow] duration-150 focus-within:border-focus-line focus-within:ring-2 focus-within:ring-focus/25",
        disabled && "opacity-60",
        className,
      )}
    >
      <button type="button" tabIndex={-1} aria-label={decLabel} className={btn} disabled={disabled || value <= min} onClick={() => bump(-1)}>
        <Minus />
      </button>
      <span className="flex min-w-0 flex-1 items-baseline justify-center gap-1 px-1">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          role="spinbutton"
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={Number.isFinite(max) ? max : undefined}
          disabled={disabled}
          value={text ?? String(value)}
          size={Math.max(2, String(text ?? value).length)}
          onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={() => text !== null && commit(text === "" ? min : Number(text))}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              bump(e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? 10 : 1);
            } else if (e.key === "Enter" && text !== null) {
              e.preventDefault();
              commit(text === "" ? min : Number(text));
            }
          }}
          className="mono w-auto min-w-0 bg-transparent text-center text-[12.5px] tabular-nums text-fg outline-none"
        />
        {suffix && <span className="shrink-0 text-[12px] text-fg-3">{suffix}</span>}
      </span>
      <button type="button" tabIndex={-1} aria-label={incLabel} className={btn} disabled={disabled || value >= max} onClick={() => bump(1)}>
        <Plus />
      </button>
    </div>
  );
}
