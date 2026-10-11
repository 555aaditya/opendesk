// One family of indicators for status, priority, SLA, sentiment and channel.
// All glyphs are drawn on the same 16px grid with a 1.5 stroke, sized 14px by
// default, coloured from the tone palette (lib/tones.ts) with light and dark
// variants, and they snap in softly when their value changes.

import type { ReactNode } from "react";
import type { Channel, Priority, Sentiment, TicketStatus } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { minutes } from "@/lib/format";
import { channelTone, priorityTone, sentimentTone, statusTone, tone, toneVar, type Tone } from "@/lib/tones";
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
export const sentimentLabel: Record<Sentiment, string> = { positive: "Positive", neutral: "Neutral", negative: "Negative", frustrated: "Frustrated" };

const SW = 1.5;

/** The shared frame: a 16px grid, keyed by value so a change snaps in. */
function Glyph({ k, label, className, children }: { k: string; label: string; className?: string; children: ReactNode }) {
  return (
    <svg
      key={k}
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      className={cn("size-3.5 shrink-0 animate-indicator-in motion-reduce:animate-none", className)}
      fill="none"
    >
      {children}
    </svg>
  );
}

// Status: rings that fill as the ticket moves along, in the status tone.

export function StatusIcon({ status, className }: { status: TicketStatus; className?: string }) {
  const c = toneVar(statusTone[status]);
  return (
    <Glyph k={status} label={statusLabel[status]} className={className}>
      {status === "open" && (
        <>
          <circle cx="8" cy="8" r="5.75" stroke={c} strokeWidth={SW} />
          <circle cx="8" cy="8" r="2.25" fill={c} />
        </>
      )}
      {status === "pending" && (
        <>
          <circle cx="8" cy="8" r="5.75" stroke={c} strokeWidth={SW} />
          <path d="M8 4.25a3.75 3.75 0 0 1 0 7.5z" fill={c} />
        </>
      )}
      {status === "on_hold" && (
        <>
          <circle cx="8" cy="8" r="5.75" stroke={c} strokeWidth={SW} strokeDasharray="2.4 1.9" />
          <path d="M6.6 6v4M9.4 6v4" stroke={c} strokeWidth={SW} strokeLinecap="round" />
        </>
      )}
      {(status === "solved" || status === "closed") && (
        <>
          <circle cx="8" cy="8" r="6.5" fill={c} />
          <path d="M5.4 8.2l1.8 1.75 3.5-3.7" stroke="var(--surface)" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </Glyph>
  );
}

/** Spam is a folder rather than a status; it gets a matching glyph. */
export function SpamIcon({ className }: { className?: string }) {
  const c = toneVar("red");
  return (
    <Glyph k="spam" label="Spam" className={className}>
      <circle cx="8" cy="8" r="5.75" stroke={c} strokeWidth={SW} />
      <path d="M4 12l8-8" stroke={c} strokeWidth={SW} strokeLinecap="round" />
    </Glyph>
  );
}

export function StatusPill({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-sm pl-1 pr-1.5 text-[11px] font-medium", tone[statusTone[status]].chip, className)}>
      <StatusIcon status={status} className="size-3" />
      {statusLabel[status]}
    </span>
  );
}

// Priority: three signal bars that rise and warm with priority; urgent is a
// filled square with an exclamation, the one mark that shouts.

export function PriorityIcon({ priority, className, muted }: { priority: Priority; className?: string; muted?: boolean }) {
  if (priority === "urgent")
    return (
      <Glyph k={priority} label={priorityLabel.urgent} className={className}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill={toneVar("red")} />
        <path d="M8 4.6v4.1" stroke="white" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="8" cy="11.1" r="1" fill="white" />
      </Glyph>
    );
  const level = { low: 1, normal: 2, high: 3 }[priority];
  const on = muted ? "var(--fg-3)" : priority === "high" ? toneVar(priorityTone.high) : "var(--fg-2)";
  return (
    <Glyph k={priority} label={priorityLabel[priority]} className={className}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2.25 + i * 4.25} y={10 - i * 3.5} width="3" height={4 + i * 3.5} rx="0.9" fill={i < level ? on : "var(--line-strong)"} />
      ))}
    </Glyph>
  );
}

export function PriorityPill({ priority, className }: { priority: Priority; className?: string }) {
  const hue: Tone = priority === "urgent" ? "red" : priority === "high" ? "orange" : "gray";
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-sm pl-1 pr-1.5 text-[11px] font-medium", tone[hue].chip, className)}>
      <PriorityIcon priority={priority} className="size-3" />
      {priorityLabel[priority]}
    </span>
  );
}

// SLA: on track, due soon or breached, with the time left.

export type SlaInput = {
  sla: { first_response_due_at: string | null; resolution_due_at: string | null; breached: boolean } | null;
  first_responded_at?: string | null;
  status: TicketStatus;
};

export type SlaState = { due: string; left: number; kind: string; state: "on_track" | "due_soon" | "breached"; tone: "danger" | "warn" | "muted" };

