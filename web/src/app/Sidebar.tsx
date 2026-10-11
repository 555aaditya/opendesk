// The sidebar is a column of modules: the brand row, the workspace module and
// search, then the navigation. Mono labels name the groups, a single ink dot
// marks where you are and slides between rows, and `b` folds the column into
// an icon rail that keeps every row reachable.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
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
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  ShieldAlert,
  Sun,
  User,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Mark } from "@/components/brand";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { folders, type FolderId } from "@/lib/folders";
import { q } from "@/lib/queries";
import { atLeast, selectWorkspace, signOut, useRole, useSession, useWorkspace } from "@/lib/session";
import { useTheme, type ThemePref } from "@/lib/theme";
import { resetAnalytics } from "@/lib/analytics";
import { shell, toggleNav, useNav } from "./shellStore";

const folderIcons: Record<FolderId, ReactNode> = {
  unassigned: <CircleDashed />,
  mine: <User />,
  open: <Inbox />,
  pending: <Clock />,
  solved: <CircleCheck />,
  spam: <ShieldAlert />,
};

// The two row shapes share one element so the icon never moves while the label
// fades and the column narrows.
const rowBase =
  "group relative flex items-center rounded-md text-left text-[13px] outline-none transition-[width,background-color,color] duration-150 focus-visible:shadow-[0_0_0_1.5px_var(--focus)] motion-reduce:transition-none [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:transition-colors";
const rowShape = (rail: boolean) => (rail ? "mx-2.5 h-8 w-9 justify-center" : "mx-2.5 h-8 w-[calc(100%-1.25rem)] gap-2.5 px-2.5");
const rowIdle = "text-fg-2 hover:bg-hover hover:text-fg [&>svg]:text-fg-3 hover:[&>svg]:text-fg";
const rowActive = "text-fg font-medium [&>svg]:text-fg";

/** The ink dot beside the current row; one element that slides from row to row. */
function ActiveDot({ rail }: { rail: boolean }) {
  return (
    <motion.span
      layoutId="nav-active-dot"
      aria-hidden
      transition={{ type: "spring", stiffness: 700, damping: 45 }}
      className={cn("absolute size-[5px] rounded-full bg-fg", rail ? "-left-[7px] top-1/2 -mt-[2.5px]" : "-left-[9px] top-1/2 -mt-[2.5px]")}
    />
  );
}

function NavTip({ rail, label, children }: { rail: boolean; label: string; children: React.ReactElement }) {
  if (!rail) return children;
  return (
    <Tooltip content={label} side="right">
      {children}
    </Tooltip>
  );
}

function Label({ children, rail }: { children: ReactNode; rail: boolean }) {
  return <span className={cn("min-w-0 flex-1 truncate transition-opacity duration-150", rail && "sr-only")}>{children}</span>;
}

function Section({
  id,
  label,
  rail,
  action,
  first,
  children,
}: {
  id: string;
  label: string;
  rail: boolean;
  action?: ReactNode;
  first?: boolean;
  children: ReactNode;
}) {
  const key = `od-nav-fold-${id}`;
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setFolded(!folded);
    try {
      localStorage.setItem(key, folded ? "0" : "1");
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className={cn(!first && (rail ? "mt-3 border-t border-line pt-3" : "mt-5"))}>
      {!rail && (
        <div className="group/section mx-2.5 mb-1 flex h-6 items-center px-2.5">
          <button
            type="button"
            aria-expanded={!folded}
            onClick={toggle}
            className="label-caps flex min-w-0 flex-1 items-center gap-1 text-left outline-none transition-colors hover:text-fg-2 focus-visible:text-fg"
          >
            {label}
            <ChevronDown
              aria-hidden
              className={cn(
                "size-3 shrink-0 transition-[transform,opacity] duration-200",
                folded ? "-rotate-90 opacity-100" : "opacity-0 group-hover/section:opacity-100",
              )}
            />
          </button>
          {action}
        </div>
      )}
      {(!folded || rail) && <div className="flex flex-col gap-px">{children}</div>}
    </div>
  );
}

