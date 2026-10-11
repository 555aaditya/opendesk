import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Layers, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { SettingsPage, Section, ListRow } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { ListSkeleton, ReorderButtons } from "@/components/settings2/bits";
import { moveItem, useListMutation } from "@/components/settings2/optimistic";
import {
  MultiPick,
  SinglePick,
  channelItems,
  priorityItems,
  statusItems,
  useMailboxItems,
  useMemberItems,
  useTagItems,
  useTeamItems,
} from "@/components/settings2/pickers";
import { channelLabel, priorityLabel, statusLabel } from "@/components/tickets/bits";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Channel, Priority, TicketFilters, TicketStatus, View } from "@/lib/api/types";
import { q, qk, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";

/** A one-line plain description of a view's filters. */
function useDescribe() {
  const members = useQuery(q.members()).data;
  const teams = useQuery(q.teams()).data;
  const mailboxes = useQuery(q.mailboxes()).data;
  return (f: TicketFilters): string => {
    const parts: string[] = [];
    if (f.status?.length) parts.push(f.status.map((s) => statusLabel[s]).join(" or "));
    if (f.priority?.length) parts.push(`${f.priority.map((p) => priorityLabel[p]).join(" or ")} priority`);
    if (f.assignee === "me") parts.push("assigned to the viewer");
    else if (f.assignee === "none") parts.push("unassigned");
    else if (f.assignee) parts.push(`assigned to ${members?.find((m) => m.user.id === f.assignee)?.user.name ?? "a teammate"}`);
    if (f.team_id) parts.push(`team ${teams?.find((t) => t.id === f.team_id)?.name ?? "unknown"}`);
    if (f.mailbox_id) parts.push(`in ${mailboxes?.find((m) => m.id === f.mailbox_id)?.email ?? "a mailbox"}`);
    if (f.tag) parts.push(`tagged ${f.tag}`);
    if (f.channel) parts.push(`via ${channelLabel[f.channel]}`);
    if (f.q) parts.push(`matching “${f.q}”`);
    return parts.length ? parts.join(" · ") : "All tickets";
  };
}

export default function Views() {
  const { data: views, isLoading } = useQuery(q.views());
  const role = useRole();
  const canEdit = atLeast(role, "agent");
  const confirm = useConfirm();
  const describe = useDescribe();
  const [editing, setEditing] = useState<View | "new" | null>(null);
  const navigate = useNavigate();

  const sorted = useMemo(() => [...(views ?? [])].sort((a, b) => a.position - b.position), [views]);

  const toggleShared = useListMutation<View, { id: string; shared: boolean }>(
    qk.views,
    (v) => api.views.update(v.id, { shared: v.shared }),
    (rows, v) => rows.map((r) => (r.id === v.id ? { ...r, shared: v.shared } : r)),
    { errorText: "Couldn't update the view" },
  );
  const reorder = useListMutation<View, { id: string; dir: -1 | 1 }>(
    qk.views,
    async (v) => {
      const next = moveItem(sorted, v.id, v.dir);
      const changed = next.filter((n) => sorted.find((o) => o.id === n.id)?.position !== n.position);
      await Promise.all(changed.map((n) => api.views.update(n.id, { position: n.position })));
    },
    (rows, v) => moveItem(rows, v.id, v.dir),
    { errorText: "Couldn't reorder views" },
  );
  const remove = useListMutation<View, string>(qk.views, (id) => api.views.remove(id), (rows, id) => rows.filter((r) => r.id !== id), {
    errorText: "Couldn't delete the view",
  });

  return (
    <SettingsPage
      title="Views"
      description="Saved filters that sit in everyone's sidebar under Views, with a live count. Order here is the order in the sidebar."
      actions={
        canEdit && (
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
            New view
          </Button>
        )
      }
    >
      <Section flush>
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : !sorted.length ? (
          <EmptyState
            compact
            lit={0}
            title="No views yet"
            description="A view is a saved filter, like urgent tickets for the billing team."
            action={
              canEdit && (
                <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
                  New view
                </Button>
              )
            }
          />
        ) : (
          sorted.map((v, i) => (
            <ListRow key={v.id} onClick={canEdit ? () => setEditing(v) : undefined}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line text-fg-3">
                <Layers className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{v.name}</div>
                <div className="truncate text-[12px] text-fg-3">{describe(v.filters)}</div>
              </div>
              {canEdit && (
                <>
                  <label className="hidden items-center gap-2 text-[12px] text-fg-3 sm:flex" onClick={(e) => e.stopPropagation()}>
                    Shared
                    <Switch
                      checked={v.shared}
                      onCheckedChange={(shared) => toggleShared.mutate({ id: v.id, shared })}
                      aria-label={`Show ${v.name} to everyone`}
                    />
                  </label>
                  <ReorderButtons
                    label={v.name}
                    first={i === 0}
                    last={i === sorted.length - 1}
                    disabled={reorder.isPending}
                    onUp={() => reorder.mutate({ id: v.id, dir: -1 })}
                    onDown={() => reorder.mutate({ id: v.id, dir: 1 })}
                  />
                  <Menu>
                    <MenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Actions for ${v.name}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem icon={<Pencil />} onSelect={() => setEditing(v)}>
                        Edit
                      </MenuItem>
                      <MenuItem icon={<ArrowUpRight />} onSelect={() => void navigate({ to: "/views/$viewId/{-$ticketId}", params: { viewId: v.id, ticketId: undefined } })}>
                        Open view
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        danger
                        icon={<Trash2 />}
                        onSelect={() =>
                          confirm.show(
                            <>
                              <span className="font-medium text-fg">{v.name}</span> will disappear from the sidebar for everyone. Tickets are not affected.
                            </>,
                            () => remove.mutateAsync(v.id),
                            { title: "Delete this view?", confirmLabel: "Delete view", danger: true },
                          )
                        }
                      >
                        Delete
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </>
              )}
            </ListRow>
          ))
        )}
      </Section>
      {editing && <ViewDrawer view={editing === "new" ? null : editing} nextPosition={sorted.length} onClose={() => setEditing(null)} />}
    </SettingsPage>
  );
}

