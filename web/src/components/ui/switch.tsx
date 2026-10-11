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
        "relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full border border-transparent bg-line-strong transition-colors duration-150 data-[state=checked]:bg-inverse disabled:opacity-50",
        className,
      )}
    >
      <S.Thumb className="block size-[14px] translate-x-[1px] rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-150 ease-out data-[state=checked]:translate-x-[13px] dark:data-[state=checked]:bg-inverse-fg" />
    </S.Root>
  );
}
