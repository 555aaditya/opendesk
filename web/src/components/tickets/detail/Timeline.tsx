import { useQuery } from "@tanstack/react-query";
import { AlarmClock, Hand, ShieldAlert, Sparkles, ArrowRightLeft, CircleDot, GitMerge, Star, Tag as TagIcon, TimerOff, Users, UserRound, Signal } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { Activity, Member, Message, Priority, Team, TicketStatus, UserRef } from "@/lib/api/types";
import { dayLabel, fullDate, relShort, shortDate } from "@/lib/format";
import { q } from "@/lib/queries";
import { useRealtime, isCustomerTyping } from "@/lib/realtime/store";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { priorityLabel, StatusIcon, statusLabel } from "../bits";
import { MessageItem } from "./MessageItem";

type Item = { kind: "message"; at: string; m: Message } | { kind: "activity"; at: string; a: Activity };

/** A user in activity data: a UserRef, or a user id (resolved through the members list). */
function ref(v: unknown, members: Member[] | undefined): UserRef | null {
  if (v && typeof v === "object" && "name" in (v as object)) return v as UserRef;
  if (typeof v === "string") return members?.find((m) => m.user.id === v)?.user ?? { id: v, name: "a former member", email: "", avatar_url: "" };
  return null;
}

function actorName(a: Activity) {
  if (a.actor.user) return a.actor.user.name;
  if (typeof a.data.automation_name === "string") return `Automation “${a.data.automation_name}”`;
  if (a.actor.type === "automation") return "An automation";
  if (a.actor.type === "contact") return "The customer";
  if (a.actor.type === "ai") return "AI";
  return "opendesk";
}

function describe(a: Activity, teams: Team[] | undefined, members: Member[] | undefined): { icon: ReactNode; text: ReactNode; tone?: "danger" } {
  const who = <span className="font-medium text-fg-2">{actorName(a)}</span>;
  const d = a.data;
  switch (a.type) {
    case "status_changed": {
      const to = d.to as TicketStatus;
      return {
        icon: statusLabel[to] ? <StatusIcon status={to} className="size-3" /> : <CircleDot />,
        text: (
          <>
            {who} marked this <span className="font-medium text-fg-2">{(statusLabel[to] ?? String(d.to)).toLowerCase()}</span>
          </>
        ),
      };
    }
    case "priority_changed":
      return {
        icon: <Signal />,
        text: (
          <>
            {who} set priority to <span className="font-medium text-fg-2">{priorityLabel[d.to as Priority] ?? String(d.to)}</span>
          </>
        ),
      };
    case "assigned": {
      const to = ref(d.to, members);
      return {
        icon: <UserRound />,
        text: to ? (
          a.actor.user?.id === to.id ? (
            <>{who} took this ticket</>
          ) : (
            <>
              {who} assigned this to <span className="font-medium text-fg-2">{to.name}</span>
            </>
          )
        ) : (
          <>{who} unassigned this ticket</>
        ),
      };
    }
    case "team_changed": {
      const name = typeof d.to === "string" ? (teams?.find((t) => t.id === d.to)?.name ?? d.to) : null;
      return { icon: <Users />, text: name ? <>{who} moved this to <span className="font-medium text-fg-2">{name}</span></> : <>{who} removed the team</> };
    }
    case "tagged":
    case "untagged": {
      const tag = typeof d.tag === "string" ? d.tag : (d.tag as { name?: string } | undefined)?.name;
      return {
        icon: <TagIcon />,
        text: (
          <>
            {who} {a.type === "tagged" ? "added" : "removed"} <span className="font-medium text-fg-2">{tag}</span>
          </>
        ),
      };
    }
    case "sla_breached":
      return { icon: <TimerOff />, tone: "danger", text: <>{d.kind === "first_response" ? "First response" : "Resolution"} target was missed</> };
    case "subject_changed":
      return { icon: <ArrowRightLeft />, text: <>{who} changed the subject</> };
    case "snoozed":
      return { icon: <AlarmClock />, text: <>{who} snoozed this{typeof d.until === "string" ? <> until <span className="mono text-fg-2">{shortDate(d.until)}</span></> : null}</> };
    case "unsnoozed":
      return { icon: <AlarmClock />, text: <>Snooze ended</> };
    case "marked_spam":
      return { icon: <ShieldAlert />, text: <>{who} marked this as spam</> };
    case "unmarked_spam":
      return { icon: <ShieldAlert />, text: <>{who} moved this out of spam</> };
    case "custom_updated":
      return { icon: <ArrowRightLeft />, text: <>{who} updated {Array.isArray(d.keys) ? <span className="mono text-fg-2">{(d.keys as string[]).join(", ")}</span> : "custom fields"}</> };
    case "merged": {
      const into = typeof d.into_number === "number" ? { number: d.into_number } : typeof d.into === "object" ? (d.into as { number?: number }) : undefined;
      const from = typeof d.from_number === "number" ? { number: d.from_number } : (d.from as { number?: number } | undefined);
      return {
        icon: <GitMerge />,
        text: into ? (
          <>
            {who} merged this into <span className="mono text-fg-2">#{into.number}</span>
          </>
        ) : (
          <>
            {who} merged <span className="mono text-fg-2">#{from?.number}</span> into this ticket
          </>
        ),
      };
    }
    case "csat_received":
      return {
        icon: <Star />,
        text: (
          <>
            The customer rated this <span className="mono font-medium text-fg-2">{String(d.score)}/5</span>
            {typeof d.comment === "string" && d.comment ? <span className="text-fg-3"> · “{d.comment}”</span> : null}
          </>
        ),
      };
    case "ai_triaged":
      return {
        icon: <Sparkles />,
        text: (
          <>
            {who} triaged this{typeof d.category === "string" ? <> as <span className="font-medium text-fg-2">{d.category.replace(/_/g, " ")}</span></> : null}
          </>
        ),
      };
    case "ai_answered":
      return { icon: <Sparkles />, text: <>{who} answered from the knowledge base</> };
    case "ai_handoff":
      return { icon: <Hand />, text: <>{a.actor.type === "contact" ? "The customer asked for a person" : "AI handed this to the team"}</> };
    default:
      return { icon: <ArrowRightLeft />, text: <>{who} updated this ticket <span className="mono text-fg-4">{a.type}</span></> };
  }
}

