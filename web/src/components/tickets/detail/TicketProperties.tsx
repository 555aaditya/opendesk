import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock, Hash, Inbox, Star, Users } from "lucide-react";
import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Priority, Ticket, TicketStatus } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { fullDate, minutes, relLong, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { tone } from "@/lib/tones";
import { useRole, atLeast } from "@/lib/session";
import { Picker } from "@/components/ui/picker";
import { Avatar } from "@/components/ui/avatar";
import { TagChip } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { Tooltip } from "@/components/ui/tooltip";
import { ContactCard } from "@/components/contacts/ContactCard";
import { TicketAiPanel } from "@/components/ai/ticket/AiPanel";
import { ChannelIcon, channelLabel, PriorityIcon, priorityOrder, slaState, StatusIcon, statusOrder } from "../bits";
import { LabelPicker } from "./LabelPicker";
import { SetByJev, useAISet } from "../jev";
import { FieldsSection } from "./FieldsSection";
import { useDisplay, type FieldPatch, type TicketWithFields } from "../fields";
import { useUpdateTicket } from "../useTicketActions";

const PropButton = forwardRef<HTMLButtonElement, { children: ReactNode; disabled?: boolean; placeholder?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function PropButton({ children, disabled, placeholder, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          "group flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[12.5px] outline-none transition-[background-color,transform] duration-150 hover:bg-hover focus-visible:shadow-[0_0_0_2px_var(--focus)] active:scale-[0.99] disabled:pointer-events-none data-[state=open]:bg-hover [&_svg]:shrink-0",
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

function Prop({ label, children, shortcut }: { label: string; children: ReactNode; shortcut?: string }) {
  return (
    <div className="flex min-h-8 items-center gap-1">
      <span className="flex w-[76px] shrink-0 items-center text-[12px] text-fg-3" title={shortcut ? `${label} (${shortcut.toUpperCase()})` : undefined}>
        {label}
      </span>
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
  const { t: tr } = useTranslation("inbox");
  const now = useNow();
  const { data: policies } = useQuery(q.slaPolicies());
  if (!t.sla) return null;
  const policy = policies?.find((p) => p.id === t.sla!.policy_id);
  const rows: { kind: string; label: string; due: string | null; done: string | null }[] = [
    { kind: "First response", label: tr("sla.firstResponse"), due: t.sla.first_response_due_at, done: t.first_responded_at },
    { kind: "Resolution", label: tr("sla.resolution"), due: t.sla.resolution_due_at, done: t.solved_at },
  ];
  const active = slaState(t, now);
  return (
    <section className="border-b border-line-soft px-4 py-3.5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="label-caps">{tr("sla.title")}</h3>
        {policy && <span className="truncate text-[11px] text-fg-4">{policy.name}</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          if (!r.due) return null;
          const left = Math.round((Date.parse(r.due) - now) / 60000);
          const met = r.done && Date.parse(r.done) <= Date.parse(r.due);
          const missed = (r.done && !met) || (!r.done && left < 0);
          const isActive = active?.kind === r.kind;
          const soon = !r.done && !missed && left < 60;
          return (
            <div key={r.kind} className="flex items-center gap-2 text-[12.5px]">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  missed ? tone.red.solid : met ? tone.green.solid : soon ? tone.amber.solid : isActive ? tone.green.solid : "bg-fg-4",
                  missed && !r.done && "animate-pulse-soft motion-reduce:animate-none",
                )}
              />
              <span className={cn("flex-1", isActive ? "text-fg" : "text-fg-3")}>{r.label}</span>
              <Tooltip content={tr("sla.due", { when: fullDate(r.due) })}>
                <span
                  className={cn(
                    "mono inline-flex h-[18px] items-center rounded-sm px-1.5 text-[11px] tabular-nums",
                    missed ? tone.red.chip : soon ? tone.amber.chip : met ? tone.green.text : isActive ? "text-fg" : "text-fg-3",
                  )}
                >
                  {r.done ? (met ? tr("sla.met") : tr("sla.missed")) : left < 0 ? tr("sla.over", { time: minutes(-left) }) : tr("sla.left", { time: minutes(left) })}
                </span>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export type PropPicker = "status" | "priority" | "assignee" | null;

const unassignedIcon = <span className="size-4 rounded-xs border border-dashed border-line-strong" />;

export function TicketProperties({ t, picker, onPicker }: { t: Ticket; picker: PropPicker; onPicker: (p: PropPicker) => void }) {
  const { t: tr } = useTranslation("inbox");
  const update = useUpdateTicket();
  const role = useRole();
  const canEdit = atLeast(role, "agent");
  const { data: members } = useQuery(q.members());
  const { data: teams } = useQuery(q.teams());
  const display = useDisplay();
  const aiSet = useAISet(t.id);
  const { data: mailboxes } = useQuery(q.mailboxes());
  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) => update.mutate({ id: t.id, patch: p });
  const team = teams?.find((x) => x.id === t.team_id);
  const mailbox = mailboxes?.find((m) => m.id === t.mailbox_id);
  const tagNames = t.tags.map((x) => x.name);
  const openFor = (k: Exclude<PropPicker, null>) => ({ open: picker === k, onOpenChange: (o: boolean) => onPicker(o ? k : null) });

  return (
    <div className="flex flex-col">
      <section className="border-b border-line-soft px-2.5 py-2.5">
        <Prop label={tr("props.status")} shortcut="s">
          <Picker
            {...openFor("status")}
            value={t.status}
            placeholder={tr("props.setStatus")}
            items={statusOrder.map((s) => ({ value: s, label: display.status(s), icon: <StatusIcon status={s} /> }))}
            onSelect={(v) => patch({ status: v as TicketStatus })}
            trigger={
              <PropButton disabled={!canEdit}>
                <StatusIcon status={t.status} />
                {display.status(t.status)}
                {aiSet.status && <SetByJev />}
              </PropButton>
            }
          />
        </Prop>
        <Prop label={tr("props.priority")} shortcut="p">
          <Picker
            {...openFor("priority")}
            value={t.priority}
            placeholder={tr("props.setPriority")}
            items={priorityOrder.map((p) => ({ value: p, label: display.priority(p), icon: <PriorityIcon priority={p} /> }))}
            onSelect={(v) => patch({ priority: v as Priority })}
            trigger={
              <PropButton disabled={!canEdit}>
                <PriorityIcon priority={t.priority} />
                {display.priority(t.priority)}
                {aiSet.priority && <SetByJev />}
              </PropButton>
            }
          />
        </Prop>
        <Prop label={tr("props.assignee")} shortcut="a">
          <Picker
            {...openFor("assignee")}
            value={t.assignee?.id ?? "__none"}
            placeholder={tr("props.assignTo")}
            items={[
              { value: "__none", label: tr("props.unassigned"), icon: unassignedIcon },
              ...(members ?? [])
                .filter((m) => m.role !== "viewer")
                .map((m) => ({ value: m.user.id, label: m.user.name, keywords: [m.user.email], icon: <Avatar name={m.user.name} src={m.user.avatar_url} size="xs" /> })),
            ]}
            onSelect={(v) => patch({ assignee_id: v === "__none" ? null : v })}
            trigger={
              <PropButton disabled={!canEdit} placeholder={!t.assignee}>
                {t.assignee ? <Avatar name={t.assignee.name} src={t.assignee.avatar_url} size="xs" /> : unassignedIcon}
                <span className="truncate">{t.assignee?.name ?? tr("props.unassigned")}</span>
              </PropButton>
            }
          />
        </Prop>
        <Prop label={tr("props.team")}>
          <Picker
            value={t.team_id ?? "__none"}
            placeholder={tr("props.chooseTeam")}
            items={[{ value: "__none", label: tr("props.noTeam") }, ...(teams ?? []).map((x) => ({ value: x.id, label: x.name, icon: <Users className="size-3.5 text-fg-3" /> }))]}
            onSelect={(v) => patch({ team_id: v === "__none" ? null : v })}
            trigger={
              <PropButton disabled={!canEdit} placeholder={!team}>
                <Users className="size-3.5 text-fg-3" />
                <span className="truncate">{team?.name ?? tr("props.noTeam")}</span>
              </PropButton>
            }
          />
        </Prop>
        <div className="flex items-start gap-1 py-1">
          <span className="w-[76px] shrink-0 pt-1.5 text-[12px] text-fg-3">{tr("props.tags")}</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 px-1 py-1">
            {t.tags.map((tag) => (
              <span key={tag.id} className="relative animate-pop-in motion-reduce:animate-none">
                <TagChip name={tag.name} color={tag.color} onRemove={canEdit ? () => patch({ tags: tagNames.filter((n) => n !== tag.name) }) : undefined} />
                {aiSet.tags.has(tag.name) && <SetByJev className="absolute -right-1 -top-1 size-2.5 ring-1 ring-surface [&_svg]:size-[7px]" />}
              </span>
            ))}
            {canEdit && (
              <LabelPicker
                values={tagNames}
                onChange={(v) => patch({ tags: v })}
                trigger={
                  <button
                    type="button"
                    aria-label={tr("props.addTag")}
                    className="inline-flex h-[18px] items-center rounded-sm border border-dashed border-line-strong px-1.5 text-[11px] text-fg-3 outline-none transition-colors hover:border-fg-4 hover:text-fg focus-visible:shadow-[0_0_0_2px_var(--focus)]"
                  >
                    {t.tags.length ? tr("props.addTagShort") : tr("props.addTag")}
                  </button>
                }
              />
            )}
          </div>
        </div>
      </section>

      <FieldsSection
        values={(t as TicketWithFields).fields ?? {}}
        disabled={!canEdit}
        onChange={(key, v) => update.mutate({ id: t.id, patch: { fields: { [key]: v } } as FieldPatch })}
      />

      <TicketAiPanel t={t} />

      <SlaTimers t={t} />

      {t.snoozed_until && Date.parse(t.snoozed_until) > Date.now() && (
        <section className="flex items-center gap-2 border-b border-line-soft px-4 py-3 text-[12.5px]">
          <Clock className={cn("size-3.5", tone.violet.text)} />
          <span className="flex-1 text-fg-2">{tr("props.snoozedUntil", { when: shortDate(t.snoozed_until) })}</span>
          {canEdit && (
            <button type="button" onClick={() => patch({ snoozed_until: null, status: "open" })} className="rounded-sm px-1 text-xs text-fg-3 hover:bg-hover hover:text-fg">
              {tr("props.unsnooze")}
            </button>
          )}
        </section>
      )}

      {t.csat && (
        <section className="border-b border-line-soft px-4 py-3.5">
          <h3 className="label-caps mb-2">{tr("props.satisfaction")}</h3>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} className={cn("size-3.5", i <= t.csat!.score ? "fill-tone-amber-solid stroke-tone-amber-solid" : "text-line-strong")} />
            ))}
            <span className="mono ml-1.5 text-[11.5px] text-fg-3 tabular-nums">{t.csat.score}/5</span>
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
        <h3 className="label-caps mb-1">{tr("props.details")}</h3>
        <div className="flex items-center gap-2 text-fg-3">
          <Hash className="size-3.5" />
          <span className="flex-1">{tr("props.ticket")}</span>
          <span className="mono text-fg-2">#{t.number}</span>
          <CopyButton value={`${location.origin}/inbox/open/${t.id}`} label={tr("props.copyLink")} className="size-5" />
        </div>
        <div className="flex items-center gap-2 text-fg-3">
          <ChannelIcon channel={t.channel} />
          <span className="flex-1">{tr("props.channel")}</span>
          <span className="text-fg-2">{channelLabel[t.channel]}</span>
        </div>
        {mailbox && (
          <div className="flex items-center gap-2 text-fg-3">
            <Inbox className="size-3.5" />
            <span className="flex-1">{tr("props.mailbox")}</span>
            <span className="mono truncate text-fg-2">{mailbox.email}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-fg-3">
          <Clock className="size-3.5" />
          <span className="flex-1">{tr("props.created")}</span>
          <Tooltip content={fullDate(t.created_at)}>
            <span className="text-fg-2">{relLong(t.created_at)}</span>
          </Tooltip>
        </div>
      </section>
    </div>
  );
}
