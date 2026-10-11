import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

export const inputBase =
  "w-full min-w-0 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg shadow-xs outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-fg-4 hover:border-line-strong focus:border-focus-line focus:shadow-[0_0_0_3px_var(--focus)] focus-visible:shadow-[0_0_0_3px_var(--focus)] disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-3 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_18%,transparent)]";

const heights = { sm: "h-7 text-[12.5px]", md: "h-8", lg: "h-10 rounded-lg px-3 text-[14px]" } as const;

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; leading?: ReactNode; trailing?: ReactNode; inputSize?: keyof typeof heights };

export const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput(
  { className, invalid, leading, trailing, inputSize = "md", ...rest },
  ref,
) {
  const h = heights[inputSize];
  if (!leading && !trailing)
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputBase, h, className)} {...rest} />;
  return (
    <div className={cn("relative flex items-center", className)}>
      {leading && <span className="pointer-events-none absolute left-2.5 flex text-fg-3 [&_svg]:size-3.5">{leading}</span>}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(inputBase, h, leading && (inputSize === "lg" ? "pl-9" : "pl-8"), trailing && (inputSize === "lg" ? "pr-10" : "pr-8"))}
        {...rest}
      />
      {trailing && <span className="absolute right-1.5 flex items-center text-fg-3">{trailing}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(inputBase, "min-h-[72px] resize-y py-1.5 leading-5", className)}
        {...rest}
      />
    );
  },
);

export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  className,
  autoFocus,
  inputSize = "sm",
  onKeyDown,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  inputSize?: "sm" | "md" | "lg";
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <TextInput
      ref={inputRef}
      inputSize={inputSize}
      type="text"
      role="searchbox"
      value={value}
      autoFocus={autoFocus}
      onKeyDown={(e) => {
        if (e.key === "Escape" && value) {
          e.stopPropagation();
          onChange("");
        }
        onKeyDown?.(e);
      }}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={className}
      leading={<Search />}
      trailing={
        value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange("")}
            className="flex size-5 items-center justify-center rounded text-fg-3 hover:bg-hover hover:text-fg"
          >
            <X className="size-3" />
          </button>
        ) : undefined
      }
    />
  );
}

export function Label({ children, htmlFor, className, optional }: { children: ReactNode; htmlFor?: string; className?: string; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className={cn("flex items-center gap-1.5 text-[12.5px] font-medium text-fg", className)}>
      {children}
      {optional && <span className="font-normal text-fg-4">Optional</span>}
    </label>
  );
}

/** Label + control + hint/error, with ids wired for screen readers. */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className,
  id: idProp,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  children: (p: { id: string; "aria-describedby"?: string; invalid: boolean }) => ReactNode;
  className?: string;
  id?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={id} optional={optional}>
          {label}
        </Label>
      )}
      {children({ id, "aria-describedby": describedBy, invalid: !!error })}
      {error ? (
        <p id={`${id}-err`} role="alert" className="animate-rise-in text-xs text-danger-fg">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Number field with our own steppers; the native spinner is hidden globally. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  className,
  id,
  ...aria
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  return (
    <div className={cn("relative flex h-8 items-center", className)}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className={cn(inputBase, "h-8 pr-12 mono tabular-nums")}
        {...aria}
      />
      {suffix && <span className="pointer-events-none absolute right-7 text-xs text-fg-3">{suffix}</span>}
      <div className="absolute right-1 flex flex-col">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Increase"
          onClick={() => onChange(clamp(value + step))}
          className="flex h-3.5 w-5 items-center justify-center rounded-sm text-fg-3 hover:bg-hover hover:text-fg"
        >
          <ChevronUp className="size-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Decrease"
          onClick={() => onChange(clamp(value - step))}
          className="flex h-3.5 w-5 items-center justify-center rounded-sm text-fg-3 hover:bg-hover hover:text-fg"
        >
          <ChevronDown className="size-3" />
        </button>
      </div>
    </div>
  );
}
