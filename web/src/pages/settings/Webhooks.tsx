import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, Pencil, Plus, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { useState } from "react";
import { ListRow, NoAccess, Section, SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/confirm";
import { ListSkeleton } from "@/components/settings2/bits";
import { useListMutation } from "@/components/settings2/optimistic";
import { SecretDialog, WebhookDialog, eventSummary } from "@/components/settings2/webhooks";
import { api } from "@/lib/api/endpoints";
import type { Webhook } from "@/lib/api/types";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";

export default function Webhooks() {
  const role = useRole();
  const admin = atLeast(role, "admin");
  const { data: hooks, isLoading } = useQuery({ ...q.webhooks(), enabled: admin });
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Webhook | "new" | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const toggle = useListMutation<Webhook, { id: string; enabled: boolean }>(
    qk.webhooks,
    (v) => api.webhooks.update(v.id, { enabled: v.enabled }),
    (rows, v) => rows.map((r) => (r.id === v.id ? { ...r, enabled: v.enabled } : r)),
    { errorText: "Couldn't update the webhook" },
  );
  const remove = useListMutation<Webhook, string>(qk.webhooks, (id) => api.webhooks.remove(id), (rows, id) => rows.filter((r) => r.id !== id), {
    errorText: "Couldn't delete the webhook",
  });

  if (!admin)
    return (
      <SettingsPage title="Webhooks">
        <NoAccess what="webhooks" />
      </SettingsPage>
    );

  const open = (id: string) => void navigate({ to: "/settings/webhooks/$webhookId", params: { webhookId: id } });

  return (
    <SettingsPage
      title="Webhooks"
      description="Get a signed HTTPS request whenever something changes. Failed deliveries are retried with backoff."
      actions={
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
          New webhook
        </Button>
      }
    >
      <Section flush>
        {isLoading ? (
          <ListSkeleton rows={2} />
        ) : !hooks?.length ? (
          <EmptyState
            compact
            lit={3}
            icon={<WebhookIcon className="size-8 text-fg-4" strokeWidth={1.25} />}
            title="No webhooks"
            description="Send ticket and contact events to your own systems as they happen."
            action={
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
                New webhook
              </Button>
            }
          />
        ) : (
          hooks.map((h) => (
            <ListRow key={h.id} onClick={() => open(h.id)}>
              <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md border border-line text-fg-3">
                <WebhookIcon className="size-3.5" />
                <span className={`absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-surface ${h.enabled ? "bg-ok" : "bg-fg-4"}`} />
              </span>
              <div className={`min-w-0 flex-1 ${h.enabled ? "" : "opacity-55"}`}>
                <div className="mono truncate text-[12.5px] text-fg">{h.url}</div>
                <div className="truncate text-[12px] text-fg-3">
                  {h.description ? `${h.description} · ` : ""}
                  {eventSummary(h.events)}
                </div>
              </div>
              <Switch checked={h.enabled} onCheckedChange={(enabled) => toggle.mutate({ id: h.id, enabled })} aria-label={`Webhook ${h.url} active`} />
              <Menu>
                <MenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Webhook actions"
                    onClick={(e) => e.stopPropagation()}
                    className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem icon={<Pencil />} onSelect={() => setEditing(h)}>
                    Edit
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    icon={<Trash2 />}
                    onSelect={() =>
                      confirm.show(<>Deliveries to <span className="mono text-fg">{h.url}</span> stop right away.</>, () => remove.mutateAsync(h.id), {
                        title: "Delete this webhook?",
                        confirmLabel: "Delete webhook",
                        danger: true,
                      })
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
      {editing && (
        <WebhookDialog
          hook={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(w) => {
            setEditing(null);
            setSecret(w.secret);
          }}
        />
      )}
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </SettingsPage>
  );
}
