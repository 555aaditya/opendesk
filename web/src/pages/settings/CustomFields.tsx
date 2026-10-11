// Settings > Custom fields: typed fields for tickets, contacts and companies,
// with options, colours, "required to solve", archive and reorder.

import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPage, Section } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { IconTile, ListSkeleton, ReorderButtons } from "@/components/settings2/bits";
import { MotionList, MotionRow } from "@/components/settings2/motion";
import { FieldDialog } from "@/components/settings2/fields/FieldDialog";
import { ENTITIES, hasOptions, typeIcon, typeTone, useCustomFields, useFieldWrites, type CustomField, type FieldEntity } from "@/components/settings2/fields/model";
import { cn } from "@/lib/cn";
import { atLeast, useRole } from "@/lib/session";
import { tone as tones } from "@/lib/tones";

export default function CustomFields() {
  const { t } = useTranslation("settings");
  const role = useRole();
  const canEdit = atLeast(role, "admin");
  const confirm = useConfirm();
  const { fields, available, isLoading } = useCustomFields();
  const writes = useFieldWrites();
  const [entity, setEntity] = useState<FieldEntity>("ticket");
  const [editing, setEditing] = useState<CustomField | "new" | null>(null);

  const mine = fields.filter((f) => f.entity === entity).sort((a, b) => a.position - b.position);
  const active = mine.filter((f) => !f.archived);
  const archived = mine.filter((f) => f.archived);
  const count = (e: FieldEntity) => fields.filter((f) => f.entity === e && !f.archived).length;

  const move = (f: CustomField, dir: -1 | 1) => {
    const ids = active.map((x) => x.id);
    const i = ids.indexOf(f.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    writes.reorder(entity, ids).catch((e) => toast.error(e));
  };

  const row = (f: CustomField, i: number, list: CustomField[]) => (
    <MotionRow key={f.id}>
      <div
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onClick={canEdit ? () => setEditing(f) : undefined}
        onKeyDown={(e) => {
          if (canEdit && e.key === "Enter" && e.target === e.currentTarget) setEditing(f);
        }}
        className={cn("group flex min-h-12 items-center gap-3 px-4 py-2", canEdit && "cursor-pointer transition-colors hover:bg-sunken", f.archived && "opacity-65")}
      >
        <IconTile tone={typeTone[f.type]}>{typeIcon[f.type]}</IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{f.name}</span>
            {f.required_on_solve && <Badge tone="amber">{t("fields.requiredBadge")}</Badge>}
            {f.archived && <Badge>{t("fields.archivedBadge")}</Badge>}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-fg-3">
            <span>{t(`fields.type.${f.type}`)}</span>
            <span className="text-fg-4">·</span>
            <span className="mono truncate text-[11px] text-fg-4">{f.key}</span>
          </div>
        </div>
        {hasOptions(f.type) && (
          <span className="hidden max-w-[280px] items-center gap-1 overflow-hidden md:flex">
            {f.options.slice(0, 4).map((o) => (
              <span key={o.id} className={cn("inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium", tones[o.color].chip)}>
                <span className={cn("size-1.5 rounded-xs", tones[o.color].solid)} />
                {o.label}
              </span>
            ))}
            {f.options.length > 4 && <span className="mono text-[11px] text-fg-4">+{f.options.length - 4}</span>}
          </span>
        )}
        {canEdit && !f.archived && (
          <span className="opacity-100 transition-opacity focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
            <ReorderButtons label={f.name} first={i === 0} last={i === list.length - 1} onUp={() => move(f, -1)} onDown={() => move(f, 1)} />
          </span>
        )}
        {canEdit && (
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant="ghost" square aria-label={t("fields.actionsAria", { name: f.name })} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="size-4" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Pencil />} onSelect={() => setEditing(f)}>
                {t("fields.menu.edit")}
              </MenuItem>
              <MenuItem
                icon={f.archived ? <ArchiveRestore /> : <Archive />}
                onSelect={() => writes.update(f.id, { archived: !f.archived }).catch((e) => toast.error(e))}
              >
                {f.archived ? t("fields.menu.restore") : t("fields.menu.archive")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                danger
                icon={<Trash2 />}
                onSelect={() =>
                  confirm.show(t("fields.deleteBody", { name: f.name }), () => writes.remove(f.id), {
                    title: t("fields.deleteTitle"),
                    confirmLabel: t("fields.deleteConfirm"),
                    danger: true,
                  })
                }
              >
                {t("fields.menu.delete")}
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>
    </MotionRow>
  );

  return (
    <SettingsPage
      title={t("fields.title")}
      description={t("fields.description")}
      actions={
        canEdit &&
        available && (
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
            {t("fields.new")}
          </Button>
        )
      }
    >
      {!available && !isLoading ? (
        <Section>
          <EmptyState lit={0} title={t("fields.unavailable.title")} description={t("fields.unavailable.description")} />
        </Section>
      ) : (
        <>
          <div className="-mb-4 flex items-center justify-between gap-3">
            <Segmented
              value={entity}
              onChange={setEntity}
              options={ENTITIES.map((e) => ({
                value: e,
                label: (
                  <span className="flex items-center gap-1.5">
                    {t(`fields.entityPlural.${e}`)}
                    <span className="mono text-[10.5px] tabular-nums text-fg-4">{count(e)}</span>
                  </span>
                ),
              }))}
            />
          </div>
          <Section flush title={t("fields.listTitle", { entity: t(`fields.entity.${entity}`) })} description={entity === "ticket" ? t("fields.ticketHint") : undefined}>
            {isLoading ? (
              <ListSkeleton rows={4} />
            ) : !active.length ? (
              <EmptyState
                compact
                lit={1}
                title={t("fields.empty.title", { entity: t(`fields.entity.${entity}`).toLowerCase() })}
                description={t(`fields.empty.${entity}`)}
                action={
                  canEdit && (
                    <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
                      {t("fields.new")}
                    </Button>
                  )
                }
              />
            ) : (
              <MotionList>{active.map((f, i) => row(f, i, active))}</MotionList>
            )}
          </Section>
          {archived.length > 0 && (
            <Section flush title={t("fields.archivedTitle", { count: archived.length })}>
              <MotionList>{archived.map((f, i) => row(f, i, archived))}</MotionList>
            </Section>
          )}
        </>
      )}
      {editing && (
        <FieldDialog
          field={editing === "new" ? null : editing}
          entity={editing === "new" ? entity : editing.entity}
          existing={fields}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            if (editing === "new") await writes.create(v);
            else await writes.update(editing.id, v);
            toast.success(editing === "new" ? t("fields.created") : t("fields.saved"));
          }}
        />
      )}
    </SettingsPage>
  );
}
