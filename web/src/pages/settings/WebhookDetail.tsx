import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Pencil, RefreshCw, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { BackLink, NoAccess, Section, SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { ListSkeleton, MonoChip } from "@/components/settings2/bits";
import { useListMutation } from "@/components/settings2/optimistic";
import { WebhookDialog, isAllEvents } from "@/components/settings2/webhooks";
import { api } from "@/lib/api/endpoints";
import type { Webhook, WebhookDelivery } from "@/lib/api/types";
import { fullDate, relShort } from "@/lib/format";
import { q, qk, removeFromList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { cn } from "@/lib/cn";

const statusCopy: Record<WebhookDelivery["status"], { label: string; dot: string }> = {
  succeeded: { label: "Delivered", dot: "bg-ok" },
  failed: { label: "Failed", dot: "bg-danger" },
  pending: { label: "Pending", dot: "bg-warn animate-pulse-soft" },
};

export default function WebhookDetail() {
  const { webhookId } = useParams({ from: "/app/settings/webhooks/$webhookId" });
  const role = useRole();
  const admin = atLeast(role, "admin");
  const { data: hooks, isLoading } = useQuery({ ...q.webhooks(), enabled: admin });
  const deliveries = useQuery({ ...q.webhookDeliveries(webhookId), enabled: admin });
  const hook = hooks?.find((h) => h.id === webhookId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<"all" | "failed">("all");

  const toggle = useListMutation<Webhook, boolean>(
    qk.webhooks,
    (enabled) => api.webhooks.update(webhookId, { enabled }),
    (rows, enabled) => rows.map((r) => (r.id === webhookId ? { ...r, enabled } : r)),
    { errorText: "Couldn't update the webhook" },
  );
  const test = useMutation({
    mutationFn: () => api.webhooks.test(webhookId),
    onSuccess: (d) => {
      if (d?.id) qc.setQueryData<WebhookDelivery[]>(qk.webhookDeliveries(webhookId), (old) => [d, ...(old ?? []).filter((x) => x.id !== d.id)]);
      else void qc.invalidateQueries({ queryKey: qk.webhookDeliveries(webhookId) });
      toast.success("Test event sent", { description: "webhook.test is on its way." });
    },
    onError: (e) => toast.error(e, "Couldn't send the test event"),
  });

  const back = <BackLink to="/settings/webhooks">Webhooks</BackLink>;
  if (!admin)
    return (
      <SettingsPage title="Webhook">
        <NoAccess what="webhooks" />
      </SettingsPage>
    );
  if (isLoading)
    return (
      <SettingsPage title="Webhook" back={back}>
        <div className="skeleton h-24 rounded-lg" />
      </SettingsPage>
    );
  if (!hook)
    return (
      <SettingsPage title="Webhook" back={back}>
        <EmptyState lit={3} title="Webhook not found" description="It may have been deleted." />
      </SettingsPage>
    );

  const rows = (deliveries.data ?? []).filter((d) => filter === "all" || d.status === "failed");
  const failed = (deliveries.data ?? []).filter((d) => d.status === "failed").length;
  const everything = isAllEvents(hook.events);

  return (
    <SettingsPage
      wide
      back={back}
      title={<span className="mono text-[17px] tracking-[-0.01em]">{hook.url}</span>}
      description={hook.description || undefined}
      actions={
        <>
          <label className="mr-1 flex items-center gap-2 text-[12.5px] text-fg-2">
            {hook.enabled ? "Active" : "Paused"}
            <Switch checked={hook.enabled} onCheckedChange={(v) => toggle.mutate(v)} aria-label="Webhook active" />
          </label>
          <Button icon={<Send className="size-3.5" />} loading={test.isPending} onClick={() => test.mutate()} disabled={!hook.enabled}>
            Send test event
          </Button>
          <Button square aria-label="Edit webhook" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)} />
          <Button
            square
            variant="danger"
            aria-label="Delete webhook"
            icon={<Trash2 className="size-3.5" />}
            onClick={() =>
              confirm.show(<>Deliveries to <span className="mono text-fg">{hook.url}</span> stop right away.</>, async () => {
                await api.webhooks.remove(hook.id);
                removeFromList(qc, qk.webhooks, hook.id);
                toast.success("Webhook deleted");
                void navigate({ to: "/settings/webhooks" });
              }, { title: "Delete this webhook?", confirmLabel: "Delete webhook", danger: true })
            }
          />
        </>
      }
    >
      <Section title="Events" description={everything ? "Every event in the catalog." : `${hook.events.length} subscribed`}>
        <div className="flex flex-wrap gap-1 py-3">
          {everything ? <MonoChip>all events</MonoChip> : hook.events.map((e) => <MonoChip key={e}>{e}</MonoChip>)}
        </div>
      </Section>

      <Section
        flush
        title="Recent deliveries"
        description="The last 50 attempts. Failures are retried automatically."
        actions={
          <div className="flex items-center gap-1">
            <div role="radiogroup" className="inline-flex rounded-md bg-hover p-0.5">
              {(["all", "failed"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "h-6 rounded-sm px-2 text-xs font-medium text-fg-3 hover:text-fg",
                    filter === f && "bg-surface text-fg shadow-[0_0_0_1px_var(--line)]",
                  )}
                >
                  {f === "all" ? "All" : `Failed ${failed ? failed : ""}`.trim()}
                </button>
              ))}
            </div>
            <Tooltip content="Refresh">
              <button
                type="button"
                aria-label="Refresh deliveries"
                onClick={() => void deliveries.refetch()}
                className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
              >
                <RefreshCw className={cn("size-3.5", deliveries.isFetching && "animate-spin")} />
              </button>
            </Tooltip>
          </div>
        }
      >
        {deliveries.isLoading ? (
          <ListSkeleton rows={5} />
        ) : !rows.length ? (
          <EmptyState
            compact
            lit={0}
            title={filter === "failed" ? "No failed deliveries" : "No deliveries yet"}
            description={filter === "failed" ? "Everything recent went through." : "Send a test event to check your endpoint."}
          />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] text-fg-3">
                <th className="h-8 px-4 font-medium">Status</th>
                <th className="h-8 px-2 font-medium">Event</th>
                <th className="h-8 px-2 text-right font-medium">Response</th>
                <th className="hidden h-8 px-2 text-right font-medium sm:table-cell">Duration</th>
                <th className="hidden h-8 px-2 text-right font-medium sm:table-cell">Attempts</th>
                <th className="h-8 px-4 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-line-soft last:border-0 hover:bg-hover/50">
                  <td className="h-10 px-4">
                    <span className="inline-flex items-center gap-2">
                      <span className={cn("size-1.5 rounded-full", statusCopy[d.status].dot)} />
                      {statusCopy[d.status].label}
                    </span>
                  </td>
                  <td className="mono px-2 text-[12px] text-fg-2">{d.event_type}</td>
                  <td className={cn("mono px-2 text-right text-[12px] tabular-nums", d.response_code && d.response_code >= 400 ? "text-danger-fg" : "text-fg-2")}>
                    {d.response_code ?? "–"}
                  </td>
                  <td className="mono hidden px-2 text-right text-[12px] tabular-nums text-fg-3 sm:table-cell">{d.duration_ms != null ? `${d.duration_ms} ms` : "–"}</td>
                  <td className="mono hidden px-2 text-right text-[12px] tabular-nums text-fg-3 sm:table-cell">{d.attempts}</td>
                  <td className="px-4 text-right">
                    <Tooltip content={fullDate(d.created_at)}>
                      <span className="mono text-[11.5px] text-fg-3">{relShort(d.created_at)}</span>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {editing && <WebhookDialog hook={hook} onClose={() => setEditing(false)} />}
    </SettingsPage>
  );
}
