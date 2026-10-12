// A list of short values edited as chips: type, Enter (or comma) adds, the x
// removes, Backspace in an empty field takes the last one back for editing.
// Used for blocked topics, crawl paths and allowed sites.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";

export function ChipEditor({
  values,
  onChange,
  placeholder,
  max,
  validate,
  normalize = (v) => v.trim(),
  mono,
  disabled,
  "aria-label": ariaLabel,
  id,
  dot,
  empty,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
  /** An error to show for a value, or null when it's fine. Runs on the normalized value. */
  validate?: (v: string) => string | null;
  /** Turns typed text into the stored value, or null when it can't be one. */
  normalize?: (v: string) => string | null;
  mono?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  id?: string;
  /** A small dot before each chip, in a tone class (e.g. bg-tone-green-solid). */
  dot?: string;
  /** Quiet text shown when the list is empty. */
  empty?: string;
}) {
  const { t } = useTranslation("agent");
  const reduce = useReducedMotion();
  const auto = useId();
  const inputId = id ?? auto;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = max !== undefined && values.length >= max;

  const add = () => {
    if (!text.trim()) return;
    const v = normalize(text);
    if (v === null) return setError(t("chips.invalid"));
    const problem = validate?.(v) ?? null;
    if (problem) return setError(problem);
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) return setError(t("chips.duplicate"));
    if (full) return setError(t("chips.full", { max }));
    onChange([...values, v]);
    setText("");
    setError(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={ariaLabel}>
          <AnimatePresence initial={false} mode="popLayout">
            {values.map((v) => (
              <motion.li
                key={v}
                layout={reduce ? false : "position"}
                initial={reduce ? false : { opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.92 }}
                transition={springs.snap}
                className={cn(
                  "inline-flex h-6 max-w-full items-center gap-1.5 rounded-sm border border-line bg-sunken pl-2 pr-0.5 text-[12px] text-fg-2",
                  mono && "mono text-[11.5px]",
                )}
              >
                {dot && <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden />}
                <span className="truncate">{v}</span>
                <button
                  type="button"
                  aria-label={t("chips.remove", { value: v })}
                  disabled={disabled}
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  className="flex size-5 shrink-0 items-center justify-center rounded-xs text-fg-4 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
                >
                  <X className="size-3" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <div className="flex gap-2">
        <TextInput
          id={inputId}
          inputSize="sm"
          value={text}
          disabled={disabled || full}
          invalid={!!error}
          placeholder={full ? t("chips.full", { max }) : placeholder}
          aria-label={ariaLabel}
          aria-describedby={error ? `${inputId}-err` : undefined}
          className={cn(mono && "mono")}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !text && values.length) {
              e.preventDefault();
              setText(values[values.length - 1]);
              onChange(values.slice(0, -1));
            }
          }}
        />
        <Button size="sm" onClick={add} disabled={disabled || full || !text.trim()}>
          {t("chips.add")}
        </Button>
      </div>
      <div className="flex min-h-4 items-start justify-between gap-3">
        {error ? (
          <p id={`${inputId}-err`} role="alert" className="animate-rise-in text-xs text-danger-fg">
            {error}
          </p>
        ) : (
          <p className="text-[12px] text-fg-4">{!values.length ? empty : null}</p>
        )}
        {max !== undefined && (
          <span className={cn("mono shrink-0 text-[11px] tabular-nums", full ? "text-fg-2" : "text-fg-4")}>
            {values.length} / {max}
          </span>
        )}
      </div>
    </div>
  );
}
