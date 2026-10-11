// Page scaffolding shared by every screen, so headers, sections and rows line
// up across the app.

import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** The 48px bar at the top of a main panel. */
export function PageHeader({
  title,
  icon,
  children,
  actions,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex h-12 shrink-0 items-center gap-3 border-b border-line px-4", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="flex text-fg-3 [&_svg]:size-4">{icon}</span>}
        <h1 className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{title}</h1>
      </div>
      {children && <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>}
      {actions && <div className={cn("flex shrink-0 items-center gap-1.5", !children && "ml-auto")}>{actions}</div>}
    </header>
  );
}

/** "← Section" above a detail page title; always present on detail pages. */
export function BackLink({ children, ...link }: { children: ReactNode } & React.ComponentProps<typeof Link>) {
  return (
    <Link
      {...link}
      className="-ml-1 inline-flex h-6 items-center gap-0.5 rounded-md pl-0.5 pr-1.5 text-[12.5px] text-fg-3 transition-colors hover:bg-hover hover:text-fg"
    >
      <ChevronLeft className="size-3.5" />
      {children}
    </Link>
  );
}

/** A settings page: narrow, readable column with a title block. */
export function SettingsPage({
  title,
  description,
  actions,
  children,
  back,
  wide,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  back?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("mx-auto w-full px-6 pb-24 pt-8 md:px-10", wide ? "max-w-[1040px]" : "max-w-[760px]")}>
      {back && <div className="mb-3">{back}</div>}
      <div className="mb-7 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.025em]">{title}</h1>
          {description && <p className="mt-1 max-w-[560px] text-[13px] leading-5 text-fg-3">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="flex flex-col gap-8">{children}</div>
    </div>
  );
}

/** A titled group with a hairline card. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  flush,
  danger,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No inner padding: for lists and tables that run edge to edge. */
  flush?: boolean;
  danger?: boolean;
}) {
  return (
    <section className={className}>
      {(title || actions) && (
        <div className="mb-2.5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            {title && <h2 className={cn("text-[13.5px] font-semibold tracking-[-0.01em]", danger && "text-danger-fg")}>{title}</h2>}
            {description && <p className="mt-0.5 text-[12.5px] text-fg-3">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div
        className={cn(
          "rounded-lg border border-line bg-surface",
          !flush && "px-4 py-1",
          danger && "border-[color-mix(in_srgb,var(--danger)_25%,var(--line))]",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Label and description on the left, the control on the right. */
export function Row({
  label,
  description,
  children,
  className,
  htmlFor,
  stack,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  htmlFor?: string;
  /** Put the control under the label (wide inputs, editors). */
  stack?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-4 border-b border-line-soft py-3.5 last:border-0",
        stack ? "flex-col gap-2.5" : "items-center justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
            {label}
          </label>
        ) : (
          <div className="text-[13px] font-medium text-fg">{label}</div>
        )}
        {description && <div className="mt-0.5 text-[12.5px] leading-[18px] text-fg-3">{description}</div>}
      </div>
      {children && <div className={cn(stack ? "w-full" : "flex shrink-0 items-center gap-2")}>{children}</div>}
    </div>
  );
}

/** A dense list row in a flush Section. */
export function ListRow({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group flex min-h-12 items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0",
        onClick && "cursor-pointer transition-colors hover:bg-hover/60",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Shown in place of a settings page to roles that can't manage it. */
export function NoAccess({ what = "these settings" }: { what?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="text-[13px] font-medium">Admins only</p>
      <p className="mt-1 text-[12.5px] text-fg-3">Ask a workspace admin if you need to change {what}.</p>
    </div>
  );
}
