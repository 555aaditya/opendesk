import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, MoreHorizontal, Pencil, Plus, Timer, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPage, Section, ListRow, NoAccess } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, NumberInput, TextInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { ListSkeleton, ReorderButtons, StatePill, SummaryStrip } from "@/components/settings2/bits";
import { MotionList, MotionRow } from "@/components/settings2/motion";
import { moveItem, useListMutation } from "@/components/settings2/optimistic";
import { PriorityIcon, PriorityPill, priorityLabel, priorityOrder } from "@/components/tickets/bits";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Priority, SlaPolicy } from "@/lib/api/types";
import { minutes } from "@/lib/format";
import { q, qk, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { cn } from "@/lib/cn";
import { tone, type Tone } from "@/lib/tones";

/** How tight a target is, as a hue: an hour or less runs hot, a few hours warm, the rest calm. */
function targetTone(mins: number, kind: "reply" | "resolve"): Tone {
  const hot = kind === "reply" ? 60 : 8 * 60;
  const warm = kind === "reply" ? 4 * 60 : 24 * 60;
  return mins <= hot ? "red" : mins <= warm ? "amber" : "gray";
}

/** A target as an SLA-style chip: a dot and the time, tinted by how tight it is. */
function TargetChip({ label, mins, kind, muted }: { label: string; mins: number; kind: "reply" | "resolve"; muted?: boolean }) {
  const hue = muted ? "gray" : targetTone(mins, kind);
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-[11px]",
        hue === "gray" ? "bg-sunken text-fg-2 ring-1 ring-inset ring-line-soft" : tone[hue].chip,
      )}
    >
      <Clock className="size-3 opacity-70" aria-hidden />
      <span>{label}</span>
      <span className="mono font-medium tabular-nums">{minutes(mins)}</span>
    </span>
  );
}

type Unit = "m" | "h" | "d";
const factor: Record<Unit, number> = { m: 1, h: 60, d: 1440 };

function split(total: number): { n: number; unit: Unit } {
  if (total > 0 && total % 1440 === 0) return { n: total / 1440, unit: "d" };
  if (total > 0 && total % 60 === 0) return { n: total / 60, unit: "h" };
  return { n: total, unit: "m" };
}

export default function Sla() {
  const { t } = useTranslation("settingsInbox");
  const role = useRole();
  const { data: policies, isLoading } = useQuery({
    ...q.slaPolicies(),
    enabled: atLeast(role, "admin"),
  });
  const confirm = useConfirm();
  const [editing, setEditing] = useState<SlaPolicy | "new" | null>(null);
  const sorted = useMemo(() => [...(policies ?? [])].sort((a, b) => a.position - b.position), [policies]);

  const toggle = useListMutation<SlaPolicy, { id: string; enabled: boolean }>(
    qk.slaPolicies,
    (v) => api.slaPolicies.update(v.id, { enabled: v.enabled }),
    (rows, v) => rows.map((r) => (r.id === v.id ? { ...r, enabled: v.enabled } : r)),
    { errorText: t("sla.updateFailed") },
  );
  const reorder = useListMutation<SlaPolicy, { id: string; dir: -1 | 1 }>(
    qk.slaPolicies,
    async (v) => {
      const next = moveItem(sorted, v.id, v.dir);
      const changed = next.filter((n) => sorted.find((o) => o.id === n.id)?.position !== n.position);
      await Promise.all(changed.map((n) => api.slaPolicies.update(n.id, { position: n.position })));
    },
    (rows, v) => moveItem(rows, v.id, v.dir),
    { errorText: t("sla.reorderFailed") },
  );
  const remove = useListMutation<SlaPolicy, string>(
    qk.slaPolicies,
    (id) => api.slaPolicies.remove(id),
    (rows, id) => rows.filter((r) => r.id !== id),
    {
      errorText: t("sla.deleteFailed"),
    },
  );

  if (!atLeast(role, "admin"))
    return (
      <SettingsPage title={t("sla.title")}>
        <NoAccess what="SLA policies" />
      </SettingsPage>
    );

  const on = sorted.filter((p) => p.enabled);
  const fastest = (k: "first_response_minutes" | "resolution_minutes") => (on.length ? minutes(Math.min(...on.map((p) => p[k]))) : "–");

  return (
    <SettingsPage
      title={t("sla.title")}
      description={t("sla.description")}
      actions={
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
          {t("sla.new")}
        </Button>
      }
    >
      {sorted.length > 0 && (
        <SummaryStrip
          items={[
            { label: t("sla.summary.policies"), value: sorted.length },
            {
              label: t("sla.summary.enabled"),
              value: on.length,
              tone: "green",
              hint: sorted.length > on.length ? t("sla.summary.off", { count: sorted.length - on.length }) : undefined,
            },
            {
              label: t("sla.summary.fastestReply"),
              value: <span className="mono text-[18px]">{fastest("first_response_minutes")}</span>,
            },
            {
              label: t("sla.summary.fastestResolve"),
              value: <span className="mono text-[18px]">{fastest("resolution_minutes")}</span>,
            },
          ]}
        />
      )}
      <div className="flex flex-col gap-3">
        <Section flush>
          {isLoading ? (
            <ListSkeleton rows={3} />
          ) : !sorted.length ? (
            <EmptyState
              compact
              lit={3}
              title={t("sla.emptyTitle")}
              description={t("sla.emptyHint")}
              action={
                <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
                  {t("sla.new")}
                </Button>
              }
            />
          ) : (
            <MotionList>
              {sorted.map((p, i) => (
                <MotionRow key={p.id}>
                  <ListRow onClick={() => setEditing(p)}>
                    <span className="mono w-4 shrink-0 text-center text-[11px] tabular-nums text-fg-4">{i + 1}</span>
                    
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("truncate text-[13px] font-medium", !p.enabled && "text-fg-2")}>{p.name}</span>
                        {p.priority ? (
                          <PriorityPill priority={p.priority} />
                        ) : (
                          <span className="inline-flex h-5 items-center rounded-sm bg-hover px-1.5 text-[11px] font-medium text-fg-2">
                            {t("sla.allPriorities")}
                          </span>
                        )}
                        {!p.enabled && <StatePill state="disabled">{t("sla.off")}</StatePill>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <TargetChip label={t("sla.firstResponse")} mins={p.first_response_minutes} kind="reply" muted={!p.enabled} />
                        <TargetChip label={t("sla.resolution")} mins={p.resolution_minutes} kind="resolve" muted={!p.enabled} />
                      </div>
                    </div>
                    <Switch
                      checked={p.enabled}
                      onCheckedChange={(enabled) => toggle.mutate({ id: p.id, enabled })}
                      aria-label={t("common.enable", { name: p.name })}
                    />
                    <ReorderButtons
                      label={p.name}
                      first={i === 0}
                      last={i === sorted.length - 1}
                      disabled={reorder.isPending}
                      onUp={() => reorder.mutate({ id: p.id, dir: -1 })}
                      onDown={() => reorder.mutate({ id: p.id, dir: 1 })}
                    />
                    <Menu>
                      <MenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("common.actionsFor", { name: p.name })}
                          onClick={(e) => e.stopPropagation()}
                          className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem icon={<Pencil />} onSelect={() => setEditing(p)}>
                          {t("common.edit")}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          danger
                          icon={<Trash2 />}
                          onSelect={() =>
                            confirm.show(
                              <>
                                {t("sla.deleteBodyBefore")} <span className="font-medium text-fg">{p.name}</span> {t("sla.deleteBodyAfter")}
                              </>,
                              () => remove.mutateAsync(p.id),
                              {
                                title: t("sla.deleteTitle"),
                                confirmLabel: t("sla.deleteConfirm"),
                                danger: true,
                              },
                            )
                          }
                        >
                          {t("common.delete")}
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </ListRow>
                </MotionRow>
              ))}
            </MotionList>
          )}
        </Section>
        <p className="flex items-center gap-1.5 px-1 text-[12px] text-fg-3">
          <Timer className="size-3.5" /> {t("sla.footnote")}
        </p>
      </div>
      {editing && <PolicyDialog policy={editing === "new" ? null : editing} nextPosition={sorted.length} onClose={() => setEditing(null)} />}
    </SettingsPage>
  );
}

