import { atLeast, useRole } from "@/lib/session";
import { useQuery } from "@tanstack/react-query";
import { q } from "@/lib/queries";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";

type NavPath =
  | "/settings/profile"
  | "/settings/security"
  | "/settings/workspace"
  | "/settings/members"
  | "/settings/teams"
  | "/settings/mailboxes"
  | "/settings/tags"
  | "/settings/saved-replies"
  | "/settings/views"
  | "/settings/sla"
  | "/settings/automations"
  | "/settings/widget"
  | "/settings/api-keys"
  | "/settings/webhooks"
  | "/settings/audit-log"
  | "/settings/billing"
  | "/settings/ai";

const groups: { title: string; items: { to: NavPath; label: string }[] }[] = [
  {
    title: "Account",
    items: [
      { to: "/settings/profile", label: "Profile" },
      { to: "/settings/security", label: "Security" },
    ],
  },
  {
    title: "Workspace",
    items: [
      { to: "/settings/workspace", label: "General" },
      { to: "/settings/members", label: "Members" },
      { to: "/settings/teams", label: "Teams" },
      { to: "/settings/mailboxes", label: "Mailboxes" },
      { to: "/settings/billing", label: "Plan and billing" },
      { to: "/settings/ai", label: "AI" },
    ],
  },
  {
    title: "Inbox",
    items: [
      { to: "/settings/tags", label: "Tags" },
      { to: "/settings/saved-replies", label: "Saved replies" },
      { to: "/settings/views", label: "Views" },
      { to: "/settings/sla", label: "SLA policies" },
      { to: "/settings/automations", label: "Automations" },
    ],
  },
  { title: "Channels", items: [{ to: "/settings/widget", label: "Chat widget" }] },
  {
    title: "Developers",
    items: [
      { to: "/settings/api-keys", label: "API keys" },
      { to: "/settings/webhooks", label: "Webhooks" },
    ],
  },
  { title: "Admin", items: [{ to: "/settings/audit-log", label: "Audit log" }] },
];

/**
 * The AI page is listed when the instance has an AI provider. Admins always see
 * it, because without a provider it explains how to connect one.
 */
function useVisibleGroups() {
  const { data: ai, isFetched } = useQuery(q.aiConfig());
  const admin = atLeast(useRole(), "admin");
  const hideAi = isFetched && !ai?.enabled && !admin;
  return hideAi ? groups.map((g) => ({ ...g, items: g.items.filter((i) => i.to !== "/settings/ai") })) : groups;
}

export default function SettingsLayout() {
  const groups = useVisibleGroups();
  const all = groups.flatMap((g) => g.items);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const current = all.find((i) => path === i.to || path.startsWith(`${i.to}/`))?.to;

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav
        aria-label="Settings"
        className="hidden w-[220px] shrink-0 overflow-y-auto border-r border-line px-2 pb-6 pt-4 md:block"
      >
        <div className="px-2 pb-2 text-[13.5px] font-semibold tracking-[-0.01em]">Settings</div>
        {groups.map((g) => (
          <div key={g.title} className="mt-3">
            <div className="px-2 pb-1 text-[11.5px] font-medium text-fg-3">{g.title}</div>
            <div className="flex flex-col gap-px">
              {g.items.map((i) => (
                <Link
                  key={i.to}
                  to={i.to}
                  className={cn(
                    "flex h-7 items-center rounded-md px-2 text-[13px] text-fg-2 outline-none transition-colors duration-75 hover:bg-hover hover:text-fg focus-visible:shadow-[0_0_0_2px_var(--focus)]",
                  )}
                  activeProps={{ className: "bg-active !text-fg font-medium" }}
                >
                  {i.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-b border-line px-4 py-2 md:hidden">
        <Select
          aria-label="Settings page"
          value={current}
          onChange={(v) => void navigate({ to: v })}
          options={all.map((i) => ({ value: i.to, label: i.label }))}
        />
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
