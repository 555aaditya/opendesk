import { memo } from "react";
import type { Ticket } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { relShort, fullDate } from "@/lib/format";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { TagChip } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { PriorityIcon, SlaBadge, StatusIcon, statusLabel } from "./bits";
import { useTicketViewers } from "./presence";

export type RowProps = {
  ticket: Ticket;
  active: boolean;
  focused: boolean;
  selected: boolean;
  selecting: boolean;
  compact: boolean;
  onOpen: (t: Ticket) => void;
  onToggle: (t: Ticket, shift: boolean) => void;
  onHover?: (t: Ticket) => void;
};

/** The customer wrote last and nobody has answered yet. */
export function awaitingReply(t: Ticket) {
  return (
    (t.status === "open" || t.status === "pending") &&
    !!t.last_customer_message_at &&
    Date.parse(t.last_customer_message_at) >= Date.parse(t.last_message_at) - 1000
  );
}

function Viewers({ ticketId }: { ticketId: string }) {
  const v = useTicketViewers(ticketId);
  if (!v.length) return null;
  const label = v.map((x) => `${x.name} ${x.state === "replying" ? "is replying" : "is viewing"}`).join(", ");
  return (
    <Tooltip content={label}>
      <span className="flex">
        <AvatarStack size="xs" max={3} people={v.map((x) => ({ id: x.user_id, name: x.name, avatar: x.avatar, state: x.state }))} />
      </span>
    </Tooltip>
  );
}

export const TicketRow = memo(function TicketRow({ ticket: t, active, focused, selected, selecting, compact, onOpen, onToggle, onHover }: RowProps) {
  const unread = awaitingReply(t);
  const contactName = t.contact?.name || t.contact?.email || "Unknown";
  const check = (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center transition-opacity",
        selecting || selected ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100",
      )}
    >
      <Checkbox
        checked={selected}
        aria-label={`Select ticket ${t.number}`}
        onClick={(e) => {
          e.stopPropagation();
          if (e.shiftKey) {
            e.preventDefault();
            onToggle(t, true);
          }
        }}
        onCheckedChange={() => onToggle(t, false)}
      />
    </span>
  );

  if (compact) {
    return (
      <div
        role="option"
        aria-selected={active}
        data-ticket-id={t.id}
        tabIndex={-1}
        onClick={() => onOpen(t)}
        onMouseEnter={() => onHover?.(t)}
        className={cn(
          "group relative flex cursor-pointer gap-2.5 border-b border-line-soft px-3 py-2.5 outline-none transition-colors duration-75",
          active ? "bg-active" : selected ? "bg-hover" : "hover:bg-hover/70",
          focused && !active && "shadow-[inset_2px_0_0_var(--fg-3)]",
          active && "shadow-[inset_2px_0_0_var(--fg)]",
        )}
      >
        <div className="flex w-5 shrink-0 flex-col items-center gap-2 pt-0.5">
          {selecting || selected ? check : <StatusIcon status={t.status} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", unread ? "font-medium text-fg" : "text-fg-2")} data-ph-mask>
              {contactName}
            </span>
            <Viewers ticketId={t.id} />
            <span className="mono shrink-0 text-[10.5px] text-fg-4" title={fullDate(t.last_message_at)}>
              {relShort(t.last_message_at)}
            </span>
          </div>
          <div className={cn("mt-0.5 truncate text-[12.5px]", unread ? "font-medium text-fg" : "text-fg")} data-ph-mask>
            {t.subject || "(no subject)"}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-xs text-fg-3" data-ph-mask>
              {t.last_message_preview}
            </span>
            {t.priority === "urgent" || t.priority === "high" ? <PriorityIcon priority={t.priority} className="size-3" /> : null}
            <SlaBadge ticket={t} />
            {t.assignee && <Avatar name={t.assignee.name} src={t.assignee.avatar_url} size="xs" />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="option"
      aria-selected={active}
      data-ticket-id={t.id}
      tabIndex={-1}
      onClick={() => onOpen(t)}
      onMouseEnter={() => onHover?.(t)}
      className={cn(
        "group relative flex h-11 cursor-pointer items-center gap-3 border-b border-line-soft pl-3 pr-4 outline-none transition-colors duration-75",
        selected ? "bg-hover" : "hover:bg-hover/70",
        focused && "shadow-[inset_2px_0_0_var(--fg-3)]",
      )}
    >
      {check}
      <Tooltip content={statusLabel[t.status]}>
        <span className="flex">
          <StatusIcon status={t.status} />
        </span>
      </Tooltip>
      {/* Only priorities that change triage get an icon; the slot keeps columns aligned. */}
      <span className="flex w-4 shrink-0 justify-center">
        {(t.priority === "urgent" || t.priority === "high") && <PriorityIcon priority={t.priority} />}
      </span>
      <span className={cn("w-[168px] shrink-0 truncate text-[13px]", unread ? "font-medium text-fg" : "text-fg-2")} data-ph-mask>
        {contactName}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className={cn("shrink-0 truncate text-[13px] max-w-[60%]", unread ? "font-medium text-fg" : "text-fg-2")} data-ph-mask>
          {t.subject || "(no subject)"}
        </span>
        <span className="min-w-0 truncate text-[12.5px] text-fg-3" data-ph-mask>
          {t.last_message_preview}
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 lg:flex">
        {t.tags.slice(0, 2).map((tag) => (
          <TagChip key={tag.id} name={tag.name} />
        ))}
        {t.tags.length > 2 && <span className="text-[11px] text-fg-4">+{t.tags.length - 2}</span>}
      </span>
      <Viewers ticketId={t.id} />
      <SlaBadge ticket={t} />
      <span className="flex w-5 shrink-0 justify-center">
        {t.assignee && (
          <Tooltip content={t.assignee.name}>
            <span className="flex">
              <Avatar name={t.assignee.name} src={t.assignee.avatar_url} size="sm" />
            </span>
          </Tooltip>
        )}
      </span>
      <span className="mono w-10 shrink-0 text-right text-[11px] text-fg-3 tabular-nums" title={fullDate(t.last_message_at)}>
        {relShort(t.last_message_at)}
      </span>
    </div>
  );
});