/** Which SLA clock matters now, and how long is left in minutes (negative = overdue). */
export function slaState(t: SlaInput, now = Date.now()): SlaState | null {
  if (!t.sla || t.status === "solved" || t.status === "closed") return null;
  const firstPending = !t.first_responded_at && t.sla.first_response_due_at;
  const due = firstPending ? t.sla.first_response_due_at : t.sla.resolution_due_at;
  if (!due) return null;
  const left = Math.round((Date.parse(due) - now) / 60000);
  const kind = firstPending ? "First response" : "Resolution";
  const state = t.sla.breached || left < 0 ? "breached" : left < 60 ? "due_soon" : "on_track";
  return { due, left, kind, state, tone: state === "breached" ? "danger" : state === "due_soon" ? "warn" : "muted" };
}

const slaLook = {
  on_track: { chip: "text-fg-3", dot: tone.green.solid, word: "due" },
  due_soon: { chip: tone.amber.chip, dot: tone.amber.solid, word: "due soon" },
  breached: { chip: tone.red.chip, dot: tone.red.solid, word: "overdue" },
} as const;

export function SlaPill({ ticket, className }: { ticket: SlaInput; className?: string }) {
  const s = slaState(ticket);
  if (!s) return null;
  const look = slaLook[s.state];
  const label = s.left < 0 ? `${minutes(-s.left)} over` : minutes(s.left);
  return (
    <Tooltip content={`${s.kind} ${look.word}`}>
      <span
        key={s.state}
        className={cn(
          "mono inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm px-1.5 text-[10.5px] tabular-nums animate-indicator-in motion-reduce:animate-none",
          look.chip,
          className,
        )}
      >
        <span className={cn("size-1.5 rounded-full", look.dot, s.state === "breached" && "animate-pulse-soft")} />
        {label}
      </span>
    </Tooltip>
  );
}

// Sentiment: a small face, coloured by mood.

export function SentimentIcon({ sentiment, className }: { sentiment: Sentiment | string; className?: string }) {
  const s = (sentiment in sentimentLabel ? sentiment : "neutral") as Sentiment;
  const hue: Tone = s === "frustrated" ? "red" : s === "negative" ? "amber" : sentimentTone[s as "positive" | "neutral"];
  const c = toneVar(hue);
  const mouth = {
    positive: "M5.6 9.4c1.3 1.45 3.5 1.45 4.8 0",
    neutral: "M5.8 10h4.4",
    negative: "M5.6 10.8c1.3-1.45 3.5-1.45 4.8 0",
    frustrated: "M5.6 11c1.3-1.6 3.5-1.6 4.8 0",
  }[s];
  return (
    <Glyph k={s} label={sentimentLabel[s]} className={className}>
      <circle cx="8" cy="8" r="6.25" stroke={c} strokeWidth={SW} />
      {s === "frustrated" ? (
        <path d="M5.2 6l1.6.7M10.8 6l-1.6.7" stroke={c} strokeWidth={SW} strokeLinecap="round" />
      ) : (
        <>
          <circle cx="6" cy="6.6" r="0.95" fill={c} />
          <circle cx="10" cy="6.6" r="0.95" fill={c} />
        </>
      )}
      <path d={mouth} stroke={c} strokeWidth={SW} strokeLinecap="round" />
    </Glyph>
  );
}

// Channel: envelope, bubble, braces, globe; drawn to match the family.

export function ChannelIcon({ channel, className, plain }: { channel: Channel; className?: string; plain?: boolean }) {
  const c = plain ? "var(--fg-3)" : toneVar(channelTone[channel]);
  return (
    <Glyph k={channel} label={channelLabel[channel]} className={className}>
      {channel === "email" && (
        <>
          <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" stroke={c} strokeWidth={SW} />
          <path d="M2.5 4.5L8 8.6l5.5-4.1" stroke={c} strokeWidth={SW} strokeLinejoin="round" />
        </>
      )}
      {channel === "chat" && (
        <path
          d="M3.75 2.75h8.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7.5L4.6 13.9a.5.5 0 0 1-.85-.36V11.7a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2z"
          stroke={c}
          strokeWidth={SW}
          strokeLinejoin="round"
        />
      )}
      {channel === "api" && (
        <path d="M5.5 3.5C4 3.5 4 4.5 4 6s-1.5 2-1.5 2S4 8.5 4 10s0 2.5 1.5 2.5M10.5 3.5C12 3.5 12 4.5 12 6s1.5 2 1.5 2S12 8.5 12 10s0 2.5-1.5 2.5" stroke={c} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {channel === "portal" && (
        <>
          <circle cx="8" cy="8" r="6" stroke={c} strokeWidth={SW} />
          <path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14C6.2 12.3 5.4 10.3 5.4 8S6.2 3.7 8 2z" stroke={c} strokeWidth={SW} strokeLinejoin="round" />
        </>
      )}
    </Glyph>
  );
}
