// The sidebar: sits on the chrome beside the white work panel. Small
// tracked-uppercase section labels, 28px rows, hairlines between groups, and an
// icon-only rail (`b` or the Collapse row) that keeps every row reachable.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatedNumber } from "@/components/motion";
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
import { motion, useReducedMotion } from "motion/react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChecklistMini } from "@/components/onboarding/Checklist";
import { useUrgentChats } from "@/components/tickets/useUrgentChats";
import { formatWait, urgentWash } from "@/components/tickets/waiting";
import { AvailabilityMenuItems } from "@/components/presence/availability";
import { Avatar } from "@/components/ui/avatar";
import { toast } from "@/components/ui/toast";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { tone, toneFor } from "@/lib/tones";
import { folders, type FolderId } from "@/lib/folders";
import { useAI } from "@/lib/ai";
import { useDismissOnboarding, useSetAvailability } from "@/lib/pictures";
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
  "group relative isolate flex items-center rounded-md text-left text-[12.5px] outline-none transition-[width,background-color,color] duration-200 ease-out focus-visible:shadow-[0_0_0_2px_var(--focus)] motion-reduce:transition-none [&>svg]:size-[15px] [&>svg]:shrink-0 [&>svg]:transition-colors";
const rowShape = (rail: boolean) => (rail ? "mx-3 h-8 w-8 justify-center" : "mx-2.5 h-7 w-[calc(100%-1.25rem)] gap-2.5 px-2");
const rowIdle = "text-fg-2 hover:bg-chrome-hover hover:text-fg [&>svg]:text-fg-3 hover:[&>svg]:text-fg-2";
// The current row: its grey pill glides between rows (ActivePill), so the row
// itself only changes its text.
const rowActive = "text-fg font-medium [&>svg]:text-fg hover:bg-transparent";

const PillCtx = createContext("nav-pill");

/** The active row's background, shared across rows so it glides between them. */
function ActivePill() {
  const id = useContext(PillCtx);
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      layoutId={reduce ? undefined : id}
      transition={{ type: "spring", stiffness: 550, damping: 42, mass: 0.7 }}
      className="absolute inset-0 -z-10 rounded-md bg-chrome-active"
    />
  );
}

/** Link children that draw the gliding pill when the row is current. */
const withPill = (content: ReactNode) =>
  function NavRowContent({ isActive }: { isActive: boolean }) {
    return (
      <>
        {isActive && <ActivePill />}
        {content}
      </>
    );
  };

function NavTip({ rail, label, children }: { rail: boolean; label: string; children: React.ReactElement }) {
  if (!rail) return children;
  return (
    <Tooltip content={label} side="right">
      {children}
    </Tooltip>
  );
}

function Count({ n, rail }: { n: number | null | undefined; rail: boolean }) {
  if (n === null || n === undefined || rail) return null;
  return (
    <AnimatedNumber
      value={Math.min(n, 1000)}
      format={(v) => (v >= 1000 ? "999+" : String(Math.round(v)))}
      flash
      className="mono ml-auto text-[11px] text-fg-4 group-data-[status=active]:text-fg-2"
    />
  );
}

/** The pulsing red dot of a waiting visitor. */
function WaitDot({ size = "size-1.5" }: { size?: string }) {
  return (
    <span className={cn("relative flex shrink-0", size)}>
      <span className="absolute inset-0 rounded-full bg-tone-red-solid animate-urgent-ping motion-reduce:hidden" />
      <span className={cn("relative rounded-full bg-tone-red-solid", size)} />
    </span>
  );
}

/**
 * Visitors waiting in live chat with nobody on it: a red row on top of the inbox, on
 * every page, that opens the longest wait. Gone when nobody waits.
 */
function WaitingChats({ rail }: { rail: boolean }) {
  const { t } = useTranslation("shell");
  const navigate = useNavigate();
  const { urgent, now } = useUrgentChats();
  if (!urgent.length) return null;
  const longest = urgent[0];
  const time = formatWait(now - longest.wait.since);
  const label = t("nav.waiting", { count: urgent.length, time });
  return (
    <NavTip rail={rail} label={label}>
      <button
        type="button"
        onClick={() => void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: longest.ticket.id } })}
        aria-label={label}
        className={cn(
          rowBase,
          rowShape(rail),
          urgentWash,
          "mb-1 overflow-hidden font-medium text-tone-red shadow-[inset_0_0_0_1px_var(--tone-red-line)] hover:brightness-[0.98] active:scale-[0.99]",
        )}
      >
        {rail ? (
          <span className="mono text-[11px] font-semibold tabular-nums">{urgent.length > 9 ? "9+" : urgent.length}</span>
        ) : (
          <>
            <span className="flex size-[15px] shrink-0 items-center justify-center">
              <WaitDot size="size-2" />
            </span>
            <span className="min-w-0 flex-1 truncate">{t("nav.waitingShort", { count: urgent.length })}</span>
            <span className="mono ml-auto shrink-0 text-[11px] font-semibold tabular-nums">{time}</span>
          </>
        )}
      </button>
    </NavTip>
  );
}

