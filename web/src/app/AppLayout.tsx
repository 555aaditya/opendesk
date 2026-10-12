import { useQueryClient } from "@tanstack/react-query";
import { useWaitingAlerts } from "@/components/tickets/useWaitingAlerts";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import { Dialog as D } from "radix-ui";
import { identify } from "@/lib/analytics";
import { useHotkeys } from "@/lib/hotkeys";
import { useHeartbeat } from "@/lib/pictures";
import { startRealtime, stopRealtime } from "@/lib/realtime/manager";
import { reloadSession, useSession } from "@/lib/session";
import { useUpgrade } from "@/lib/upgrade";
import { toast } from "@/components/ui/toast";
import { AssistantDock, AssistantRoot } from "@/components/assistant/AssistantRoot";
import type { Notification } from "@/lib/api/types";
import { Sidebar } from "./Sidebar";
import { AppHeader } from "./AppHeader";
import { cn } from "@/lib/cn";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { ConnectionBanner } from "./ConnectionBanner";
import { shell, toggleNav, useNav, useShell } from "./shellStore";

const NewTicketDialog = lazy(() => import("@/components/tickets/NewTicketDialog"));
const UpgradeDialog = lazy(() => import("@/components/billing/UpgradeDialog"));

function notificationText(n: Notification) {
  const subject = n.ticket ? `#${n.ticket.number}` : "";
  switch (n.type) {
    case "assigned":
      return `Assigned to you ${subject}`;
    case "mentioned":
      return `You were mentioned ${subject}`;
    case "customer_replied":
      return `New reply ${subject}`;
    case "sla_breached":
      return `SLA breached ${subject}`;
    case "ai_handoff":
      return `A customer asked for a person ${subject}`;
    case "ai_cap_reached":
      return "Ollie reached this month's agent credit cap";
    default:
      return `Notification ${subject}`;
  }
}

function useRealtimeConnection() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const wid = useSession((s) => s.workspaceId);
  const uid = useSession((s) => s.user?.id);
  useEffect(() => {
    if (!wid || !uid) return;
    identify(uid, wid);
    startRealtime({
      qc,
      workspaceId: wid,
      userId: uid,
      onNotification: (n) => {
        if (n.type === "customer_replied") return;
        toast.info(notificationText(n), {
          description: n.type === "ai_cap_reached" ? "Chats go to your team until the cap resets or you raise it." : n.ticket?.subject,
          action: n.ticket
            ? {
                label: "Open",
                onClick: () =>
                  void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "mine", ticketId: n.ticket!.id } }),
              }
            : n.type === "ai_cap_reached"
              ? { label: "Settings", onClick: () => void navigate({ to: "/settings/ai/behaviour" }) }
              : undefined,
        });
      },
      onSelfMembershipChanged: () => {
        void reloadSession().then((s) => {
          if (!s.workspaceId) void navigate({ to: "/onboarding" });
        });
      },
    });
    return () => stopRealtime();
  }, [wid, uid, qc, navigate]);
}

export function AppLayout() {
  // The top-level area (inbox, views, contacts, settings/...) keys the route transition.
  const section = useRouterState({ select: (s) => { const p = s.location.pathname.split("/").filter(Boolean); return p[0] ?? ""; } });
  useRealtimeConnection();
  useHeartbeat();
  const navigate = useNavigate();
  const newTicketOpen = useShell((s) => s.newTicketOpen);
  const sidebarOpen = useShell((s) => s.sidebarOpen);
  const upgradeReason = useUpgrade((s) => s.reason);
  const collapsed = useNav((s) => s.collapsed);
  // Logging out, or deleting or leaving the last workspace, clears the session
  // before the router leaves the app; render nothing in between rather than
  // pages that read the signed-in user and the current workspace.
  const authed = useSession((s) => s.status === "authed" && !!s.user && !!s.workspaceId);
  useWaitingAlerts(authed);

  useHotkeys({
    "mod+k": () => shell.palette(!useShell.getState().paletteOpen),
    "?": () => shell.shortcuts(),
    "shift+?": () => shell.shortcuts(),
    c: () => shell.newTicket(),
    b: () => toggleNav(),
    "g i": () => void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: undefined } }),
    "g m": () => void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "mine", ticketId: undefined } }),
    "g c": () => void navigate({ to: "/contacts/{-$contactId}", params: { contactId: undefined } }),
    "g k": () => void navigate({ to: "/kb" }),
    "g r": () => void navigate({ to: "/reports" }),
    "g s": () => void navigate({ to: "/settings" }),
  });

  if (!authed) return null;

  return (
    <div className="fixed inset-0 flex flex-col bg-chrome text-fg">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        <aside className={cn("hidden shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex", collapsed ? "w-14" : "w-60")}>
          <Sidebar />
        </aside>

        {/* Phone: the sidebar is a sheet. */}
        <D.Root open={sidebarOpen} onOpenChange={(o) => shell.sidebar(o)}>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=open]:animate-fade-in md:hidden" />
            <D.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col bg-chrome pt-2 shadow-float outline-none data-[state=open]:animate-fade-in md:hidden"
              onClick={(e) => (e.target as HTMLElement).closest("a") && shell.sidebar(false)}
            >
              <D.Title className="sr-only">Navigation</D.Title>
              <Sidebar drawer />
            </D.Content>
          </D.Portal>
        </D.Root>

        {/* The work panel: pure white, its inner corner softened where it meets the chrome. */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden border-t border-line bg-surface md:rounded-tl-2xl md:border-l">
          <ConnectionBanner />
          {/* Moving between areas cross-fades the panel; moving within one (ticket to ticket) does not. */}
          <div key={section} className="flex min-h-0 flex-1 flex-col animate-route-in motion-reduce:animate-none">
            <Outlet />
          </div>
        </main>
        <AssistantDock />
      </div>

      <CommandPalette />
      <ShortcutsSheet />
      <AssistantRoot />
      {upgradeReason && (
        <Suspense fallback={null}>
          <UpgradeDialog />
        </Suspense>
      )}
      {newTicketOpen && (
        <Suspense fallback={null}>
          <NewTicketDialog />
        </Suspense>
      )}
    </div>
  );
}
