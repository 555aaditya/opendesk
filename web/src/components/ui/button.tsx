import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

const variants = {
  primary:
    "bg-inverse text-inverse-fg hover:bg-inverse-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_1px_2px_rgb(0_0_0/0.12)] disabled:opacity-40",
  secondary:
    "bg-surface text-fg border border-line hover:bg-hover hover:border-line-strong shadow-[0_1px_1px_rgb(0_0_0/0.03)] disabled:opacity-50",
  ghost: "text-fg-2 hover:bg-hover hover:text-fg disabled:opacity-40",
  subtle: "bg-hover text-fg hover:bg-active disabled:opacity-40",
  danger:
    "bg-surface text-danger-fg border border-line hover:border-[color-mix(in_srgb,var(--danger)_40%,var(--line))] hover:bg-[color-mix(in_srgb,var(--danger)_6%,var(--surface))] disabled:opacity-50",
  "danger-solid": "bg-danger text-white hover:opacity-90 disabled:opacity-40",
} as const;

const sizes = {
  xs: "h-6 px-2 text-xs gap-1 rounded-[6px]",
  sm: "h-7 px-2.5 text-[12.5px] gap-1.5 rounded-[7px]",
  md: "h-8 px-3 text-sm gap-1.5 rounded-md",
  lg: "h-9 px-4 text-sm gap-2 rounded-md",
} as const;

const iconSizes = { xs: "size-6", sm: "size-7", md: "size-8", lg: "size-9" } as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  asChild?: boolean;
  /** Square, icon-only. Pass aria-label. */
  square?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", icon, iconRight, loading, asChild, square, className, children, disabled, type, ...rest },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      disabled={disabled || loading}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-100 disabled:cursor-not-allowed [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        square && cn(iconSizes[size], "px-0"),
        className,
      )}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner className="size-3.5" /> : icon}
          {children}
          {iconRight}
        </>
      )}
    </Comp>
  );
});