/** On the Unassigned row: how many of those are visitors waiting in chat right now. */
function WaitingCount({ rail }: { rail: boolean }) {
  const { t } = useTranslation("shell");
  const { urgent } = useUrgentChats();
  if (!urgent.length) return null;
  if (rail) return <span className="absolute left-1 top-1"><WaitDot /></span>;
  return (
    <span
      title={t("nav.waitingCount", { count: urgent.length })}
      className="ml-auto inline-flex h-4 shrink-0 items-center gap-1 rounded-full bg-tone-red-solid pl-1.5 pr-1.5 text-[10.5px] font-semibold tabular-nums text-white"
    >
      <span className="relative flex size-1 shrink-0">
        <span className="absolute inset-0 rounded-full bg-white animate-urgent-ping motion-reduce:hidden" />
        <span className="relative size-1 rounded-full bg-white" />
      </span>
      {urgent.length}
    </span>
  );
}

function Label({ children, rail }: { children: ReactNode; rail: boolean }) {
  return <span className={cn("min-w-0 flex-1 truncate", rail ? "sr-only" : "animate-label-in motion-reduce:animate-none")}>{children}</span>;
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
    <div className={cn(!first && "mt-5")}>
      {!rail && (
        <div className="group/section mx-2.5 mb-0.5 flex h-6 items-center px-2">
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

export function Sidebar({ drawer }: { drawer?: boolean }) {
  const { data: counts } = useQuery(q.counts());
  const { data: views } = useQuery(q.views());
  const role = useRole();
  const collapsed = useNav((s) => s.collapsed);
  const rail = collapsed && !drawer;
  const { t } = useTranslation("shell");

  return (
    <PillCtx.Provider value={drawer ? "nav-pill-drawer" : "nav-pill"}>
    <nav aria-label={t("nav.main")} className="flex h-full w-full flex-col">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-3 pt-1">
        <Section id="inbox" label={t("nav.inbox")} rail={rail} first>
          <WaitingChats rail={rail} />
          {folders.map((f) => (
            <NavTip key={f.id} rail={rail} label={f.label}>
              <Link
                to="/inbox/$folder/{-$ticketId}"
                params={{ folder: f.id, ticketId: undefined }}
                className={cn(rowBase, rowShape(rail), rowIdle)}
                activeProps={{ className: rowActive, "data-status": "active" } as Record<string, string>}
                aria-label={rail ? f.label : undefined}
              >{withPill(<>
                {folderIcons[f.id]}
                <Label rail={rail}>{f.label}</Label>
                {f.id === "unassigned" && <WaitingCount rail={rail} />}
                {counts && f.id !== "solved" && f.id !== "spam" && <Count n={f.count(counts)} rail={rail} />}
                {rail && counts && f.id === "unassigned" && (f.count(counts) ?? 0) > 0 && (
                  <span className="absolute right-1 top-1 size-1.5 rounded-full bg-fg ring-2 ring-chrome" />
                )}
              </>)}</Link>
            </NavTip>
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
                  className="flex size-5 items-center justify-center rounded text-fg-4 opacity-0 transition-opacity hover:bg-chrome-hover hover:text-fg group-hover/section:opacity-100 focus-visible:opacity-100"
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
                <NavTip key={v.id} rail={rail} label={v.name}>
                  <Link
                    to="/views/$viewId/{-$ticketId}"
                    params={{ viewId: v.id, ticketId: undefined }}
                    className={cn(rowBase, rowShape(rail), rowIdle)}
                    activeProps={{ className: rowActive, "data-status": "active" } as Record<string, string>}
                    aria-label={rail ? v.name : undefined}
                  >{withPill(<>
                    <Layers />
                    <Label rail={rail}>{v.name}</Label>
                    <Count n={counts?.views?.[v.id]} rail={rail} />
                  </>)}</Link>
                </NavTip>
              ))
          ) : (
            <NavTip rail={rail} label={t("nav.createView")}>
              <Link to="/settings/views" className={cn(rowBase, rowShape(rail), rowIdle, "text-fg-3")}>
                <Plus />
                <Label rail={rail}>{t("nav.createView")}</Label>
              </Link>
            </NavTip>
          )}
        </Section>

        <Section id="workspace" label={t("nav.workspace")} rail={rail}>
          <NavTip rail={rail} label={t("nav.contacts")}>
            <Link
              to="/contacts/{-$contactId}"
              params={{ contactId: undefined }}
              className={cn(rowBase, rowShape(rail), rowIdle)}
              activeProps={{ className: rowActive }}
              aria-label={rail ? t("nav.contacts") : undefined}
            >{withPill(<>
              <Users />
              <Label rail={rail}>{t("nav.contacts")}</Label>
            </>)}</Link>
          </NavTip>
          <NavTip rail={rail} label={t("nav.kb")}>
            <Link to="/kb" className={cn(rowBase, rowShape(rail), rowIdle)} activeProps={{ className: rowActive }} aria-label={rail ? t("nav.kb") : undefined}>{withPill(<>
              <BookOpen />
              <Label rail={rail}>{t("nav.kb")}</Label>
            </>)}</Link>
          </NavTip>
          <NavTip rail={rail} label={t("nav.reports")}>
            <Link to="/reports" className={cn(rowBase, rowShape(rail), rowIdle)} activeProps={{ className: rowActive }} aria-label={rail ? t("nav.reports") : undefined}>{withPill(<>
              <BarChart3 />
              <Label rail={rail}>{t("nav.reports")}</Label>
            </>)}</Link>
          </NavTip>
        </Section>
      </div>

      <div className="flex shrink-0 flex-col gap-px py-1.5">
        <SetupChecklist rail={rail} />
        <NavTip rail={rail} label={t("nav.settings")}>
          <Link to="/settings" className={cn(rowBase, rowShape(rail), rowIdle)} activeProps={{ className: rowActive }} aria-label={rail ? t("nav.settings") : undefined}>{withPill(<>
            <Settings />
            <Label rail={rail}>{t("nav.settings")}</Label>
          </>)}</Link>
        </NavTip>
        {!drawer && (
          <Tooltip content={rail ? t("nav.expand") : t("nav.collapse")} shortcut="b" side="right">
            <button
              type="button"
              aria-label={rail ? t("nav.expand") : t("nav.collapse")}
              onClick={() => toggleNav()}
              className={cn(rowBase, rowShape(rail), rowIdle, "hidden md:flex")}
            >
              {rail ? <PanelLeftOpen /> : <PanelLeftClose />}
              <Label rail={rail}>{t("nav.collapse")}</Label>
            </button>
          </Tooltip>
        )}
      </div>

      <div className="shrink-0 border-t border-chrome-line">
        <UserMenu rail={rail} />
      </div>
    </nav>
    </PillCtx.Provider>
  );
}

export function WorkspaceSwitcher() {
  const ws = useWorkspace();
  const memberships = useSession((s) => s.memberships);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation("shell");
  if (!ws) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="group flex h-8 min-w-0 max-w-[220px] items-center gap-2 rounded-md pl-1 pr-1.5 text-left outline-none transition-colors hover:bg-chrome-hover focus-visible:shadow-[0_0_0_2px_var(--focus)] data-[state=open]:bg-chrome-hover"
        >
          <WorkspaceGlyph name={ws.name} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">{ws.name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-fg-4 transition-colors group-hover:text-fg-2" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[240px]">
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
        "flex shrink-0 items-center justify-center font-semibold tracking-tight text-white",
        tone[toneFor(name)].solid,
        small ? "size-4 rounded-sm text-[9px] !text-white" : "size-6 rounded-md text-[10.5px]",
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
    <div role="radiogroup" aria-label={t("theme.title")} className="inline-flex items-center rounded-md bg-hover p-0.5">
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

/** The onboarding checklist, above Settings until it is dismissed. */
function SetupChecklist({ rail }: { rail: boolean }) {
  const { t } = useTranslation("setup");
  const { data } = useQuery(q.onboarding());
  const dismiss = useDismissOnboarding();
  const ai = useAI();
  const role = useRole();
  if (!data || data.dismissed || !data.steps.length) return null;
  return (
    <div className={rail ? "mx-3" : "mx-2.5"}>
      <ChecklistMini
        collapsed={rail}
        data={data}
        isAdmin={atLeast(role, "admin")}
        unavailable={ai.enabled ? undefined : { try_ollie: t("checklist.needs_ai") }}
        onDismiss={() => dismiss.mutateAsync()}
        triggerClassName={cn("h-7 hover:bg-chrome-hover data-[state=open]:bg-chrome-hover", rail && "h-8")}
      />
    </div>
  );
}

function UserMenu({ rail }: { rail: boolean }) {
  const user = useSession((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation("shell");
  const { data: members } = useQuery(q.members());
  const setAvailability = useSetAvailability();
  if (!user) return null;
  const name = user.name || user.email;
  const me = members?.find((m) => m.user.id === user.id);
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={t("account.menu")}
          className={cn(
            "my-2 flex items-center rounded-md text-left outline-none transition-[width,background-color] duration-200 hover:bg-chrome-hover focus-visible:shadow-[0_0_0_2px_var(--focus)] data-[state=open]:bg-chrome-hover",
            rail ? "mx-3 w-8 justify-center py-0.5" : "mx-2.5 w-[calc(100%-1.25rem)] gap-2.5 px-1.5 py-1",
          )}
        >
          <Avatar name={name} src={user.avatar_url} size="lg" presence={me?.presence} />
          {!rail && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-fg">{name}</span>
              <span className="block truncate text-[11px] text-fg-3">{user.email}</span>
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
        {me && (
          <>
            <AvailabilityMenuItems
              value={me.availability}
              onChange={(v) => setAvailability.mutate({ userId: "me", availability: v }, { onError: (e) => toast.error(e) })}
              openTickets={me.role === "viewer" ? undefined : me.open_tickets}
              maxOpenTickets={me.max_open_tickets}
            />
            <MenuSeparator />
          </>
        )}
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
