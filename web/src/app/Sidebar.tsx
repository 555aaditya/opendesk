import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronsUpDown,
  CircleCheck,
  CircleDashed,
  Clock,
  Inbox,
  Keyboard,
  Layers,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  SquarePen,
  Sun,
  User,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuTrigger, MenuCheckItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { folders, type FolderId } from "@/lib/folders";
import { q } from "@/lib/queries";
import { atLeast, selectWorkspace, signOut, useRole, useSession, useWorkspace } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { resetAnalytics } from "@/lib/analytics";
import { shell } from "./shellStore";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { NotificationsButton } from "./Notifications";

const folderIcons: Record<FolderId, ReactNode> = {
  unassigned: <CircleDashed />,
  mine: <User />,
  open: <Inbox />,
  pending: <Clock />,
  solved: <CircleCheck />,
  spam: <ShieldAlert />,
};

const navItem =
  "group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-fg-2 outline-none transition-colors duration-75 hover:bg-hover hover:text-fg focus-visible:shadow-[0_0_0_2px_var(--focus)] [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:text-fg-3 [&_svg]:transition-colors";
const navActive = "bg-active !text-fg font-medium [&_svg]:!text-fg";

function Count({ n }: { n: number | null | undefined }) {
  if (n === null || n === undefined) return null;
  return <span className="mono ml-auto text-[11px] tabular-nums text-fg-3 group-data-[status=active]:text-fg-2">{n > 999 ? "999+" : n}</span>;
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="group/section flex h-7 items-center justify-between px-2 pt-2">
      <span className="text-[11.5px] font-medium text-fg-3">{children}</span>
      {action}
    </div>
  );
}

