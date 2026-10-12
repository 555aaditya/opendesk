import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MessageCircle, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Ticket } from "@/lib/api/types";
import { playAlert, setAlertSound, useAlertSound } from "@/lib/alertSound";
import { cn } from "@/lib/cn";
import { q } from "@/lib/queries";
import { useNow } from "@/lib/useNow";

// Live chat visitors waiting for a reply. A chat nobody is on, where the visitor waits
// for a person (Ollie handed off, or the agent is off), is urgent: the row washes red
// with a live timer. While Ollie is handling it the state is calm and violet, and turns
// urgent if Ollie has not answered within a minute.

/** How long Ollie may take before a waiting visitor needs a person. */
const OLLIE_GRACE_MS = 60_000;

export type ChatWait = {
  /** When the visitor started waiting. */
  since: number;
  /** urgent: a person must answer now. ollie: Ollie is on it. */
  state: "urgent" | "ollie";
  /** Ollie handed the conversation to the team. */
  handedOff: boolean;
};

/** Whether the widget agent answers visitors in this workspace. */
export function useAgentOn(): boolean {
  const { data } = useQuery(q.aiConfig());
  return !!data?.enabled && !!data.features?.widget_answers;
}

/** The visitor's wait on an open chat, or null when nobody is waiting. */
export function chatWait(t: Ticket, agentOn: boolean, now: number): ChatWait | null {
  if (t.channel !== "chat" || t.spam || (t.status !== "open" && t.status !== "pending")) return null;
  const handedOff = t.custom?.ai_handoff === true;
  const handoffAt = typeof t.custom?.ai_handoff_at === "string" ? Date.parse(t.custom.ai_handoff_at) : NaN;
  let since = t.waiting_since ? Date.parse(t.waiting_since) : NaN;
  // Ollie's handoff line answers the visitor, but they now wait for the team, unless a
  // person already replied after it.
  if (Number.isNaN(since) && handedOff && !Number.isNaN(handoffAt)) {
    const teamReplied = !!t.first_responded_at && Date.parse(t.first_responded_at) >= handoffAt;
    if (!teamReplied) since = handoffAt;
  }
  if (Number.isNaN(since)) return null;
  const ollieOn = agentOn && !handedOff && !t.assignee;
  const state = ollieOn && now - since < OLLIE_GRACE_MS ? "ollie" : "urgent";
  return { since, state, handedOff };
}

/** 45s, 3m 12s, 1h 04m, 2d 3h. */
export function formatWait(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** The pulsing dot of a waiting timer. */
function PingDot({ tone }: { tone: "red" | "violet" }) {
  return (
    <span className="relative flex size-1.5 shrink-0">
      <span
        className={cn(
          "absolute inset-0 rounded-full animate-urgent-ping motion-reduce:hidden",
          tone === "red" ? "bg-tone-red-solid" : "bg-tone-violet-solid",
        )}
      />
      <span className={cn("relative size-1.5 rounded-full", tone === "red" ? "bg-tone-red-solid" : "bg-tone-violet-solid")} />
    </span>
  );
}

/** "Waiting 3m 12s" (urgent) or "Ollie is replying" (calm), ticking every second. */
export function WaitPill({ wait, compact }: { wait: ChatWait; compact?: boolean }) {
  const { t } = useTranslation("inbox");
  const now = useNow();
  const elapsed = formatWait(now - wait.since);
  if (wait.state === "ollie") {
    return (
      <span
        className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-tone-violet-soft px-2 text-[11px] font-medium text-tone-violet"
        title={t("waiting.ollieHint")}
      >
        <PingDot tone="violet" />
        {t("waiting.ollie")}
      </span>
    );
  }
  return (
    <span
      role="timer"
      aria-label={t("waiting.aria", { time: elapsed })}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-tone-red-solid px-2 font-semibold text-white shadow-[0_0_0_1px_var(--tone-red-line)]",
        compact ? "text-[10.5px]" : "text-[11px]",
      )}
    >
      <span className="relative flex size-1.5 shrink-0">
        <span className="absolute inset-0 rounded-full bg-white animate-urgent-ping motion-reduce:hidden" />
        <span className="relative size-1.5 rounded-full bg-white" />
      </span>
      <span className="mono tabular-nums">{t(compact ? "waiting.short" : "waiting.label", { time: elapsed })}</span>
    </span>
  );
}