function ViewDrawer({ view, nextPosition, onClose }: { view: View | null; nextPosition: number; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = useState(view?.name ?? "");
  const [shared, setShared] = useState(view?.shared ?? true);
  const [f, setF] = useState<TicketFilters>(view?.filters ?? { status: ["open"] });
  const [error, setError] = useState<string | null>(null);
  const members = useMemberItems();
  const teams = useTeamItems();
  const mailboxes = useMailboxItems();
  const tags = useTagItems();

  const initial = JSON.stringify({ name: view?.name ?? "", shared: view?.shared ?? true, f: view?.filters ?? { status: ["open"] } });
  const dirty = JSON.stringify({ name, shared, f }) !== initial;

  const requestClose = () => {
    if (!dirty) return onClose();
    confirm.show("Your changes to this view will be lost.", onClose, { title: "Discard changes?", confirmLabel: "Discard", danger: true });
  };

  const save = useMutation({
    mutationFn: () => {
      const filters = clean(f);
      return view
        ? api.views.update(view.id, { name: name.trim(), shared, filters })
        : api.views.create({ name: name.trim(), shared, filters, position: nextPosition });
    },
    onSuccess: (v) => {
      upsertInList(qc, qk.views, v);
      void qc.invalidateQueries({ queryKey: qk.counts });
      toast.success(view ? "View saved" : "View created");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const set = <K extends keyof TicketFilters>(k: K, v: TicketFilters[K] | undefined) => setF((cur) => ({ ...cur, [k]: v }));

  const assigneeItems = [
    { value: "me", label: "The person viewing" },
    { value: "none", label: "Unassigned" },
    ...members,
  ];

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && requestClose()}
      title={view ? "Edit view" : "New view"}
      width={480}
      onEscapeKeyDown={(e) => {
        if (dirty) {
          e.preventDefault();
          requestClose();
        }
      }}
      onInteractOutside={(e) => {
        e.preventDefault();
        requestClose();
      }}
    >
      <form
        className="flex min-h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!name.trim()) return setError("Give the view a name.");
          save.mutate();
        }}
      >
        <div className="flex flex-1 flex-col gap-5 p-5">
          <Field label="Name">
            {(p) => <TextInput {...p} autoFocus value={name} maxLength={60} placeholder="Billing queue" onChange={(e) => setName(e.target.value)} />}
          </Field>
          <div className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium">Visible to everyone</div>
              <div className="text-[12px] text-fg-3">Off keeps it in your sidebar only.</div>
            </div>
            <Switch checked={shared} onCheckedChange={setShared} aria-label="Visible to everyone" />
          </div>

          <div>
            <div className="label-caps mb-2">Show tickets where</div>
            <div className="flex flex-col rounded-lg border border-line">
              <FilterRow label="Status" onClear={f.status?.length ? () => set("status", undefined) : undefined}>
                <MultiPick items={statusItems} values={f.status ?? []} onChange={(v) => set("status", v as TicketStatus[])} placeholder="Any status" />
              </FilterRow>
              <FilterRow label="Priority" onClear={f.priority?.length ? () => set("priority", undefined) : undefined}>
                <MultiPick items={priorityItems} values={f.priority ?? []} onChange={(v) => set("priority", v as Priority[])} placeholder="Any priority" />
              </FilterRow>
              <FilterRow label="Assignee" onClear={f.assignee ? () => set("assignee", undefined) : undefined}>
                <SinglePick items={assigneeItems} value={f.assignee} onChange={(v) => set("assignee", v)} placeholder="Anyone" />
              </FilterRow>
              <FilterRow label="Team" onClear={f.team_id ? () => set("team_id", undefined) : undefined}>
                <SinglePick items={teams} value={f.team_id} onChange={(v) => set("team_id", v)} placeholder="Any team" />
              </FilterRow>
              <FilterRow label="Mailbox" onClear={f.mailbox_id ? () => set("mailbox_id", undefined) : undefined}>
                <SinglePick items={mailboxes} value={f.mailbox_id} onChange={(v) => set("mailbox_id", v)} placeholder="Any mailbox" width={300} />
              </FilterRow>
              <FilterRow label="Tag" onClear={f.tag ? () => set("tag", undefined) : undefined}>
                <SinglePick items={tags} value={f.tag} onChange={(v) => set("tag", v)} placeholder="Any tag" />
              </FilterRow>
              <FilterRow label="Channel" onClear={f.channel ? () => set("channel", undefined) : undefined}>
                <SinglePick items={channelItems} value={f.channel} onChange={(v) => set("channel", v as Channel)} placeholder="Any channel" />
              </FilterRow>
              <FilterRow label="Keyword" onClear={f.q ? () => set("q", undefined) : undefined}>
                <TextInput
                  inputSize="sm"
                  value={f.q ?? ""}
                  placeholder="Subject, contact or text"
                  aria-label="Keyword"
                  onChange={(e) => set("q", e.target.value || undefined)}
                  className="w-full"
                />
              </FilterRow>
            </div>
          </div>
          {view && (
            <Link
              to="/views/$viewId/{-$ticketId}"
              params={{ viewId: view.id, ticketId: undefined }}
              className="inline-flex w-fit items-center gap-1 text-[12.5px] text-fg-3 underline-offset-2 hover:text-fg hover:underline"
            >
              Open this view <ArrowUpRight className="size-3.5" />
            </Link>
          )}
        </div>
        <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-surface px-5 py-3">
          <span className="flex-1 text-xs text-danger-fg">{error}</span>
          <Button variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={save.isPending}>
            {view ? "Save view" : "Create view"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function FilterRow({ label, children, onClear }: { label: string; children: React.ReactNode; onClear?: () => void }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-line-soft px-3 last:border-0">
      <span className="w-[72px] shrink-0 text-[12.5px] text-fg-3">{label}</span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      <button
        type="button"
        aria-label={`Clear ${label.toLowerCase()}`}
        onClick={onClear}
        disabled={!onClear}
        className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-fg-4 hover:bg-hover hover:text-fg disabled:invisible"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function clean(f: TicketFilters): TicketFilters {
  const out: TicketFilters = {};
  if (f.status?.length) out.status = f.status;
  if (f.priority?.length) out.priority = f.priority;
  if (f.assignee) out.assignee = f.assignee;
  if (f.team_id) out.team_id = f.team_id;
  if (f.mailbox_id) out.mailbox_id = f.mailbox_id;
  if (f.tag) out.tag = f.tag;
  if (f.channel) out.channel = f.channel;
  if (f.q?.trim()) out.q = f.q.trim();
  return out;
}