function ActivityLine({ a }: { a: Activity }) {
  const { data: teams } = useQuery(q.teams());
  const { data: members } = useQuery(q.members());
  const { icon, text, tone } = describe(a, teams, members);
  return (
    <div className="flex items-center gap-2.5 py-1 pl-[18px] text-[12px] text-fg-3">
      <span className={`flex size-5 shrink-0 items-center justify-center rounded-sm border bg-surface [&_svg]:size-3 ${tone === "danger" ? "border-[color-mix(in_srgb,var(--danger)_35%,var(--line))] text-danger-fg" : "border-line text-fg-3"}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <Tooltip content={fullDate(a.created_at)}>
        <time dateTime={a.created_at} className="mono shrink-0 text-[10.5px] text-fg-4">
          {relShort(a.created_at)}
        </time>
      </Tooltip>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1 animate-bounce rounded-full bg-fg-3" style={{ animationDelay: `${i * 120}ms`, animationDuration: "900ms" }} />
      ))}
    </span>
  );
}

export function TypingIndicator({ ticketId, contactName }: { ticketId: string; contactName?: string }) {
  const typing = useRealtime((s) => s.typing[ticketId]);
  const customerAt = useRealtime((s) => s.customerTyping[ticketId]);
  const agents = (typing ?? []).filter((t) => Date.now() - t.at < 5000);
  const customer = isCustomerTyping(customerAt);
  if (!agents.length && !customer) return null;
  const who = customer ? (contactName ?? "The customer") : agents.map((a) => a.name.split(" ")[0]).join(", ");
  return (
    <div aria-live="polite" className="flex items-center gap-2 py-1 pl-[18px] text-[12px] text-fg-3">
      <span className="flex size-5 items-center justify-center rounded-sm border border-line bg-surface">
        <TypingDots />
      </span>
      {who} {agents.length > 1 && !customer ? "are" : "is"} typing
    </div>
  );
}

export function Timeline({
  ticketId,
  messages,
  activities,
  loading,
  onRetry,
  contactName,
}: {
  ticketId: string;
  messages: Message[] | undefined;
  activities: Activity[] | undefined;
  loading: boolean;
  onRetry: (m: Message) => void;
  contactName?: string;
}) {
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [
      ...(messages ?? []).map((m) => ({ kind: "message" as const, at: m.created_at, m })),
      ...(activities ?? []).map((a) => ({ kind: "activity" as const, at: a.created_at, a })),
    ];
    return out.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  }, [messages, activities]);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const count = items.length;

  // Open at the latest message; follow new ones only if already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [count, loading]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => (atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, []);

  let lastDay = "";
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversation" role="log">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-2 px-5 py-5">
        {loading ? (
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-lg border border-line p-4">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-6 rounded-sm" />
                  <Skeleton className="h-2.5 w-32" />
                </div>
                <div className="mt-4 flex flex-col gap-2 pl-[34px]">
                  <Skeleton className="h-2.5 w-[85%]" />
                  <Skeleton className="h-2.5 w-[70%]" />
                  <Skeleton className="h-2.5 w-[40%]" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          items.map((it) => {
            const day = dayLabel(it.at);
            const sep = day !== lastDay;
            lastDay = day;
            return (
              <Fragment key={it.kind === "message" ? it.m.id : it.a.id}>
                {sep && (
                  <div className="flex items-center gap-3 py-2" role="separator">
                    <span className="h-px flex-1 bg-line-soft" />
                    <span className="text-[11px] font-medium text-fg-4">{day}</span>
                    <span className="h-px flex-1 bg-line-soft" />
                  </div>
                )}
                {it.kind === "message" ? <MessageItem m={it.m} onRetry={onRetry} /> : <ActivityLine a={it.a} />}
              </Fragment>
            );
          })
        )}
        <TypingIndicator ticketId={ticketId} contactName={contactName} />
      </div>
    </div>
  );
}