/** Marks a ticket from the website chat widget, so it is never mistaken for email. */
export function LiveChatBadge({ urgent }: { urgent?: boolean }) {
  const { t } = useTranslation("inbox");
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[10.5px] font-medium",
        urgent ? "bg-tone-red-soft text-tone-red" : "bg-tone-blue-soft text-tone-blue",
      )}
      title={t("waiting.chatHint")}
    >
      <MessageCircle className="size-3" strokeWidth={2.2} />
      {t("waiting.chat")}
    </span>
  );
}

/** The red wash of an urgent row or banner; a static tint under reduced motion. */
export const urgentWash = "bg-tone-red-soft animate-urgent-wash";

/** The glowing red edge on the left of an urgent row. */
export function UrgentEdge() {
  return <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-[3px] bg-tone-red-solid animate-urgent-edge" />;
}

/** The visitor's wait on this ticket, re-checked every second for chats only. */
export function useChatWait(t: Ticket): ChatWait | null {
  const agentOn = useAgentOn();
  const now = useNow(t.channel === "chat");
  return chatWait(t, agentOn, now || Date.now());
}

/**
 * Above the list: how many visitors wait in live chat with nobody on it and the longest
 * wait, with a jump to that conversation and the alert sound switch.
 */
export function WaitingBanner({ tickets, onOpen }: { tickets: Ticket[]; onOpen: (t: Ticket) => void }) {
  const { t } = useTranslation("inbox");
  const agentOn = useAgentOn();
  const now = useNow();
  const sound = useAlertSound();
  const urgent = tickets
    .filter((x) => !x.assignee)
    .map((x) => ({ ticket: x, wait: chatWait(x, agentOn, now) }))
    .filter((x): x is { ticket: Ticket; wait: ChatWait } => x.wait?.state === "urgent")
    .sort((a, b) => a.wait.since - b.wait.since);
  if (!urgent.length) return null;
  const longest = urgent[0];
  const name = longest.ticket.contact?.name || longest.ticket.contact?.email || t("row.unknown");
  return (
    <div className={cn("relative flex h-10 w-full shrink-0 items-center overflow-hidden border-b border-tone-red-line", urgentWash)}>
      <UrgentEdge />
      <button
        type="button"
        onClick={() => onOpen(longest.ticket)}
        title={t("waiting.longestHint", { name })}
        className="group relative flex h-full min-w-0 flex-1 items-center gap-2.5 pl-3.5 pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tone-red-solid"
      >
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inset-0 rounded-full bg-tone-red-solid animate-urgent-ping motion-reduce:hidden" />
          <span className="relative size-2 rounded-full bg-tone-red-solid" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-tone-red">{t("waiting.banner", { count: urgent.length })}</span>
        <span className="mono shrink-0 text-[11.5px] font-semibold tabular-nums text-tone-red">{formatWait(now - longest.wait.since)}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-tone-red-solid px-2 py-1 text-[11.5px] font-semibold text-white transition-transform duration-100 group-hover:translate-x-0.5 group-active:scale-95">
          {t("waiting.reply")}
          <ArrowRight className="size-3" />
        </span>
      </button>
      <button
        type="button"
        aria-pressed={sound}
        aria-label={t(sound ? "waiting.soundOn" : "waiting.soundOff")}
        title={t(sound ? "waiting.soundOn" : "waiting.soundOff")}
        onClick={() => {
          setAlertSound(!sound);
          if (!sound) playAlert("reminder");
        }}
        className="relative mr-2 flex size-7 shrink-0 items-center justify-center rounded-md text-tone-red outline-none transition-colors duration-100 hover:bg-tone-red-soft focus-visible:ring-2 focus-visible:ring-tone-red-solid active:scale-95"
      >
        {sound ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
      </button>
    </div>
  );
}