function DurationField({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  const { t } = useTranslation("settingsInbox");
  const [unit, setUnit] = useState<Unit>(() => split(value).unit);
  const n = Math.round((value / factor[unit]) * 100) / 100;
  return (
    <Field label={label} hint={hint}>
      {(p) => (
        <div className="flex items-center gap-2">
          <NumberInput
            id={p.id}
            aria-describedby={p["aria-describedby"]}
            value={n}
            min={1}
            onChange={(v) => onChange(Math.max(1, Math.round(v * factor[unit])))}
            className="w-[120px]"
          />
          <Segmented
            size="sm"
            value={unit}
            onChange={setUnit}
            options={[
              { value: "m", label: t("sla.units.m") },
              { value: "h", label: t("sla.units.h") },
              { value: "d", label: t("sla.units.d") },
            ]}
          />
        </div>
      )}
    </Field>
  );
}

function PolicyDialog({ policy, nextPosition, onClose }: { policy: SlaPolicy | null; nextPosition: number; onClose: () => void }) {
  const { t } = useTranslation("settingsInbox");
  const qc = useQueryClient();
  const [name, setName] = useState(policy?.name ?? "");
  const [priority, setPriority] = useState<Priority | "any">(policy?.priority ?? "any");
  const [first, setFirst] = useState(policy?.first_response_minutes ?? 60);
  const [resolution, setResolution] = useState(policy?.resolution_minutes ?? 1440);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        priority: priority === "any" ? null : priority,
        first_response_minutes: first,
        resolution_minutes: resolution,
        enabled: policy?.enabled ?? true,
        position: policy?.position ?? nextPosition,
      };
      return policy ? api.slaPolicies.update(policy.id, body) : api.slaPolicies.create(body);
    },
    onSuccess: (p) => {
      upsertInList(qc, qk.slaPolicies, p);
      toast.success(policy ? t("sla.saved") : t("sla.created"));
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError(t("sla.needName"));
    if (resolution < first) return setError(t("sla.resolutionTooSoon"));
    save.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={policy ? t("sla.editTitle") : t("sla.newTitle")}
      description={t("sla.dialogHint")}
      footer={
        <>
          <span className="mr-auto text-xs text-danger-fg">{error}</span>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {policy ? t("sla.save") : t("sla.create")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t("sla.nameLabel")}>
          {(p) => <TextInput {...p} autoFocus value={name} maxLength={80} placeholder={t("sla.namePlaceholder")} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t("sla.appliesTo")}>
          {(p) => (
            <Select
              id={p.id}
              value={priority}
              onChange={setPriority}
              options={[
                { value: "any", label: t("sla.anyPriority") },
                ...priorityOrder.map((x) => ({
                  value: x,
                  label: t("sla.priorityOption", {
                    priority: priorityLabel[x],
                  }),
                  icon: <PriorityIcon priority={x} />,
                })),
              ]}
            />
          )}
        </Field>
        <DurationField label={t("sla.firstWithin")} value={first} onChange={setFirst} hint={t("sla.currently", { time: minutes(first) })} />
        <DurationField label={t("sla.resolveWithin")} value={resolution} onChange={setResolution} hint={t("sla.currently", { time: minutes(resolution) })} />
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
