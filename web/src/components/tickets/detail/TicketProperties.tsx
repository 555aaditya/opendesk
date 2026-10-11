import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock, Hash, Inbox, Star, Users } from "lucide-react";
import { forwardRef, useEffect, useState, type ReactNode } from "react";
import type { Priority, Ticket, TicketStatus } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { fullDate, minutes, relLong, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useRole, atLeast } from "@/lib/session";
import { Picker } from "@/components/ui/picker";
import { Avatar } from "@/components/ui/avatar";
import { TagChip } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { Tooltip } from "@/components/ui/tooltip";
import { ContactCard } from "@/components/contacts/ContactCard";
import { TicketAiPanel } from "@/components/ai/ticket/AiPanel";
import { ChannelIcon, channelLabel, PriorityIcon, priorityLabel, priorityOrder, slaState, StatusIcon, statusLabel, statusOrder } from "../bits";
import { useUpdateTicket } from "../useTicketActions";

const PropButton = forwardRef<HTMLButtonElement, { children: ReactNode; disabled?: boolean; placeholder?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function PropButton({ children, disabled, placeholder, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          "group flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[12.5px] outline-none transition-colors hover:bg-hover focus-visible:shadow-[0_0_0_2px_var(--focus)] disabled:pointer-events-none data-[state=open]:bg-hover [&_svg]:shrink-0",
          placeholder ? "text-fg-4" : "text-fg",
          className,
        )}
        {...rest}
      >
        {children}
        <ChevronDown className="ml-auto size-3 text-fg-4 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    );
  },
);

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-1">
      <span className="w-[76px] shrink-0 text-[12px] text-fg-3">{label}</span>
      <div className="flex min-w-0 flex-1">{children}</div>
    </div>
  );
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function SlaTimers({ t }: { t: Ticket }) {
  const now = useNow();
  const { data: policies } = useQuery(q.slaPolicies());
  if (!t.sla) return null;
  const policy = policies?.find((p) => p.id === t.sla!.policy_id);
  const rows: { label: string; due: string | null; done: string | null }[] = [
    { label: "First response", due: t.sla.first_response_due_at, done: t.first_responded_at },
    { label: "Resolution", due: t.sla.resolution_due_at, done: t.solved_at },
  ];
  const active = slaState(t, now);
  return (
    <section className="border-b border-line-soft px-4 py-3.5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="label-caps">SLA</h3>
        {policy && <span className="truncate text-[11px] text-fg-4">{policy.name}</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          if (!r.due) return null;
          const left = Math.round((Date.parse(r.due) - now) / 60000);
          const met = r.done && Date.parse(r.done) <= Date.parse(r.due);
          const missed = (r.done && !met) || (!r.done && left < 0);
          const isActive = active?.kind === r.label;
          return (
            <div key={r.label} className="flex items-center gap-2 text-[12.5px]">
              <span className={cn("size-1.5 shrink-0 rounded-full", missed ? "bg-danger" : met ? "bg-ok" : left < 60 ? "bg-warn" : "bg-fg-4")} />
              <span className={cn("flex-1", isActive ? "text-fg" : "text-fg-3")}>{r.label}</span>
              <Tooltip content={`Due ${fullDate(r.due)}`}>
                <span className={cn("mono text-[11.5px] tabular-nums", missed ? "text-danger-fg" : isActive ? "text-fg" : "text-fg-3")}>
                  {r.done ? (met ? "Met" : "Missed") : left < 0 ? `${minutes(-left)} over` : `${minutes(left)} left`}
                </span>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function TicketProperties({ t, assignOpen, onAssignOpenChange }: { t: Ticket; assignOpen: boolean; onAssignOpenChange: (o: boolean) => void }) {
  const update = useUpdateTicket();
  const role = useRole();
  const canEdit = atLeast(role, "agent");
  const { data: members } = useQuery(q.members());
  const { data: teams } = useQuery(q.teams());
  const { data: tags } = useQuery(q.tags());
  const { data: mailboxes } = useQuery(q.mailboxes());
  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) => update.mutate({ id: t.id, patch: p });
  const team = teams?.find((x) => x.id === t.team_id);
  const mailbox = mailboxes?.find((m) => m.id === t.mailbox_id);
  const tagNames = t.tags.map((x) => x.name);

  return (
    <div className="flex flex-col">
      <section className="border-b border-line-soft px-2.5 py-2.5">
        <Prop label="Status">
          <Picker
            value={t.status}
            placeholder="Set status"
            items={statusOrder.map((s) => ({ value: s, label: statusLabel[s], icon: <StatusIcon status={s} /> }))}
            onSelect={(v) => patch({ status: v as TicketStatus })}
            trigger={
              <PropButton disabled={!canEdit}>
                <StatusIcon status={t.status} />
                {statusLabel[t.status]}
              </PropButton>
            }
          />
        </Prop>
        <Prop label="Priority">
          <Picker
            value={t.priority}
            placeholder="Set priority"
            items={priorityOrder.map((p) => ({ value: p, label: priorityLabel[p], icon: <PriorityIcon priority={p} /> }))}
            onSelect={(v) => patch({ priority: v as Priority })}
            trigger={
              <PropButton disabled={!canEdit}>
                <PriorityIcon priority={t.priority} />
                {priorityLabel[t.priority]}
              </PropButton>
            }
          />
        </Prop>
        <Prop label="Assignee">
          <Picker
            open={assignOpen}
            onOpenChange={onAssignOpenChange}
            value={t.assignee?.id ?? "__none"}
            placeholder="Assign to"
            items={[
              { value: "__none", label: "Unassigned", icon: <span className="size-4 rounded-[3px] border border-dashed border-line-strong" /> },
              ...(members ?? [])
                .filter((m) => m.role !== "viewer")
                .map((m) => ({ value: m.user.id, label: m.user.name, keywords: [m.user.email], icon: <Avatar name={m.user.name} src={m.user.avatar_url} size="xs" /> })),
            ]}
            onSelect={(v) => patch({ assignee_id: v === "__none" ? null : v })}
            trigger={
              <PropButton disabled={!canEdit} placeholder={!t.assignee}>
                {t.assignee ? <Avatar name={t.assignee.name} src={t.assignee.avatar_url} size="xs" /> : <span className="size-4 rounded-[3px] border border-dashed border-line-strong" />}
                <span className="truncate">{t.assignee?.name ?? "Unassigned"}</span>
              </PropButton>
            }
          />
        </Prop>
        <Prop label="Team">
          <Picker
            value={t.team_id ?? "__none"}
            placeholder="Choose a team"
            items={[{ value: "__none", label: "No team" }, ...(teams ?? []).map((x) => ({ value: x.id, label: x.name, icon: <Users className="size-3.5 text-fg-3" /> }))]}
            onSelect={(v) => patch({ team_id: v === "__none" ? null : v })}
            trigger={
              <PropButton disabled={!canEdit} placeholder={!team}>
                <Users className="size-3.5 text-fg-3" />
                <span className="truncate">{team?.name ?? "No team"}</span>
              </PropButton>
            }
          />
        </Prop>
        <div className="flex items-start gap-1 py-1">
          <span className="w-[76px] shrink-0 pt-1.5 text-[12px] text-fg-3">Tags</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 px-1 py-1">
            {t.tags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} color={tag.color} onRemove={canEdit ? () => patch({ tags: tagNames.filter((n) => n !== tag.name) }) : undefined} />
            ))}
            {canEdit && (
              <Picker
                multi
                values={tagNames}
                placeholder="Add or create a tag"
                createLabel="Create tag"
                items={(tags ?? []).map((x) => ({ value: x.name, label: x.name }))}
                onChange={(v) => patch({ tags: v })}
                onCreate={(name) => patch({ tags: [...tagNames, name] })}
                trigger={
                  <button type="button" className="inline-flex h-[18px] items-center rounded-sm border border-dashed border-line-strong px-1.5 text-[11px] text-fg-3 hover:border-fg-4 hover:text-fg">
                    {t.tags.length ? "Add" : "Add tag"}
                  </button>
                }
              />
            )}
          </div>
        </div>
      </section>

      <TicketAiPanel t={t} />

      <SlaTimers t={t} />

      {t.snoozed_until && Date.parse(t.snoozed_until) > Date.now() && (
        <section className="flex items-center gap-2 border-b border-line-soft px-4 py-3 text-[12.5px]">
          <Clock className="size-3.5 text-fg-3" />
          <span className="flex-1 text-fg-2">Snoozed until {shortDate(t.snoozed_until)}</span>
          {canEdit && (
            <button type="button" onClick={() => patch({ snoozed_until: null, status: "open" })} className="text-xs text-fg-3 hover:text-fg">
              Unsnooze
            </button>
          )}
        </section>
      )}

      {t.csat && (
        <section className="border-b border-line-soft px-4 py-3.5">
          <h3 className="label-caps mb-2">Satisfaction</h3>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} className={cn("size-3.5", i <= t.csat!.score ? "fill-fg text-fg" : "text-line-strong")} />
            ))}
            <span className="mono ml-1 text-[11.5px] text-fg-3">{t.csat.score}/5</span>
          </div>
          {t.csat.comment && (
            <p className="mt-2 text-[12.5px] leading-5 text-fg-2" data-ph-mask>
              “{t.csat.comment}”
            </p>
          )}
        </section>
      )}

      {t.contact && (
        <section className="border-b border-line-soft">
          <div className="px-4 py-3.5">
            <ContactCard contactId={t.contact.id} compact excludeTicketId={t.id} />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-1.5 px-4 py-3.5 text-[12px]">
        <h3 className="label-caps mb-1">Details</h3>
        <div className="flex items-center gap-2 text-fg-3">
          <Hash className="size-3.5" />
          <span className="flex-1">Ticket</span>
          <span className="mono text-fg-2">#{t.number}</span>
          <CopyButton value={`${location.origin}/inbox/open/${t.id}`} label="Copy link" className="size-5" />
        </div>
        <div className="flex items-center gap-2 text-fg-3">
          <ChannelIcon channel={t.channel} />
          <span className="flex-1">Channel</span>
          <span className="text-fg-2">{channelLabel[t.channel]}</span>
        </div>
        {mailbox && (
          <div className="flex items-center gap-2 text-fg-3">
            <Inbox className="size-3.5" />
            <span className="flex-1">Mailbox</span>
            <span className="mono truncate text-fg-2">{mailbox.email}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-fg-3">
          <Clock className="size-3.5" />
          <span className="flex-1">Created</span>
          <Tooltip content={fullDate(t.created_at)}>
            <span className="text-fg-2">{relLong(t.created_at)}</span>
          </Tooltip>
        </div>
      </section>
    </div>
  );
}
