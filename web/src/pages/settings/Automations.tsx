import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPage, Section, ListRow, NoAccess } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { IconTile, ListSkeleton, ReorderButtons, StatePill, SummaryStrip } from "@/components/settings2/bits";
import { MotionList, MotionRow } from "@/components/settings2/motion";
import { TriggerIcon } from "@/components/settings2/pickers";
import { moveItem, useListMutation } from "@/components/settings2/optimistic";
import { triggerShort, triggerTone } from "@/components/settings2/automation";
import { api } from "@/lib/api/endpoints";
import type { Automation } from "@/lib/api/types";
import { compact } from "@/lib/format";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";

export default function Automations() {
  const role = useRole();
  const admin = atLeast(role, "admin");
  const { data, isLoading } = useQuery({ ...q.automations(), enabled: admin });
  const { t } = useTranslation("settingsInbox");
  const navigate = useNavigate();
  const confirm = useConfirm();
  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => a.position - b.position), [data]);

  const toggle = useListMutation<Automation, { id: string; enabled: boolean }>(
    qk.automations,
    (v) => api.automations.update(v.id, { enabled: v.enabled }),
    (rows, v) => rows.map((r) => (r.id === v.id ? { ...r, enabled: v.enabled } : r)),
    { errorText: t("automations.updateFailed") },
  );
  const reorder = useListMutation<Automation, { id: string; dir: -1 | 1 }>(
    qk.automations,
    async (v) => {
      const next = moveItem(sorted, v.id, v.dir);
      const changed = next.filter((n) => sorted.find((o) => o.id === n.id)?.position !== n.position);
      await Promise.all(changed.map((n) => api.automations.update(n.id, { position: n.position })));
    },
    (rows, v) => moveItem(rows, v.id, v.dir),
    { errorText: t("automations.reorderFailed") },
  );
  const remove = useListMutation<Automation, string>(
    qk.automations,
    (id) => api.automations.remove(id),
    (rows, id) => rows.filter((r) => r.id !== id),
    {
      errorText: t("automations.deleteFailed"),
    },
  );

  const open = (id: string) =>
    void navigate({
      to: "/settings/automations/$automationId",
      params: { automationId: id },
    });

  if (!admin)
    return (
      <SettingsPage title={t("automations.title")}>
        <NoAccess what="automations" />
      </SettingsPage>
    );

  const active = sorted.filter((a) => a.enabled).length;
  const runs = sorted.reduce((n, a) => n + a.run_count, 0);
  const newLink = (size?: "sm") => (
    <Button variant={size ? "secondary" : "primary"} size={size} asChild>
      <Link to="/settings/automations/$automationId" params={{ automationId: "new" }}>
        <Plus className="size-3.5" />
        {t("automations.new")}
      </Link>
    </Button>
  );

  return (
    <SettingsPage title={t("automations.title")} description={t("automations.description")} actions={newLink()}>
      {sorted.length > 0 && (
        <SummaryStrip
          items={[
            { label: t("automations.summary.total"), value: sorted.length },
            {
              label: t("automations.summary.active"),
              value: active,
              tone: "green",
            },
            {
              label: t("automations.summary.paused"),
              value: sorted.length - active,
              tone: "gray",
            },
            { label: t("automations.summary.runs"), value: compact(runs) },
          ]}
        />
      )}
      <Section flush>
        {isLoading ? (
          <ListSkeleton rows={4} />
        ) : !sorted.length ? (
          <EmptyState compact lit={1} title={t("automations.emptyTitle")} description={t("automations.emptyHint")} action={newLink("sm")} />
        ) : (
          <MotionList>
            {sorted.map((a, i) => (
              <MotionRow key={a.id}>
                <ListRow onClick={() => open(a.id)}>
                  <IconTile tone={a.enabled ? triggerTone[a.trigger] : "gray"}>
                    <TriggerIcon trigger={a.trigger} className={a.enabled ? undefined : "text-fg-4"} />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`truncate text-[13px] font-medium ${a.enabled ? "" : "text-fg-2"}`}>{a.name}</span>
                      {!a.enabled && <StatePill state="paused">{t("automations.paused")}</StatePill>}
                    </div>
                    <div className="truncate text-[12px] text-fg-3">
                      {triggerShort[a.trigger]} <span className="text-fg-4">·</span>{" "}
                      {t("automations.conditions", {
                        count: a.conditions.length,
                      })}{" "}
                      <span className="text-fg-4">·</span> {t("automations.actions", { count: a.actions.length })}
                    </div>
                  </div>
                  <Tooltip
                    content={t("automations.ranTimes", {
                      n: a.run_count.toLocaleString(),
                    })}
                  >
                    <span className="mono hidden min-w-14 shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-fg-4 sm:block">
                      {t("automations.runs", { n: compact(a.run_count) })}
                    </span>
                  </Tooltip>
                  <Switch
                    checked={a.enabled}
                    onCheckedChange={(enabled) => toggle.mutate({ id: a.id, enabled })}
                    aria-label={t("common.enable", { name: a.name })}
                  />
                  <ReorderButtons
                    label={a.name}
                    first={i === 0}
                    last={i === sorted.length - 1}
                    disabled={reorder.isPending}
                    onUp={() => reorder.mutate({ id: a.id, dir: -1 })}
                    onDown={() => reorder.mutate({ id: a.id, dir: 1 })}
                  />
                  <Menu>
                    <MenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("common.actionsFor", { name: a.name })}
                        onClick={(e) => e.stopPropagation()}
                        className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem icon={<Pencil />} onSelect={() => open(a.id)}>
                        {t("common.edit")}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        danger
                        icon={<Trash2 />}
                        onSelect={() =>
                          confirm.show(
                            <>
                              <span className="font-medium text-fg">{a.name}</span> {t("automations.deleteBody")}
                            </>,
                            () => remove.mutateAsync(a.id),
                            {
                              title: t("automations.deleteTitle"),
                              confirmLabel: t("common.delete"),
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
    </SettingsPage>
  );
}
