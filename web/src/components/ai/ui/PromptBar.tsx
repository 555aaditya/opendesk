// Adapted from Beautiful UI "Prompt Bar" and "Chat Composer"
// (https://www.beautifului.dev/#prompt-bar, #chat-composer). MIT,
// Copyright (c) 2026 Shane Levine. See web/THIRD_PARTY_NOTICES.md.
// A compact composer: a growing input, a quiet hint, and a tactile square send.

import { ArrowUp } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";

export const PromptBar = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    placeholder: string;
    label: string;
    sendLabel: string;
    sendHint?: ReactNode;
    disabled?: boolean;
    busy?: boolean;
    maxLength?: number;
    leading?: ReactNode;
    className?: string;
  }
>(function PromptBar({ value, onChange, onSubmit, placeholder, label, sendLabel, sendHint, disabled, busy, maxLength, leading, className }, ref) {
  const canSend = !!value.trim() && !busy && !disabled;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface pl-2.5 pr-1 shadow-xs transition-[border-color,box-shadow] duration-150 focus-within:border-line-strong focus-within:shadow-[0_0_0_3px_var(--focus)]",
        disabled && "opacity-60",
        className,
      )}
    >
      {leading}
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={maxLength}
        disabled={disabled}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-4"
      />
      <Tooltip content={sendHint ?? sendLabel}>
        <button
          type="submit"
          aria-label={sendLabel}
          disabled={!canSend}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md transition-[background-color,color,transform] duration-150 enabled:active:scale-[0.94]",
            canSend ? "bg-inverse text-inverse-fg hover:bg-inverse-hover" : "bg-hover text-fg-4",
          )}
        >
          <ArrowUp className="size-3.5" strokeWidth={2.25} />
        </button>
      </Tooltip>
    </form>
  );
});
