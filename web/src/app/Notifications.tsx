import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AtSign, Bell, CornerDownLeft, Hand, TimerOff, UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/endpoints";
import type { Notification } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { relShort } from "@/lib/format";
import { q, qk } from "@/lib/queries";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

const icon = {
  assigned: <UserPlus />,
  mentioned: <AtSign />,
  customer_replied: <CornerDownLeft />,
  sla_breached: <TimerOff />,
  ai_handoff: <Hand />,
};

function describe(n: Notification): string {
  const actor = n.data.actor as { name?: string } | undefined;
  const who = typeof actor?.name === "string" ? actor.name : null;
  const c = n.data.contact as { name?: string } | undefined;
  const contact = typeof c?.name === "string" && c.name ? c.name : null;
  switch (n.type) {
    case "assigned":
      return who ? `${who} assigned you a ticket` : "A ticket was assigned to you";
    case "mentioned":
      return who ? `${who} mentioned you` : "You were mentioned in a note";
    case "customer_replied":
      return contact ? `${contact} replied` : "The customer replied";
    case "sla_breached":
      return "SLA breached";
    case "ai_handoff":
      return contact ? `${contact} asked for a person` : "A customer asked for a person";
    default:
      return "Notification";
  }
}

export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery(q.notifications());
  const unread = data?.filter((n) => !n.read_at).length ?? 0;
  const { t } = useTranslation("shell");

  const markRead = useMutation({
    mutationFn: (b: { ids?: string[]; all?: boolean }) => api.notifications.read(b),
    onMutate: async (b) => {
      await qc.cancelQueries({ queryKey: qk.notifications });
      const prev = qc.getQueryData<Notification[]>(qk.notifications);
      const now = new Date().toISOString();
      qc.setQueryData<Notification[]>(qk.notifications, (old) =>
        old?.map((n) => (b.all || b.ids?.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)),
      );
      return { prev };
    },
    onError: (_e, _b, ctx) => ctx?.prev && qc.setQueryData(qk.notifications, ctx.prev),
  });

  const openTicket = (n: Notification) => {
    if (!n.read_at) markRead.mutate({ ids: [n.id] });
    setOpen(false);
    if (n.ticket)
      void navigate({
        to: "/inbox/$folder/{-$ticketId}",
        params: { folder: n.type === "assigned" || n.type === "mentioned" ? "mine" : "open", ticketId: n.ticket.id },
      });
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="w-[380px] overflow-hidden p-0"
      trigger={
        <Tooltip content={t("notifications.title")}>
          <button
            type="button"
            aria-label={unread ? t("notifications.unread", { count: unread }) : t("notifications.title")}
            className="relative flex size-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-chrome-hover hover:text-fg data-[state=open]:bg-chrome-active data-[state=open]:text-fg"
          >
            <Bell className="size-[15px]" />
            {unread > 0 && <span className="absolute right-[5px] top-[5px] size-[7px] rounded-full bg-fg ring-2 ring-chrome" />}
          </button>
        </Tooltip>
      }
    >
      <div className="flex h-11 items-center justify-between border-b border-line px-3.5">
        <span className="text-[13px] font-semibold tracking-[-0.01em]">{t("notifications.title")}</span>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => markRead.mutate({ all: true })}
            className="rounded px-1.5 py-0.5 text-xs text-fg-3 hover:bg-hover hover:text-fg"
          >
            {t("notifications.markAll")}
          </button>
        )}
      </div>
      <div className="max-h-[420px] overflow-y-auto p-1">
        {isLoading ? (
          <div className="flex flex-col gap-3 p-3">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : !data?.length ? (
          <EmptyState compact lit={0} title={t("notifications.empty")} description={t("notifications.emptyHint")} />
        ) : (
          data.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => openTicket(n)}
              className="group flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-hover"
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg-3 [&_svg]:size-3.5",
                  !n.read_at && "text-fg",
                )}
              >
                {icon[n.type]}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[12.5px]", n.read_at ? "text-fg-2" : "font-medium text-fg")}>{describe(n)}</span>
                {n.ticket && (
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-3">
                    <span className="mono shrink-0">#{n.ticket.number}</span>
                    <span className="truncate" data-ph-mask>
                      {n.ticket.subject}
                    </span>
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="mono text-[10.5px] text-fg-4">{relShort(n.created_at)}</span>
                {!n.read_at && <span className="size-1.5 rounded-full bg-fg" aria-label="Unread" />}
              </span>
            </button>
          ))
        )}
      </div>
    </Popover>
  );
}
