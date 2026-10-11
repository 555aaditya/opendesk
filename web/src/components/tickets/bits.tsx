import { Globe, Mail, MessageCircle, Code2 } from "lucide-react";
import type { Channel, Priority, Ticket, TicketStatus } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { minutes } from "@/lib/format";
import { Tooltip } from "@/components/ui/tooltip";

export const statusLabel: Record<TicketStatus, string> = {
  open: "Open",
  pending: "Pending",
  on_hold: "On hold",
  solved: "Solved",
  closed: "Closed",
};
export const statusOrder: TicketStatus[] = ["open", "pending", "on_hold", "solved", "closed"];

export const priorityLabel: Record<Priority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
export const priorityOrder: Priority[] = ["urgent", "high", "normal", "low"];

export const channelLabel: Record<Channel, string> = { email: "Email", chat: "Chat", api: "API", portal: "Portal" };

/** Status as a tiny glyph: the only colour is a semantic dot. */
export function StatusIcon({ status, className }: { status: TicketStatus; className?: string }) {
  const base = cn("size-3 shrink-0", className);
  switch (status) {
    case "open":
      return (
        <svg viewBox="0 0 12 12" className={base} aria-label="Open" role="img">
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-fg" />
          <circle cx="6" cy="6" r="1.75" className="fill-fg" />
        </svg>
      );
    case "pending":
      return (
        <svg viewBox="0 0 12 12" className={base} aria-label="Pending" role="img">
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="var(--warn)" strokeWidth="1.5" />
          <path d="M6 1.25a4.75 4.75 0 0 1 0 9.5z" fill="var(--warn)" />
        </svg>
      );
    case "on_hold":
      return (
        <svg viewBox="0 0 12 12" className={base} aria-label="On hold" role="img">
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="2 1.6" />
        </svg>
      );
    case "solved":
      return (
        <svg viewBox="0 0 12 12" className={base} aria-label="Solved" role="img">
          <circle cx="6" cy="6" r="5.5" fill="var(--ok)" />
          <path d="M3.6 6.2l1.6 1.5 3.2-3.4" fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "closed":
      return (
        <svg viewBox="0 0 12 12" className={base} aria-label="Closed" role="img">
          <circle cx="6" cy="6" r="5.5" fill="var(--fg-4)" />
          <path d="M3.6 6.2l1.6 1.5 3.2-3.4" fill="none" stroke="var(--surface)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

/** Signal bars for priority, a filled square for urgent. Monochrome. */
export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const base = cn("size-3.5 shrink-0", className);
  if (priority === "urgent")
    return (
      <svg viewBox="0 0 14 14" className={base} aria-label="Urgent" role="img">
        <rect x="1" y="1" width="12" height="12" rx="3" className="fill-fg" />
        <path d="M7 3.8v4" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.1" r="0.95" fill="var(--surface)" />
      </svg>
    );
  const level = { low: 1, normal: 2, high: 3 }[priority];
  return (
    <svg viewBox="0 0 14 14" className={base} aria-label={priorityLabel[priority]} role="img">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={4 + i * 3} rx="1" className={i < level ? "fill-fg-2" : "fill-line-strong"} />
      ))}
    </svg>
  );
}

export function ChannelIcon({ channel, className }: { channel: Channel; className?: string }) {
  const Icon = { email: Mail, chat: MessageCircle, api: Code2, portal: Globe }[channel];
  return <Icon className={cn("size-3.5 shrink-0 text-fg-3", className)} aria-label={channelLabel[channel]} />;
}

/** Which SLA clock matters now, and how long is left (negative = overdue). */
export function slaState(t: Pick<Ticket, "sla" | "first_responded_at" | "status">, now = Date.now()) {
  if (!t.sla || t.status === "solved" || t.status === "closed") return null;
  const firstPending = !t.first_responded_at && t.sla.first_response_due_at;
  const due = firstPending ? t.sla.first_response_due_at : t.sla.resolution_due_at;
  if (!due) return null;
  const left = Math.round((Date.parse(due) - now) / 60000);
  const kind = firstPending ? "First response" : "Resolution";
  const tone: "danger" | "warn" | "muted" = t.sla.breached || left < 0 ? "danger" : left < 60 ? "warn" : "muted";
  return { due, left, kind, tone };
}

export function SlaBadge({ ticket, className }: { ticket: Pick<Ticket, "sla" | "first_responded_at" | "status">; className?: string }) {
  const s = slaState(ticket);
  if (!s) return null;
  const label = s.left < 0 ? `${minutes(-s.left)} over` : minutes(s.left);
  return (
    <Tooltip content={`${s.kind} ${s.left < 0 ? "overdue" : "due"}`}>
      <span
        className={cn(
          "mono inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm px-1.5 text-[10.5px] tabular-nums",
          s.tone === "danger" ? "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-danger-fg" : s.tone === "warn" ? "border border-line text-fg-2" : "text-fg-3",
          className,
        )}
      >
        <span className={cn("size-1.5 rounded-full", s.tone === "danger" ? "bg-danger" : s.tone === "warn" ? "bg-warn" : "bg-fg-4")} />
        {label}
      </span>
    </Tooltip>
  );
}

export function TicketNumber({ n, className }: { n: number; className?: string }) {
  return <span className={cn("mono text-[11.5px] text-fg-3 tabular-nums", className)}>#{n}</span>;
}
