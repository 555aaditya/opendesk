import { useInfiniteQuery } from "@tanstack/react-query";
import { Bot, ChevronRight, KeyRound, ScrollText } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NoAccess, SettingsPage } from "@/components/layout";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import type { AuditLog as Entry } from "@/lib/api/types";
import { clock, dayLabel, fullDate } from "@/lib/format";
import { q } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { cn } from "@/lib/cn";

type Category = "all" | "access" | "security" | "people" | "integrations" | "workspace";

/** "auth.login_failed" and "login.failed" read the same. */
function norm(action: string) {
  return action.startsWith("auth.") ? action.slice(5).replace("_", ".") : action;
}

const categoryOf = (action: string): Exclude<Category, "all"> => {
  const head = norm(action).split(".")[0];
  if (head === "login" || head === "logout" || head === "session" || head === "oauth") return "access";
  if (head === "totp" || head === "password" || head === "mfa" || head === "recovery_codes" || head === "account") return "security";
  if (head === "member" || head === "invitation" || head === "team") return "people";
  if (head === "api_key" || head === "webhook" || head === "mailbox" || head === "widget") return "integrations";
  return "workspace";
};

const verbs: Record<string, string> = {
  "login.succeeded": "signed in",
  login: "signed in",
  "login.failed": "failed to sign in",
  "member.invited": "invited",
  logout: "signed out",
  "session.revoked": "revoked a session",
  "password.changed": "changed their password",
  "password.reset": "reset their password",
  "totp.enabled": "turned on two-factor authentication",
  "totp.disabled": "turned off two-factor authentication",
  "recovery_codes.used": "used a recovery code",
  "member.added": "added a member",
  "member.removed": "removed a member",
  "member.role_changed": "changed a member's role",
  "invitation.created": "invited someone",
  "invitation.revoked": "revoked an invitation",
  "invitation.accepted": "accepted an invitation",
  "api_key.created": "created an API key",
  "api_key.revoked": "revoked an API key",
  "api_key.deleted": "revoked an API key",
  "webhook.created": "created a webhook",
  "webhook.updated": "updated a webhook",
  "webhook.deleted": "deleted a webhook",
  "mailbox.connected": "connected a mailbox",
  "mailbox.created": "added a mailbox",
  "mailbox.disconnected": "disconnected a mailbox",
  "mailbox.deleted": "removed a mailbox",
  "workspace.updated": "updated workspace settings",
  "workspace.transferred": "transferred ownership",
  "widget.secret_rotated": "rotated the widget secret",
  "widget_secret.rotated": "rotated the widget secret",
  "workspace.widget_secret_rotated": "rotated the widget secret",
  "workspace.created": "created the workspace",
  "2fa.enabled": "turned on two-factor authentication",
  "2fa.disabled": "turned off two-factor authentication",
  "member.joined": "joined the workspace",
  "member.left": "left the workspace",
  "member.account_deleted": "deleted their account",
  "identity.linked": "linked a sign-in provider",
  "session.refresh_reused": "had a reused session token refused",
  "api_key.updated": "renamed an API key",
  "mailbox.updated": "updated a mailbox",
  "team.created": "created a team",
  "team.updated": "updated a team",
  "team.deleted": "deleted a team",
  "view.created": "created a view",
  "view.updated": "updated a view",
  "view.deleted": "deleted a view",
  "widget.settings_updated": "updated the chat widget",
  "ai.settings_updated": "updated AI settings",
  "billing.updated": "changed the subscription",
  "billing.credits_purchased": "bought AI credits",
  "billing.payment_failed": "had a payment fail",
  "billing.seats_synced": "synced billed seats",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

const genericVerbs = new Set(["created", "updated", "deleted", "removed", "added", "revoked", "connected", "disconnected", "enabled", "disabled", "rotated", "changed", "published", "invited"]);

function generic(e: Entry): string | null {
  const a = norm(e.action);
  const i = a.lastIndexOf(".");
  const verb = i < 0 ? "" : a.slice(i + 1);
  if (!genericVerbs.has(verb)) return null;
  const thing = (i < 0 ? a : a.slice(0, i)).replace(/_/g, " ");
  const article = /^[aeiou]/.test(thing) || thing.startsWith("sla") ? "an" : "a";
  return `${verb} ${article} ${thing === "sla policy" ? "SLA policy" : thing === "api key" ? "API key" : thing}`;
}

/** A plain sentence for an entry, with the object named when the data has it. */
function describe(e: Entry): ReactNode {
  const verb = verbs[norm(e.action)] ?? verbs[e.action] ?? generic(e);
  const d = e.data;
  const object = str(d.email) ?? str(d.name) ?? str(d.url) ?? str(d.title);
  const role = norm(e.action) === "member.role_changed" && str(d.to) ? ` to ${str(d.to)}` : "";
  if (!verb)
    return (
      <>
        <span className="mono text-[11.5px] text-fg-3">{e.action}</span>
        {object && <span className="font-medium text-fg"> {object}</span>}
      </>
    );
  return (
    <>
      {verb}
      {object && <span className="font-medium text-fg"> {object}</span>}
      {role}
    </>
  );
}

function Actor({ e }: { e: Entry }) {
  if (e.actor.type === "user" && e.actor.user)
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={e.actor.user.name || e.actor.user.email} src={e.actor.user.avatar_url} size="sm" />
        <span className="truncate font-medium text-fg">{e.actor.user.name || e.actor.user.email}</span>
      </span>
    );
  if (e.actor.type === "api_key")
    return (
      <span className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-hover text-fg-3">
          <KeyRound className="size-3" />
        </span>
        <span className="font-medium text-fg">API key</span>
        {e.actor.api_key_id && <span className="mono text-[11px] text-fg-4">{e.actor.api_key_id.slice(0, 8)}</span>}
      </span>
    );
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded-full bg-hover text-fg-3">
        <Bot className="size-3" />
      </span>
      <span className="font-medium text-fg">{e.actor.type === "user" ? "Someone" : "System"}</span>
    </span>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function Row({ e }: { e: Entry }) {
  const [open, setOpen] = useState(false);
  const failed = norm(e.action) === "login.failed";
  const keys = Object.keys(e.data ?? {});
  return (
    <div className="border-b border-line-soft last:border-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-[12.5px] text-fg-2 transition-colors hover:bg-hover/50"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-fg-4 transition-transform duration-150", open && "rotate-90")} />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <Actor e={e} />
          <span className="min-w-0">{describe(e)}</span>
          {failed && <span className="size-1.5 rounded-full bg-danger" aria-label="Failed" />}
        </span>
        <span className="mono hidden shrink-0 text-[11.5px] text-fg-4 sm:block">{e.ip}</span>
        <Tooltip content={fullDate(e.created_at)}>
          <span className="mono w-11 shrink-0 text-right text-[11.5px] tabular-nums text-fg-3">{clock(e.created_at)}</span>
        </Tooltip>
      </button>
      {open && (
        <div className="mx-4 mb-3 ml-[42px] grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 rounded-md border border-line bg-sunken px-3 py-2.5 text-[11.5px]">
          <span className="text-fg-3">Action</span>
          <span className="mono text-fg">{e.action}</span>
          <span className="text-fg-3">Entity</span>
          <span className="mono text-fg">
            {e.entity_type}
            {e.entity_id ? ` ${e.entity_id}` : ""}
          </span>
          <span className="text-fg-3">IP address</span>
          <span className="mono text-fg">{e.ip || "–"}</span>
          {keys.map((k) => (
            <div key={k} className="contents">
              <span className="mono text-fg-3">{k}</span>
              <span className="mono break-all text-fg">{formatValue(e.data[k])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AuditLog() {
  const role = useRole();
  const admin = atLeast(role, "admin");
  const list = useInfiniteQuery({ ...q.auditLogs(), enabled: admin });
  const [cat, setCat] = useState<Category>("all");
  const sentinel = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.data), [list.data]);
  const shown = useMemo(() => (cat === "all" ? entries : entries.filter((e) => categoryOf(e.action) === cat)), [entries, cat]);
  const days = useMemo(() => {
    const groups: { day: string; label: string; rows: Entry[] }[] = [];
    for (const e of shown) {
      const day = new Date(e.created_at).toDateString();
      const last = groups[groups.length - 1];
      if (last?.day === day) last.rows.push(e);
      else groups.push({ day, label: dayLabel(e.created_at), rows: [e] });
    }
    return groups;
  }, [shown]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((x) => x.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!admin)
    return (
      <SettingsPage title="Audit log">
        <NoAccess what="the audit log" />
      </SettingsPage>
    );

  return (
    <SettingsPage
      wide
      title="Audit log"
      description="Security and admin activity in this workspace: sign-ins, 2FA, members, keys, webhooks and mailboxes."
    >
      <div className="-mb-3 overflow-x-auto">
        <Segmented
          value={cat}
          onChange={setCat}
          options={[
            { value: "all", label: "All" },
            { value: "access", label: "Sign-ins" },
            { value: "security", label: "Security" },
            { value: "people", label: "People" },
            { value: "integrations", label: "Integrations" },
            { value: "workspace", label: "Workspace" },
          ]}
        />
      </div>
      {list.isLoading ? (
        <div className="rounded-lg border border-line">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex h-11 items-center gap-3 border-b border-line-soft px-4 last:border-0">
              <div className="skeleton size-5 rounded-full" />
              <div className="skeleton h-2.5" style={{ width: `${30 + ((i * 17) % 35)}%` }} />
              <div className="skeleton ml-auto h-2.5 w-10" />
            </div>
          ))}
        </div>
      ) : !shown.length ? (
        <div className="rounded-lg border border-line">
          <EmptyState
            compact
            lit={2}
            icon={<ScrollText className="size-8 text-fg-4" strokeWidth={1.25} />}
            title={cat === "all" ? "Nothing logged yet" : "Nothing in this category"}
            description={cat === "all" ? "Sign-ins and admin changes appear here." : hasNextPage ? "Older entries load as you scroll." : undefined}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((g) => (
            <section key={g.day}>
              <h2 className="label-caps mb-2 px-1">{g.label}</h2>
              <div className="rounded-lg border border-line bg-surface">
                {g.rows.map((e) => (
                  <Row key={e.id} e={e} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <div ref={sentinel} className="flex h-10 items-center justify-center text-[12px] text-fg-4">
        {isFetchingNextPage ? <Spinner className="size-3.5" /> : !hasNextPage && entries.length > 0 ? "That's everything" : null}
      </div>
    </SettingsPage>
  );
}
