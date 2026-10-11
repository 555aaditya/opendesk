import { Switch as S } from "radix-ui";
import { cn } from "@/lib/cn";

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <S.Root
      id={id}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-[3px] border border-transparent bg-line-strong transition-colors duration-150 data-[state=checked]:bg-inverse disabled:opacity-50",
        className,
      )}
    >
      <S.Thumb className="block size-3 translate-x-[1px] rounded-[2px] bg-surface transition-transform duration-150 ease-[var(--ease-snap)] data-[state=checked]:translate-x-[13px] dark:data-[state=checked]:bg-inverse-fg" />
    </S.Root>
  );
}