type NavLinkProps = {
  rail: boolean;
  label: string;
  icon: ReactNode;
  count?: number | null;
  badge?: boolean;
  muted?: boolean;
  to: string;
  params?: Record<string, string | undefined>;
};

function NavLink({ rail, label, icon, count, badge, muted, to, params }: NavLinkProps) {
  return (
    <NavTip rail={rail} label={label}>
      <Link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        to={to as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params={params as any}
        className={cn(rowBase, rowShape(rail), rowIdle, muted && "text-fg-3")} activeProps={{ className: rowActive }} aria-label={rail ? label : undefined}>
        {({ isActive }) => (
          <>
            {isActive && <ActiveDot rail={rail} />}
            {icon}
            <Label rail={rail}>{label}</Label>
            {!rail && count !== null && count !== undefined && (
              <span className={cn("mono ml-auto text-[11px] tabular-nums", isActive ? "text-fg-2" : "text-fg-4")}>{count > 999 ? "999+" : count}</span>
            )}
            {rail && badge && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-fg ring-2 ring-surface" />}
          </>
        )}
      </Link>
    </NavTip>
  );
}

export function Sidebar({ drawer }: { drawer?: boolean }) {
  const { data: counts } = useQuery(q.counts());
  const { data: views } = useQuery(q.views());
  const role = useRole();
  const collapsed = useNav((s) => s.collapsed);
  const rail = collapsed && !drawer;
  const { t } = useTranslation("shell");

  return (
    <nav aria-label={t("nav.main")} className="flex h-full w-full flex-col">
      {/* Brand row: its hairline continues the topbar's across the page. */}
      <div className={cn("flex h-12 shrink-0 items-center border-b border-line", rail ? "justify-center" : "justify-between pl-[18px] pr-2.5")}>
        <Link
          to="/inbox/$folder/{-$ticketId}"
          params={{ folder: "unassigned", ticketId: undefined }}
          aria-label="opendesk"
          className="group flex items-center gap-2 rounded-sm outline-none focus-visible:shadow-[0_0_0_1.5px_var(--focus)]"
        >
          <Mark className="size-[18px] text-fg" />
          {!rail && <span className="heading text-[16px] leading-none text-fg">opendesk</span>}
        </Link>
        {!rail && !drawer && (
          <Tooltip content={t("nav.collapse")} shortcut="b">
            <button
              type="button"
              aria-label={t("nav.collapse")}
              onClick={() => toggleNav()}
              className="hidden size-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-hover hover:text-fg md:flex"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </Tooltip>
        )}
      </div>

      <div className={cn("flex shrink-0 flex-col gap-1.5 pb-2 pt-2.5", rail ? "items-center px-2.5" : "px-2.5")}>
        <WorkspaceSwitcher rail={rail} />
        <NavTip rail={rail} label={t("search.label")}>
          <button
            type="button"
            onClick={() => shell.palette()}
            aria-label={t("search.open")}
            className={cn(
              "flex h-8 items-center rounded-md border border-line bg-surface text-[12.5px] text-fg-4 outline-none transition-colors hover:border-line-strong hover:text-fg-3 focus-visible:shadow-[0_0_0_1.5px_var(--focus)]",
              rail ? "w-9 justify-center" : "w-full gap-2 pl-2.5 pr-1.5",
            )}
          >
            <Search className="size-3.5 shrink-0" />
            {!rail && (
              <>
                <span className="flex-1 text-left">{t("search.label")}</span>
                <Kbd>mod k</Kbd>
              </>
            )}
          </button>
        </NavTip>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-3 pt-2">
        <Section id="inbox" label={t("nav.inbox")} rail={rail} first>
          {folders.map((f) => (
            <NavLink
              key={f.id}
              rail={rail}
              label={f.label}
              icon={folderIcons[f.id]}
              to="/inbox/$folder/{-$ticketId}"
              params={{ folder: f.id, ticketId: undefined }}
              count={counts && f.id !== "solved" && f.id !== "spam" ? f.count(counts) : null}
              badge={!!counts && f.id === "unassigned" && (f.count(counts) ?? 0) > 0}
            />
          ))}
        </Section>

        <Section
          id="views"
          label={t("nav.views")}
          rail={rail}
          action={
            atLeast(role, "agent") ? (
              <Tooltip content={t("nav.manageViews")}>
                <Link
                  to="/settings/views"
                  aria-label={t("nav.manageViews")}
                  className="flex size-5 items-center justify-center rounded-sm text-fg-4 opacity-0 transition-opacity hover:bg-hover hover:text-fg group-hover/section:opacity-100 focus-visible:opacity-100"
                >
                  <Plus className="size-3.5" />
                </Link>
              </Tooltip>
            ) : undefined
          }
        >
          {views?.length ? (
            [...views]
              .sort((a, b) => a.position - b.position)
              .map((v) => (
                <NavLink
                  key={v.id}
                  rail={rail}
                  label={v.name}
                  icon={<Layers />}
                  to="/views/$viewId/{-$ticketId}"
                  params={{ viewId: v.id, ticketId: undefined }}
                  count={counts?.views?.[v.id]}
                />
              ))
          ) : (
            <NavLink rail={rail} label={t("nav.createView")} icon={<Plus />} to="/settings/views" muted />
          )}
        </Section>

        <Section id="workspace" label={t("nav.workspace")} rail={rail}>
          <NavLink rail={rail} label={t("nav.contacts")} icon={<Users />} to="/contacts/{-$contactId}" params={{ contactId: undefined }} />
          <NavLink rail={rail} label={t("nav.kb")} icon={<BookOpen />} to="/kb" />
          <NavLink rail={rail} label={t("nav.reports")} icon={<BarChart3 />} to="/reports" />
          <NavLink rail={rail} label={t("nav.settings")} icon={<Settings />} to="/settings" />
        </Section>
      </div>

      {rail && !drawer && (
        <div className="flex shrink-0 justify-center pb-1">
          <Tooltip content={t("nav.expand")} shortcut="b" side="right">
            <button
              type="button"
              aria-label={t("nav.expand")}
              onClick={() => toggleNav()}
              className="hidden size-8 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-hover hover:text-fg md:flex"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          </Tooltip>
        </div>
      )}

      <div className="shrink-0 border-t border-line">
        <UserMenu rail={rail} />
      </div>
    </nav>
  );
}

export function WorkspaceSwitcher({ rail }: { rail?: boolean }) {
  const ws = useWorkspace();
  const memberships = useSession((s) => s.memberships);
  const role = useRole();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation("shell");
  if (!ws) return null;
  return (
    <Menu>
      <NavTip rail={!!rail} label={ws.name}>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={rail ? ws.name : undefined}
            className={cn(
              "group flex items-center text-left outline-none transition-colors focus-visible:shadow-[0_0_0_1.5px_var(--focus)]",
              rail
                ? "size-9 justify-center rounded-md hover:bg-hover data-[state=open]:bg-hover"
                : "h-11 w-full gap-2.5 rounded-md border border-line px-2 hover:border-line-strong data-[state=open]:border-fg",
            )}
          >
            <WorkspaceGlyph name={ws.name} />
            {!rail && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium leading-4 text-fg">{ws.name}</span>
                  <span className="mono block truncate text-[10px] uppercase leading-3.5 tracking-[0.06em] text-fg-4">{role}</span>
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-fg-4 transition-colors group-hover:text-fg" />
              </>
            )}
          </button>
        </MenuTrigger>
      </NavTip>
      <MenuContent align="start" side={rail ? "right" : "bottom"} className="w-[240px]">
        <MenuLabel>{t("workspaces.title")}</MenuLabel>
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
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{m.workspace.name}</span>
              {m.workspace.id === ws.id && <Check className="!size-3 !text-fg" />}
            </span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Plus />} onSelect={() => void navigate({ to: "/onboarding" })}>
          {t("workspaces.create")}
        </MenuItem>
        <MenuItem icon={<Settings />} onSelect={() => void navigate({ to: "/settings/workspace" })}>
          {t("workspaces.settings")}
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
        "flex shrink-0 items-center justify-center bg-inverse font-semibold tracking-tight text-inverse-fg",
        small ? "size-4 rounded-[2px] text-[9px] !text-inverse-fg" : "size-7 rounded-[4px] text-[12px]",
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** Light, dark, system: a three-way segmented switch, used in the account menu. */
export function ThemeSwitch() {
  const { pref, setTheme } = useTheme();
  const { t } = useTranslation("shell");
  const opts: { v: ThemePref; icon: ReactNode; label: string }[] = [
    { v: "light", icon: <Sun />, label: t("theme.light") },
    { v: "dark", icon: <Moon />, label: t("theme.dark") },
    { v: "system", icon: <Monitor />, label: t("theme.system") },
  ];
  return (
    <div role="radiogroup" aria-label={t("theme.title")} className="inline-flex items-center rounded-md border border-line p-0.5">
      {opts.map((o) => (
        <Tooltip key={o.v} content={o.label}>
          <button
            type="button"
            role="radio"
            aria-checked={pref === o.v}
            aria-label={o.label}
            onClick={(e) => {
              e.preventDefault();
              setTheme(o.v);
            }}
            className={cn(
              "flex h-[22px] w-7 items-center justify-center rounded-sm text-fg-3 transition-[color,background-color,box-shadow] hover:text-fg [&_svg]:size-3.5",
              pref === o.v && "bg-surface text-fg shadow-[0_0_0_1px_var(--line),0_1px_2px_rgb(0_0_0/0.06)]",
            )}
          >
            {o.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function UserMenu({ rail }: { rail: boolean }) {
  const user = useSession((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation("shell");
  if (!user) return null;
  const name = user.name || user.email;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={t("account.menu")}
          className={cn(
            "my-2 flex items-center rounded-md text-left outline-none transition-[width,background-color] duration-200 hover:bg-hover focus-visible:shadow-[0_0_0_1.5px_var(--focus)] data-[state=open]:bg-hover",
            rail ? "mx-auto w-9 justify-center py-0.5" : "mx-2.5 w-[calc(100%-1.25rem)] gap-2.5 px-2 py-1.5",
          )}
        >
          <Avatar name={name} src={user.avatar_url} size="lg" />
          {!rail && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-fg">{name}</span>
              <span className="mono block truncate text-[10.5px] text-fg-4">{user.email}</span>
            </span>
          )}
        </button>
      </MenuTrigger>
      <MenuContent align="start" side="top" className="w-[244px]">
        <div className="px-2 pb-2 pt-1.5">
          <div className="truncate text-[12.5px] font-medium">{user.name}</div>
          <div className="mono truncate text-[11px] text-fg-3">{user.email}</div>
        </div>
        <MenuSeparator />
        <div className="flex h-8 items-center justify-between gap-3 pl-2 pr-0.5">
          <span className="text-[12.5px] text-fg">{t("theme.title")}</span>
          <ThemeSwitch />
        </div>
        <MenuSeparator />
        <MenuItem icon={<User />} onSelect={() => void navigate({ to: "/settings/profile" })}>
          {t("account.profile")}
        </MenuItem>
        <MenuItem icon={<Settings />} onSelect={() => void navigate({ to: "/settings" })}>
          {t("nav.settings")}
        </MenuItem>
        <MenuItem icon={<Keyboard />} onSelect={() => shell.shortcuts()}>
          <span className="flex items-center justify-between">
            {t("account.shortcuts")} <Kbd>?</Kbd>
          </span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          danger
          icon={<LogOut />}
          onSelect={async () => {
            await signOut();
            resetAnalytics();
            qc.clear();
            void navigate({ to: "/login", search: { next: undefined, error: undefined } });
          }}
        >
          {t("account.logout")}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
