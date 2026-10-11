// Value pickers shared by the view filter builder and the automation builder.

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Hash, Inbox, Users } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Picker, type PickerItem } from "@/components/ui/picker";
import { ChannelIcon, PriorityIcon, StatusIcon, channelLabel, priorityLabel, priorityOrder, statusLabel, statusOrder } from "@/components/tickets/bits";
import type { Channel } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { cn } from "@/lib/cn";

export const statusItems: PickerItem[] = statusOrder.map((s) => ({ value: s, label: statusLabel[s], icon: <StatusIcon status={s} /> }));
export const priorityItems: PickerItem[] = priorityOrder.map((p) => ({ value: p, label: priorityLabel[p], icon: <PriorityIcon priority={p} /> }));
export const channelItems: PickerItem[] = (Object.keys(channelLabel) as Channel[]).map((c) => ({
  value: c,
  label: channelLabel[c],
  icon: <ChannelIcon channel={c} />,
}));

export function useMemberItems(): PickerItem[] {
  const { data } = useQuery(q.members());
  return (data ?? [])
    .filter((m) => m.role !== "viewer")
    .map((m) => ({
      value: m.user.id,
      label: m.user.name || m.user.email,
      hint: m.user.email,
      keywords: [m.user.email],
      icon: <Avatar name={m.user.name || m.user.email} src={m.user.avatar_url} size="xs" />,
    }));
}

export function useTeamItems(): PickerItem[] {
  const { data } = useQuery(q.teams());
  return (data ?? []).map((t) => ({ value: t.id, label: t.name, icon: <Users /> }));
}

export function useMailboxItems(): PickerItem[] {
  const { data } = useQuery(q.mailboxes());
  return (data ?? []).map((m) => ({ value: m.id, label: m.email, hint: m.name !== m.email ? m.name : undefined, icon: <Inbox /> }));
}

export function useTagItems(): PickerItem[] {
  const { data } = useQuery(q.tags());
  return (data ?? []).map((t) => ({ value: t.name, label: t.name, icon: <Hash /> }));
}

/** The trigger every builder picker uses: a quiet bordered button showing the current value. */
type ValueButtonProps = {
  children?: ReactNode;
  placeholder: string;
  icon?: ReactNode;
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export const ValueButton = forwardRef<HTMLButtonElement, ValueButtonProps>(function ValueButton(
  { children, placeholder, icon, className, invalid, disabled, ...rest },
  ref,
) {
  const empty = children === undefined || children === null || children === "";
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-invalid={invalid || undefined}
      {...rest}
      className={cn(
        "inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-fg outline-none transition-colors hover:border-line-strong focus-visible:shadow-[0_0_0_3px_var(--focus)] disabled:opacity-60 data-[state=open]:border-fg-3 aria-[invalid=true]:border-danger [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
    >
      {icon}
      <span className={cn("min-w-0 truncate", empty && "text-fg-4")}>{empty ? placeholder : children}</span>
      <ChevronDown className="ml-auto !size-3 text-fg-4" />
    </button>
  );
});

/** Single-value picker with a ValueButton trigger. */
export function SinglePick({
  items,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  onCreate,
  invalid,
  disabled,
  width,
  className,
}: {
  items: PickerItem[];
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  onCreate?: (q: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  width?: number;
  className?: string;
}) {
  const cur = items.find((i) => i.value === value);
  const trigger = (
    <ValueButton placeholder={placeholder} icon={cur?.icon} invalid={invalid} disabled={disabled} className={className}>
      {cur?.label ?? (value || undefined)}
    </ValueButton>
  );
  if (disabled) return trigger;
  return (
    <Picker
      items={items}
      value={value ?? null}
      onSelect={onChange}
      placeholder={searchPlaceholder ?? "Search"}
      onCreate={onCreate}
      width={width}
      trigger={trigger}
    />
  );
}

/** Multi-value picker showing a compact summary of the selection. */
export function MultiPick({
  items,
  values,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  items: PickerItem[];
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}) {
  const chosen = items.filter((i) => values.includes(i.value));
  const summary =
    chosen.length === 0 ? undefined : chosen.length <= 2 ? chosen.map((c) => c.label).join(", ") : `${chosen[0].label} and ${chosen.length - 1} more`;
  const icons = (
    <span className="flex items-center gap-0.5">
      {chosen.slice(0, 3).map((c) => (
        <span key={c.value} className="flex">
          {c.icon}
        </span>
      ))}
    </span>
  );
  const trigger = (
    <ValueButton placeholder={placeholder} icon={chosen.length ? icons : undefined} disabled={disabled} className={className}>
      {summary}
    </ValueButton>
  );
  if (disabled) return trigger;
  return <Picker multi items={items} values={values} onChange={onChange} placeholder="Search" trigger={trigger} />;
}
