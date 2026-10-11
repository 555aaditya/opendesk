import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { useMemo } from "react";
import { SettingsPage, Section, ListRow, NoAccess } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { ListSkeleton, ReorderButtons } from "@/components/settings2/bits";
import { moveItem, useListMutation } from "@/components/settings2/optimistic";
import { triggerShort } from "@/components/settings2/automation";
import { api } from "@/lib/api/endpoints";
import type { Automation } from "@/lib/api/types";
import { compact, plural } from "@/lib/format";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";

export default function Automations() {
  const role = useRole();
  const admin = atLeast(role, "admin");
  const { data, isLoading } = useQuery({ ...q.automations(), enabled: admin });
  const navigate = useNavigate();
  const confirm = useConfirm();
  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => a.position - b.position), [data]);

  const toggle = useListMutation<Automation, { id: string; enabled: boolean }>(
    qk.automations,
    (v) => api.automations.update(v.id, { enabled: v.enabled }),
    (rows, v) => rows.map((r) => (r.id === v.id ? { ...r, enabled: v.enabled } : r)),
    { errorText: "Couldn't update the automation" },
  );
  const reorder = useListMutation<Automation, { id: string; dir: -1 | 1 }>(
    qk.automations,
    async (v) => {
      const next = moveItem(sorted, v.id, v.dir);
      const changed = next.filter((n) => sorted.find((o) => o.id === n.id)?.position !== n.position);
      await Promise.all(changed.map((n) => api.automations.update(n.id, { position: n.position })));
    },
    (rows, v) => moveItem(rows, v.id, v.dir),
    { errorText: "Couldn't reorder automations" },
  );
  const remove = useListMutation<Automation, string>(qk.automations, (id) => api.automations.remove(id), (rows, id) => rows.filter((r) => r.id !== id), {
    errorText: "Couldn't delete the automation",
  });

  const open = (id: string) => void navigate({ to: "/settings/automations/$automationId", params: { automationId: id } });

  if (!admin)
    return (
      <SettingsPage title="Automations">
        <NoAccess what="automations" />
      </SettingsPage>
    );

  return (
    <SettingsPage
      title="Automations"
      description="Rules that run on their own when something happens to a ticket. They run in order, top to bottom."
      actions={
        <Button variant="primary" asChild>
          <Link to="/settings/automations/$automationId" params={{ automationId: "new" }}>
            <Plus className="size-3.5" />
            New automation
          </Link>
        </Button>
      }
    >
      <Section flush>
        {isLoading ? (
          <ListSkeleton rows={4} />
        ) : !sorted.length ? (
          <EmptyState
            compact
            lit={1}
            title="No automations yet"
            description="Route billing mail to the billing team, tag urgent words, or close spam without lifting a finger."
            action={
              <Button size="sm" asChild>
                <Link to="/settings/automations/$automationId" params={{ automationId: "new" }}>
                  <Plus className="size-3.5" />
                  New automation
                </Link>
              </Button>
            }
          />
        ) : (
          sorted.map((a, i) => (
            <ListRow key={a.id} onClick={() => open(a.id)}>
              <span className={`flex size-7 shrink-0 items-center justify-center rounded-md border border-line ${a.enabled ? "text-fg-2" : "text-fg-4"}`}>
                <Workflow className="size-3.5" />
              </span>
              <div className={`min-w-0 flex-1 ${a.enabled ? "" : "opacity-55"}`}>
                <div className="truncate text-[13px] font-medium">{a.name}</div>
                <div className="truncate text-[12px] text-fg-3">
                  {triggerShort[a.trigger]} · {plural(a.conditions.length, "condition")} · {plural(a.actions.length, "action")}
                </div>
              </div>
              <Tooltip content={`Ran ${a.run_count.toLocaleString()} times`}>
                <span className="mono hidden min-w-14 shrink-0 whitespace-nowrap text-right text-[11.5px] tabular-nums text-fg-3 sm:block">{compact(a.run_count)} runs</span>
              </Tooltip>
              <Switch checked={a.enabled} onCheckedChange={(enabled) => toggle.mutate({ id: a.id, enabled })} aria-label={`Enable ${a.name}`} />
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
                    aria-label={`Actions for ${a.name}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem icon={<Pencil />} onSelect={() => open(a.id)}>
                    Edit
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    icon={<Trash2 />}
                    onSelect={() =>
                      confirm.show(
                        <>
                          <span className="font-medium text-fg">{a.name}</span> stops running. Tickets it already changed stay as they are.
                        </>,
                        () => remove.mutateAsync(a.id),
                        { title: "Delete this automation?", confirmLabel: "Delete", danger: true },
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
    </SettingsPage>
  );
}
