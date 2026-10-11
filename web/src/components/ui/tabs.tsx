import { Tabs as T } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <T.List className={cn("flex shrink-0 items-center gap-1 border-b border-line px-3", className)}>{children}</T.List>;
}

export function TabsTrigger({ value, children, icon, count }: { value: string; children: ReactNode; icon?: ReactNode; count?: number }) {
  return (
    <T.Trigger
      value={value}
      className="group relative inline-flex h-10 items-center gap-1.5 px-2 text-[12.5px] text-fg-3 outline-none transition-colors hover:text-fg data-[state=active]:font-medium data-[state=active]:text-fg [&_svg]:size-3.5"
    >
      {icon}
      {children}
      {count !== undefined && <span className="mono text-[11px] text-fg-4">{count}</span>}
      <span className="absolute inset-x-1.5 -bottom-px h-[1.5px] rounded-full bg-transparent transition-colors group-data-[state=active]:bg-fg" />
    </T.Trigger>
  );
}

/** Compact segmented toggle (Reply / Note, ranges). */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  className,
  size = "sm",
}: {
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: ReactNode; icon?: ReactNode }[];
  className?: string;
  size?: "xs" | "sm";
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex items-center rounded-md bg-hover p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm font-medium text-fg-3 transition-[color,background-color,box-shadow] duration-100 hover:text-fg [&_svg]:size-3.5",
            size === "xs" ? "h-6 px-2 text-xs" : "h-[26px] px-2.5 text-[12.5px]",
            value === o.value && "bg-surface text-fg shadow-[0_0_0_1px_var(--line),0_1px_2px_rgb(0_0_0/0.06)]",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
