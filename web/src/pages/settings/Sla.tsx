import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Timer, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import { ListSkeleton, ReorderButtons } from "@/components/settings2/bits";
import { moveItem, useListMutation } from "@/components/settings2/optimistic";
import { PriorityIcon, priorityLabel, priorityOrder } from "@/components/tickets/bits";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Priority, SlaPolicy } from "@/lib/api/types";
import { minutes } from "@/lib/format";
import { q, qk, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";

type Unit = "m" | "h" | "d";
const factor: Record<Unit, number> = { m: 1, h: 60, d: 1440 };

function split(total: number): { n: number; unit: Unit } {
  if (total > 0 && total % 1440 === 0) return { n: total / 1440, unit: "d" };
  if (total > 0 && total % 60 === 0) return { n: total / 60, unit: "h" };
  return { n: total, unit: "m" };
}

export default function Sla() {
  const role = useRole();
  const { data: policies, isLoading } = useQuery({ ...q.slaPolicies(), enabled: atLeast(role, "admin") });
  const confirm = useConfirm();
  const [editing, setEditing] = useState<SlaPolicy | "new" | null>(null);
  const sorted = useMemo(() => [...(policies ?? [])].sort((a, b) => a.position - b.position), [policies]);

  const toggle = useListMutation<SlaPolicy, { id: string; enabled: boolean }>(
    qk.slaPolicies,
    (v) => api.slaPolicies.update(v.id, { enabled: v.enabled }),
    (rows, v) => rows.map((r) => (r.id === v.id ? { ...r, enabled: v.enabled } : r)),
    { errorText: "Couldn't update the policy" },
  );
  const reorder = useListMutation<SlaPolicy, { id: string; dir: -1 | 1 }>(
    qk.slaPolicies,
    async (v) => {
      const next = moveItem(sorted, v.id, v.dir);
      const changed = next.filter((n) => sorted.find((o) => o.id === n.id)?.position !== n.position);
      await Promise.all(changed.map((n) => api.slaPolicies.update(n.id, { position: n.position })));
    },
    (rows, v) => moveItem(rows, v.id, v.dir),
    { errorText: "Couldn't reorder policies" },
  );
  const remove = useListMutation<SlaPolicy, string>(qk.slaPolicies, (id) => api.slaPolicies.remove(id), (rows, id) => rows.filter((r) => r.id !== id), {
    errorText: "Couldn't delete the policy",
  });

  if (!atLeast(role, "admin"))
    return (
      <SettingsPage title="SLA policies">
        <NoAccess what="SLA policies" />
      </SettingsPage>
    );

  return (
    <SettingsPage
      title="SLA policies"
      description="Response and resolution targets. Policies are checked from top to bottom, and the first enabled one that matches a ticket's priority applies."
      actions={
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
          New policy
        </Button>
      }
    >
      <Section flush>
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : !sorted.length ? (
          <EmptyState
            compact
            lit={3}
            title="No SLA policies"
            description="Without a policy, tickets have no due times."
            action={
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
                New policy
              </Button>
            }
          />
        ) : (
          sorted.map((p, i) => (
            <ListRow key={p.id} onClick={() => setEditing(p)} className={p.enabled ? undefined : "[&_.sla-dim]:opacity-50"}>
              <span className="mono w-5 shrink-0 text-center text-[11px] tabular-nums text-fg-4">{i + 1}</span>
              <div className="sla-dim min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium">{p.name}</span>
                  <span className="inline-flex items-center gap-1 text-[12px] text-fg-3">
                    {p.priority ? (
                      <>
                        <PriorityIcon priority={p.priority} className="size-3" /> {priorityLabel[p.priority]}
                      </>
                    ) : (
                      "All priorities"
                    )}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[12px] text-fg-3">
                  <span>
                    First response <span className="mono text-fg-2">{minutes(p.first_response_minutes)}</span>
                  </span>
                  <span className="text-fg-4">·</span>
                  <span>
                    Resolution <span className="mono text-fg-2">{minutes(p.resolution_minutes)}</span>
                  </span>
                </div>
              </div>
              <Switch checked={p.enabled} onCheckedChange={(enabled) => toggle.mutate({ id: p.id, enabled })} aria-label={`Enable ${p.name}`} />
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
                    aria-label={`Actions for ${p.name}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem icon={<Pencil />} onSelect={() => setEditing(p)}>
                    Edit
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    icon={<Trash2 />}
                    onSelect={() =>
                      confirm.show(
                        <>
                          Tickets under <span className="font-medium text-fg">{p.name}</span> keep their current due times. New tickets fall through to the next matching policy.
                        </>,
                        () => remove.mutateAsync(p.id),
                        { title: "Delete this policy?", confirmLabel: "Delete policy", danger: true },
                      )
                    }
                  >
                    Delete
                  </MenuItem>
                </MenuContent>
              </Menu>
            </ListRow>
          ))
        )}
      </Section>
      <p className="-mt-4 flex items-center gap-1.5 text-[12px] text-fg-3">
        <Timer className="size-3.5" /> Due times are shown on tickets and in the list. A breach notifies the assignee.
      </p>
      {editing && <PolicyDialog policy={editing === "new" ? null : editing} nextPosition={sorted.length} onClose={() => setEditing(null)} />}
    </SettingsPage>
  );
}

function DurationField({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  const [unit, setUnit] = useState<Unit>(() => split(value).unit);
  const n = Math.round((value / factor[unit]) * 100) / 100;
  return (
    <Field label={label} hint={hint}>
      {(p) => (
        <div className="flex items-center gap-2">
          <NumberInput id={p.id} aria-describedby={p["aria-describedby"]} value={n} min={1} onChange={(v) => onChange(Math.max(1, Math.round(v * factor[unit])))} className="w-[120px]" />
          <Segmented
            size="sm"
            value={unit}
            onChange={setUnit}
            options={[
              { value: "m", label: "Minutes" },
              { value: "h", label: "Hours" },
              { value: "d", label: "Days" },
            ]}
          />
        </div>
      )}
    </Field>
  );
}

function PolicyDialog({ policy, nextPosition, onClose }: { policy: SlaPolicy | null; nextPosition: number; onClose: () => void }) {
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
      toast.success(policy ? "Policy saved" : "Policy created");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("Give the policy a name.");
    if (resolution < first) return setError("Resolution can't be sooner than the first response.");
    save.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={policy ? "Edit SLA policy" : "New SLA policy"}
      description="Business hours aren't applied: targets count calendar time."
      footer={
        <>
          <span className="mr-auto text-xs text-danger-fg">{error}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {policy ? "Save policy" : "Create policy"}
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
        <Field label="Name">
          {(p) => <TextInput {...p} autoFocus value={name} maxLength={80} placeholder="Urgent tickets" onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Applies to">
          {(p) => (
            <Select
              id={p.id}
              value={priority}
              onChange={setPriority}
              options={[
                { value: "any", label: "Any priority" },
                ...priorityOrder.map((x) => ({ value: x, label: `${priorityLabel[x]} priority`, icon: <PriorityIcon priority={x} /> })),
              ]}
            />
          )}
        </Field>
        <DurationField label="First response within" value={first} onChange={setFirst} hint={`Currently ${minutes(first)}`} />
        <DurationField label="Resolve within" value={resolution} onChange={setResolution} hint={`Currently ${minutes(resolution)}`} />
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
