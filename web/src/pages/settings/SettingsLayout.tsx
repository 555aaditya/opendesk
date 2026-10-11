import { atLeast, useRole } from "@/lib/session";
import { useQuery } from "@tanstack/react-query";
import { q } from "@/lib/queries";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { motion } from "motion/react";
import {
  Bot,
  Building2,
  CreditCard,
  Gauge,
  Inbox,
  KeyRound,
  Layers,
  ListChecks,
  MessageCircle,
  MessageSquareText,
  Shield,
  Tag,
  User,
  Users,
  UsersRound,
  Webhook,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";

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

const groups: { title: string; items: { to: NavPath; label: string; icon: ReactNode }[] }[] = [
  {
    title: "Account",
    items: [
      { to: "/settings/profile", label: "Profile", icon: <User /> },
      { to: "/settings/security", label: "Security", icon: <Shield /> },
    ],
  },
  {
    title: "Workspace",
    items: [
      { to: "/settings/workspace", label: "General", icon: <Building2 /> },
      { to: "/settings/members", label: "Members", icon: <Users /> },
      { to: "/settings/teams", label: "Teams", icon: <UsersRound /> },
      { to: "/settings/mailboxes", label: "Mailboxes", icon: <Inbox /> },
      { to: "/settings/billing", label: "Plan and billing", icon: <CreditCard /> },
      { to: "/settings/ai", label: "AI", icon: <Bot /> },
    ],
  },
  {
    title: "Inbox",
    items: [
      { to: "/settings/tags", label: "Tags", icon: <Tag /> },
      { to: "/settings/saved-replies", label: "Saved replies", icon: <MessageSquareText /> },
      { to: "/settings/views", label: "Views", icon: <Layers /> },
      { to: "/settings/sla", label: "SLA policies", icon: <Gauge /> },
      { to: "/settings/automations", label: "Automations", icon: <Workflow /> },
    ],
  },
  { title: "Channels", items: [{ to: "/settings/widget", label: "Chat widget", icon: <MessageCircle /> }] },
  {
    title: "Developers",
    items: [
      { to: "/settings/api-keys", label: "API keys", icon: <KeyRound /> },
      { to: "/settings/webhooks", label: "Webhooks", icon: <Webhook /> },
    ],
  },
  { title: "Admin", items: [{ to: "/settings/audit-log", label: "Audit log", icon: <ListChecks /> }] },
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
      <nav aria-label="Settings" className="hidden w-[232px] shrink-0 overflow-y-auto border-r border-line px-3 pb-6 pt-5 md:block">
        {groups.map((g, gi) => (
          <div key={g.title} className={gi ? "mt-4" : undefined}>
            <div className="label-caps px-2.5 pb-1.5">{g.title}</div>
            <div className="flex flex-col gap-px">
              {g.items.map((i) => {
                const active = current === i.to;
                return (
                  <Link
                    key={i.to}
                    to={i.to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:shadow-[0_0_0_1.5px_var(--focus)] [&_svg]:relative [&_svg]:z-10 [&_svg]:size-[14px] [&_svg]:shrink-0",
                      active ? "font-medium text-fg [&_svg]:text-fg-2" : "text-fg-2 hover:bg-hover hover:text-fg [&_svg]:text-fg-4 hover:[&_svg]:text-fg-3",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="settings-active-dot"
                        aria-hidden
                        className="absolute -left-[5px] top-1/2 -mt-[2.5px] size-[5px] rounded-full bg-fg"
                        transition={{ type: "spring", stiffness: 700, damping: 45 }}
                      />
                    )}
                    {i.icon}
                    <span className="relative z-10 truncate">{i.label}</span>
                  </Link>
                );
              })}
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
        <div key={current ?? path} className="animate-rise-in">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
