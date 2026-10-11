import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SettingsPage, Section, ListRow } from "@/components/layout";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Drawer } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Field, TextInput } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Picker } from "@/components/ui/picker";
import { SkeletonRows } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Member, Team } from "@/lib/api/types";
import { q, qk, removeFromList, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";

export default function Teams() {
  const role = useRole();
  const admin = atLeast(role, "admin");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: teams, isLoading } = useQuery(q.teams());
  const { data: members } = useQuery(q.members());
  const [editing, setEditing] = useState<Team | "new" | null>(null);

  const byId = new Map((members ?? []).map((m) => [m.user.id, m]));

  const remove = async (t: Team) => {
    const prev = qc.getQueryData<Team[]>(qk.teams);
    removeFromList(qc, qk.teams, t.id);
    try {
      await api.teams.remove(t.id);
    } catch (e) {
      if (prev) qc.setQueryData(qk.teams, prev);
      throw e;
    }
  };

  return (
    <SettingsPage
      title="Teams"
      description="Group agents so tickets and mailboxes can be routed to the right people."
      actions={
        admin && (
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
            New team
          </Button>
        )
      }
    >
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : !teams?.length ? (
        <Section>
          <EmptyState
            lit={2}
            title="No teams yet"
            description="Create Support, Billing or Engineering and assign tickets to a whole team."
            action={
              admin && (
                <Button variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
                  New team
                </Button>
              )
            }
          />
        </Section>
      ) : (
        <Section flush>
          {teams.map((t) => {
            const people = t.member_ids.map((id) => byId.get(id)).filter((m): m is Member => !!m);
            return (
              <ListRow key={t.id} onClick={admin ? () => setEditing(t) : undefined}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-hover text-[12px] font-semibold text-fg-2">
                  {t.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{t.name}</div>
                  <div className="text-xs text-fg-3">
                    {t.member_ids.length} {t.member_ids.length === 1 ? "member" : "members"}
                  </div>
                </div>
                <AvatarStack people={people.map((m) => ({ id: m.user.id, name: m.user.name, avatar: m.user.avatar_url }))} max={5} size="md" />
                {admin && (
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="sm" variant="ghost" square aria-label={`Actions for ${t.name}`} onClick={(e) => e.stopPropagation()}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem icon={<Pencil />} onSelect={() => setEditing(t)}>
                        Edit
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        danger
                        icon={<Trash2 />}
                        onSelect={() =>
                          confirm.show(`Tickets and mailboxes routed to ${t.name} keep their assignee but lose the team.`, () => remove(t), {
                            title: "Delete team?",
                            confirmLabel: "Delete",
                            danger: true,
                          })
                        }
                      >
                        Delete
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </ListRow>
            );
          })}
        </Section>
      )}
      {editing && <TeamDrawer team={editing === "new" ? null : editing} members={members ?? []} onClose={() => setEditing(null)} />}
    </SettingsPage>
  );
}

function TeamDrawer({ team, members, onClose }: { team: Team | null; members: Member[]; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = useState(team?.name ?? "");
  const [ids, setIds] = useState<string[]>(team?.member_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== (team?.name ?? "") || ids.join() !== (team?.member_ids ?? []).join();

  const save = useMutation({
    mutationFn: () => (team ? api.teams.update(team.id, { name: name.trim(), member_ids: ids }) : api.teams.create({ name: name.trim(), member_ids: ids })),
    onMutate: () => {
      const prev = qc.getQueryData<Team[]>(qk.teams);
      if (team) upsertInList(qc, qk.teams, { ...team, name: name.trim(), member_ids: ids });
      return { prev };
    },
    onSuccess: (t) => {
      upsertInList(qc, qk.teams, t);
      toast.success(team ? "Team saved" : "Team created");
      onClose();
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.teams, ctx.prev);
      setError(errorMessage(e));
    },
  });

  const requestClose = () => {
    if (!dirty) return onClose();
    confirm.show("Your changes to this team will be lost.", onClose, { title: "Discard changes?", confirmLabel: "Discard", danger: true });
  };

  const selected = members.filter((m) => ids.includes(m.user.id));

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && requestClose()}
      onEscapeKeyDown={(e) => {
        if (dirty) {
          e.preventDefault();
          requestClose();
        }
      }}
      onInteractOutside={(e) => {
        if (dirty) {
          e.preventDefault();
          requestClose();
        }
      }}
      title={team ? "Edit team" : "New team"}
      width={440}
    >
      <form
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Give the team a name.");
          save.mutate();
        }}
      >
        <div className="flex flex-1 flex-col gap-5 p-4">
          <Field label="Name" error={error}>
            {({ id, invalid }) => (
              <TextInput id={id} autoFocus invalid={invalid} value={name} maxLength={60} placeholder="Support" onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium">Members</span>
              <Picker
                multi
                values={ids}
                onChange={setIds}
                placeholder="Search members"
                align="end"
                items={members
                  .filter((m) => m.role !== "viewer")
                  .map((m) => ({ value: m.user.id, label: m.user.name, hint: m.role, icon: <Avatar name={m.user.name} src={m.user.avatar_url} size="xs" /> }))}
                trigger={
                  <Button size="sm" iconRight={<ChevronDown className="size-3 text-fg-4" />}>
                    Add members
                  </Button>
                }
              />
            </div>
            {selected.length ? (
              <div className="rounded-md border border-line">
                {selected.map((m) => (
                  <div key={m.user.id} className="flex h-10 items-center gap-2.5 border-b border-line-soft px-3 last:border-0">
                    <Avatar name={m.user.name} src={m.user.avatar_url} size="sm" />
                    <span className="flex-1 truncate text-[12.5px]">{m.user.name}</span>
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-xs text-fg-3 hover:bg-hover hover:text-fg"
                      onClick={() => setIds((cur) => cur.filter((x) => x !== m.user.id))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-fg-3">No members yet</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line p-3">
          <Button variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {team ? "Save team" : "Create team"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
