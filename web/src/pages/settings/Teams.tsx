import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Inbox, MoreHorizontal, Pencil, Plus, Trash2, UserCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconTile, ListSkeleton } from "@/components/settings2/bits";
import { MotionList, MotionRow } from "@/components/settings2/motion";
import { toneFor } from "@/lib/tones";
import { SettingsPage, Section, ListRow } from "@/components/layout";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Drawer } from "@/components/ui/dialog";
import { SettingsEmpty } from "@/components/settings2/SettingsEmpty";
import { Field, TextInput } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Picker } from "@/components/ui/picker";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Member, Team } from "@/lib/api/types";
import { q, qk, removeFromList, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";

export default function Teams() {
  const { t: tr } = useTranslation("settings");
  const role = useRole();
  const admin = atLeast(role, "admin");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: teams, isLoading } = useQuery(q.teams());
  const { data: members } = useQuery(q.members());
  const { data: mailboxes } = useQuery(q.mailboxes());
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
      title={tr("teams.title")}
      description={tr("teams.description")}
      actions={
        admin && (
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
            {tr("teams.new")}
          </Button>
        )
      }
    >
      {isLoading ? (
        <Section flush>
          <ListSkeleton rows={3} />
        </Section>
      ) : !teams?.length ? (
        <Section flush>
          <SettingsEmpty
            art="contacts"
            ghost="people"
            title={tr("teams.emptyTitle")}
            description={tr("teams.emptyHint")}
            action={
              admin && (
                <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
                  {tr("teams.new")}
                </Button>
              )
            }
            tips={[
              { label: tr("teams.emptyTips.mailbox"), icon: <Inbox /> },
              { label: tr("teams.emptyTips.delete"), icon: <UserCheck /> },
            ]}
          />
        </Section>
      ) : (
        <Section flush title={tr("teams.count", { count: teams.length })}>
          <MotionList>
          {teams.map((t) => {
            const people = t.member_ids.map((id) => byId.get(id)).filter((m): m is Member => !!m);
            return (
              <MotionRow key={t.id}>
              <ListRow onClick={admin ? () => setEditing(t) : undefined}>
                <IconTile tone={toneFor(t.name)} className="text-[12px] font-semibold">
                  {t.name.charAt(0).toUpperCase()}
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{t.name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-fg-3">
                    <span>{people.length ? people.slice(0, 3).map((m) => m.user.name.split(" ")[0]).join(", ") + (people.length > 3 ? tr("teams.andMore", { count: people.length - 3 }) : "") : tr("teams.noMembers")}</span>
                    {(() => {
                      const n = (mailboxes ?? []).filter((m) => m.team_id === t.id).length;
                      return n ? (
                        <>
                          <span className="text-fg-4">·</span>
                          <span className="inline-flex items-center gap-1">
                            <Inbox className="size-3 text-fg-4" />
                            {tr("teams.mailboxes", { count: n })}
                          </span>
                        </>
                      ) : null;
                    })()}
                  </div>
                </div>
                <span className="mono hidden w-16 text-right text-[11px] tabular-nums text-fg-4 sm:block">{tr("teams.members", { count: t.member_ids.length })}</span>
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
                        {tr("teams.edit")}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        danger
                        icon={<Trash2 />}
                        onSelect={() =>
                          confirm.show(tr("teams.deleteBody", { name: t.name }), () => remove(t), {
                            title: tr("teams.deleteTitle"),
                            confirmLabel: tr("teams.delete"),
                            danger: true,
                          })
                        }
                      >
                        {tr("teams.delete")}
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </ListRow>
              </MotionRow>
            );
          })}
          </MotionList>
        </Section>
      )}
      {editing && <TeamDrawer team={editing === "new" ? null : editing} members={members ?? []} onClose={() => setEditing(null)} />}
    </SettingsPage>
  );
}

function TeamDrawer({ team, members, onClose }: { team: Team | null; members: Member[]; onClose: () => void }) {
  const { t } = useTranslation("settings");
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
    onSuccess: (saved) => {
      upsertInList(qc, qk.teams, saved);
      toast.success(team ? t("teams.saved") : t("teams.created"));
      onClose();
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.teams, ctx.prev);
      setError(errorMessage(e));
    },
  });

  const requestClose = () => {
    if (!dirty) return onClose();
    confirm.show(t("teams.discardBody"), onClose, { title: t("teams.discardTitle"), confirmLabel: t("teams.discard"), danger: true });
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
      title={team ? t("teams.editTitle") : t("teams.new")}
      width={440}
    >
      <form
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError(t("teams.nameRequired"));
          save.mutate();
        }}
      >
        <div className="flex flex-1 flex-col gap-5 p-4">
          <Field label={t("teams.name")} error={error}>
            {({ id, invalid }) => (
              <TextInput id={id} autoFocus invalid={invalid} value={name} maxLength={60} placeholder={t("teams.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium">{t("teams.membersLabel")}</span>
              <Picker
                multi
                values={ids}
                onChange={setIds}
                placeholder={t("teams.searchMembers")}
                align="end"
                items={members
                  .filter((m) => m.role !== "viewer")
                  .map((m) => ({ value: m.user.id, label: m.user.name, hint: m.role, icon: <Avatar name={m.user.name} src={m.user.avatar_url} size="xs" /> }))}
                trigger={
                  <Button size="sm" iconRight={<ChevronDown className="size-3 text-fg-4" />}>
                    {t("teams.addMembers")}
                  </Button>
                }
              />
            </div>
            {selected.length ? (
              <div className="rounded-md border border-line">
                {selected.map((m) => (
                  <div key={m.user.id} className="group flex h-10 items-center gap-2.5 border-b border-line-soft px-3 last:border-0">
                    <Avatar name={m.user.name} src={m.user.avatar_url} size="sm" />
                    <span className="flex-1 truncate text-[12.5px]">{m.user.name}</span>
                    <button
                      type="button"
                      className="rounded-sm px-1.5 py-0.5 text-xs text-fg-3 opacity-0 transition-opacity hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={() => setIds((cur) => cur.filter((x) => x !== m.user.id))}
                    >
                      {t("teams.remove")}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-fg-3">{t("teams.noMembers")}</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line p-3">
          <Button variant="ghost" onClick={requestClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {team ? t("teams.save") : t("teams.create")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