export function Sidebar() {
  const { data: counts } = useQuery(q.counts());
  const { data: views } = useQuery(q.views());
  const role = useRole();

  return (
    <nav aria-label="Main" className="flex h-full w-full flex-col">
      <div className="flex items-center gap-1 px-2 pb-2 pt-2.5">
        <WorkspaceSwitcher />
        <Tooltip content="Search" shortcut="mod k">
          <button
            type="button"
            aria-label="Search and commands"
            onClick={() => shell.palette()}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
          >
            <Search className="size-[15px]" />
          </button>
        </Tooltip>
        {atLeast(role, "agent") && (
          <Tooltip content="New ticket" shortcut="c">
            <button
              type="button"
              aria-label="New ticket"
              onClick={() => shell.newTicket()}
              className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg-2 shadow-[0_1px_1px_rgb(0_0_0/0.04)] hover:border-line-strong hover:text-fg"
            >
              <SquarePen className="size-[14px]" />
            </button>
          </Tooltip>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <SectionLabel>Inbox</SectionLabel>
        <div className="flex flex-col gap-px">
          {folders.map((f) => (
            <Link
              key={f.id}
              to="/inbox/$folder/{-$ticketId}"
              params={{ folder: f.id, ticketId: undefined }}
              className={navItem}
              activeProps={{ className: navActive, "data-status": "active" } as Record<string, string>}
            >
              {folderIcons[f.id]}
              <span className="truncate">{f.label}</span>
              {counts && f.id !== "solved" && f.id !== "spam" && <Count n={f.count(counts)} />}
            </Link>
          ))}
        </div>

        <SectionLabel
          action={
            atLeast(role, "agent") ? (
              <Tooltip content="Manage views">
                <Link
                  to="/settings/views"
                  aria-label="Manage views"
                  className="flex size-5 items-center justify-center rounded text-fg-4 opacity-0 transition-opacity hover:bg-hover hover:text-fg group-hover/section:opacity-100 focus-visible:opacity-100"
                >
                  <Plus className="size-3.5" />
                </Link>
              </Tooltip>
            ) : undefined
          }
        >
          Views
        </SectionLabel>
        <div className="flex flex-col gap-px">
          {views?.length ? (
            [...views]
              .sort((a, b) => a.position - b.position)
              .map((v) => (
                <Link
                  key={v.id}
                  to="/views/$viewId/{-$ticketId}"
                  params={{ viewId: v.id, ticketId: undefined }}
                  className={navItem}
                  activeProps={{ className: navActive, "data-status": "active" } as Record<string, string>}
                >
                  <Layers />
                  <span className="truncate">{v.name}</span>
                  <Count n={counts?.views?.[v.id]} />
                </Link>
              ))
          ) : (
            <Link to="/settings/views" className={cn(navItem, "text-fg-4")}>
              <Plus />
              <span>Create a view</span>
            </Link>
          )}
        </div>

        <div className="my-2.5 h-px bg-line-soft" />

        <div className="flex flex-col gap-px">
          <Link to="/contacts/{-$contactId}" params={{ contactId: undefined }} className={navItem} activeProps={{ className: navActive }}>
            <Users />
            Contacts
          </Link>
          <Link to="/kb" className={navItem} activeProps={{ className: navActive }}>
            <BookOpen />
            Knowledge base
          </Link>
          <Link to="/reports" className={navItem} activeProps={{ className: navActive }}>
            <BarChart3 />
            Reports
          </Link>
          <Link to="/settings" className={navItem} activeProps={{ className: navActive }}>
            <Settings />
            Settings
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-1 border-t border-line-soft px-2 py-2">
        <UserMenu />
        <ConnectionIndicator />
        <NotificationsButton />
      </div>
    </nav>
  );
}

function WorkspaceSwitcher() {
  const ws = useWorkspace();
  const memberships = useSession((s) => s.memberships);
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (!ws) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none hover:bg-hover focus-visible:shadow-[0_0_0_2px_var(--focus)] data-[state=open]:bg-hover"
        >
          <WorkspaceGlyph name={ws.name} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em]">{ws.name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-fg-4" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[240px]">
        <MenuLabel>Workspaces</MenuLabel>
        {memberships.map((m) => (
          <MenuItem
            key={m.workspace.id}
            icon={<WorkspaceGlyph name={m.workspace.name} small />}
            onSelect={() => {
              if (m.workspace.id === ws.id) return;
              selectWorkspace(m.workspace.id);
              qc.clear();
              void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: undefined } });
            }}
          >
            <span className="flex items-center gap-2">
              {m.workspace.name}
              {m.workspace.id === ws.id && <Check className="!size-3 !text-fg" />}
            </span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Plus />} onSelect={() => void navigate({ to: "/onboarding" })}>
          Create workspace
        </MenuItem>
        <MenuItem icon={<Settings />} onSelect={() => void navigate({ to: "/settings/workspace" })}>
          Workspace settings
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function WorkspaceGlyph({ name, small }: { name: string; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[6px] bg-inverse font-semibold text-inverse-fg",
        small ? "size-4 text-[9px] !text-inverse-fg" : "size-[22px] text-[11px]",
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function UserMenu() {
  const user = useSession((s) => s.user);
  const { pref, setTheme } = useTheme();
  const navigate = useNavigate();
  const qc = useQueryClient();
  if (!user) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none hover:bg-hover focus-visible:shadow-[0_0_0_2px_var(--focus)] data-[state=open]:bg-hover"
        >
          <Avatar name={user.name || user.email} src={user.avatar_url} size="sm" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2">{user.name || user.email}</span>
        </button>
      </MenuTrigger>
      <MenuContent align="start" side="top" className="w-[230px]">
        <div className="px-2 pb-1.5 pt-1">
          <div className="truncate text-[12.5px] font-medium">{user.name}</div>
          <div className="truncate text-xs text-fg-3">{user.email}</div>
        </div>
        <MenuSeparator />
        <MenuItem icon={<User />} onSelect={() => void navigate({ to: "/settings/profile" })}>
          Profile
        </MenuItem>
        <MenuSub label="Theme" icon={pref === "dark" ? <Moon /> : pref === "light" ? <Sun /> : <Monitor />}>
          <MenuCheckItem checked={pref === "light"} onSelect={() => setTheme("light")} icon={<Sun />}>
            Light
          </MenuCheckItem>
          <MenuCheckItem checked={pref === "dark"} onSelect={() => setTheme("dark")} icon={<Moon />}>
            Dark
          </MenuCheckItem>
          <MenuCheckItem checked={pref === "system"} onSelect={() => setTheme("system")} icon={<Monitor />}>
            System
          </MenuCheckItem>
        </MenuSub>
        <MenuItem icon={<Keyboard />} onSelect={() => shell.shortcuts()}>
          <span className="flex items-center justify-between">
            Keyboard shortcuts <Kbd>?</Kbd>
          </span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<LogOut />}
          onSelect={async () => {
            await signOut();
            resetAnalytics();
            qc.clear();
            void navigate({ to: "/login", search: { next: undefined, error: undefined } });
          }}
        >
          Log out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
