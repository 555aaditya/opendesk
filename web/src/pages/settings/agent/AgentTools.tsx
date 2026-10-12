// Settings > AI agent > Tools: the company's own MCP servers, whose tools the
// agent can call (order lookups, account changes). Each tool has a switch, a
// policy (run on its own, or ask the visitor first) and a verified-only flag,
// and can be run once from here. Status moves live (ai_mcp_server.*). The
// OAuth flow comes back to this page with ?connected=<id> or ?error=<code>.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ExternalLink,
  Eye,
  KeyRound,
  Link2,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess, Section, SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-button";
import { Drawer } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { IconTile, ListSkeleton, MonoChip } from "@/components/settings2/bits";
import { MotionList, MotionRow } from "@/components/settings2/motion";
import { SettingsEmpty } from "@/components/settings2/SettingsEmpty";
import { useListMutation } from "@/components/settings2/optimistic";
import { AgentOffNotice } from "@/components/agent/bits";
import { agentSettings } from "@/components/agent/settings";
import { ServerDialog, startOAuth, ToolTest } from "@/components/agent/tools";
import { api } from "@/lib/api/endpoints";
import type { McpServer, McpServerStatus, McpTool, McpToolPatch } from "@/lib/api/types";
import { config } from "@/lib/config";
import { fullDate, relShort } from "@/lib/format";
import { useAI } from "@/lib/ai";
import { springs } from "@/lib/motion";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { tone, type Tone } from "@/lib/tones";
import { cn } from "@/lib/cn";

const STATUS_TONE: Record<McpServerStatus, Tone> = { connected: "green", needs_auth: "amber", error: "red", connecting: "violet" };
const DOCS = "https://docs.opendesk.sh/api/mcp/";

function mcpEndpoint(): string {
  try {
    return `${new URL(config.apiUrl || window.location.origin, window.location.href).origin}/mcp`;
  } catch {
    return `${window.location.origin}/mcp`;
  }
}

export default function AgentTools() {
  const { t } = useTranslation("agent");
  const admin = atLeast(useRole(), "admin");
  const ai = useAI();
  const { data, isLoading } = useQuery({ ...q.mcpServers(), enabled: admin });
  const confirm = useConfirm();
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useOAuthReturn(setOpenId);

  const toggle = useListMutation<McpServer, { id: string; enabled: boolean }>(
    qk.mcpServers,
    (v) => api.ai.mcp.update(v.id, { enabled: v.enabled }),
    (rows, v) => rows.map((r) => (r.id === v.id ? { ...r, enabled: v.enabled } : r)),
    { errorText: t("tools.updateError") },
  );
  const remove = useListMutation<McpServer, string>(qk.mcpServers, (id) => api.ai.mcp.remove(id), (rows, id) => rows.filter((r) => r.id !== id), {
    errorText: t("tools.deleteError"),
  });
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: (id: string) => api.ai.mcp.sync(id),
    onMutate: (id) => qc.setQueryData<McpServer[]>(qk.mcpServers, (rows) => rows?.map((r) => (r.id === id ? { ...r, status: "connecting" } : r))),
    onSuccess: (s) => {
      qc.setQueryData<McpServer[]>(qk.mcpServers, (rows) => rows?.map((r) => (r.id === s.id ? s : r)));
      if (s.status === "connected") toast.success(t("tools.synced", { count: s.tools.length }));
    },
    onError: (e) => {
      toast.error(e, t("tools.syncError"));
      void qc.invalidateQueries({ queryKey: qk.mcpServers });
    },
  });
  const connect = useMutation({ mutationFn: startOAuth, onError: (e) => toast.error(e, t("tools.oauthError")) });

  const list = data ?? [];
  const open = list.find((s) => s.id === openId) ?? null;
  const enabledTools = list.filter((s) => s.enabled).reduce((n, s) => n + s.tools.filter((x) => x.enabled).length, 0);

  const askDelete = (s: McpServer) =>
    confirm.show(t("tools.deleteBody", { name: s.name }), async () => {
      await remove.mutateAsync(s.id);
      if (openId === s.id) setOpenId(null);
    }, { title: t("tools.deleteTitle"), confirmLabel: t("tools.delete"), danger: true });

  if (!admin)
    return (
      <SettingsPage title={t("tools.title")}>
        <NoAccess what={t("tools.what")} />
      </SettingsPage>
    );

  const add = (
    <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")} disabled={list.length >= 10}>
      {t("tools.add")}
    </Button>
  );

  return (
    <SettingsPage wide title={t("tools.title")} description={t("tools.description")} actions={add}>
      {ai.config && !agentSettings(ai.features).widget_answers && <AgentOffNotice className="-mb-3" />}
      <Section
        flush
        title={data ? t("tools.count", { count: list.length }) : undefined}
        actions={
          list.length > 0 ? (
            <span className={cn("mono text-[11px] tabular-nums", enabledTools > 64 ? "text-danger-fg" : "text-fg-3")}>{t("tools.enabledCount", { n: enabledTools })}</span>
          ) : undefined
        }
      >
        {isLoading ? (
          <ListSkeleton rows={2} />
        ) : !list.length ? (
          <SettingsEmpty
            art="settings"
            title={t("tools.empty.title")}
            description={t("tools.empty.description")}
            action={add}
            tips={[
              { label: t("tools.empty.tipConfirm"), icon: <ShieldCheck /> },
              { label: t("tools.empty.tipVerified"), icon: <KeyRound /> },
            ]}
          />
        ) : (
          <MotionList>
            {list.map((s) => (
              <MotionRow key={s.id}>
                <ServerRow
                  s={s}
                  onOpen={() => setOpenId(s.id)}
                  onToggle={(enabled) => toggle.mutate({ id: s.id, enabled })}
                  onSync={() => sync.mutate(s.id)}
                  onConnect={() => connect.mutate(s.id)}
                  connecting={connect.isPending && connect.variables === s.id}
                  onEdit={() => setEditing(s)}
                  onDelete={() => askDelete(s)}
                />
              </MotionRow>
            ))}
          </MotionList>
        )}
      </Section>

      <ClientsCard />

      {editing && (
        <ServerDialog
          server={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            if (editing !== "new") return void toast.success(t("tools.saved"));
            if (s.status === "needs_auth" && s.auth.kind === "oauth") return void connect.mutate(s.id);
            if (s.status === "needs_auth") toast.info(t("tools.needsAuthToast", { name: s.name }));
            else if (s.status === "connected") toast.success(t("tools.added", { name: s.name, count: s.tools.length }));
            setOpenId(s.id);
          }}
        />
      )}
      <ServerDrawer
        server={open}
        onClose={() => setOpenId(null)}
        onSync={() => open && sync.mutate(open.id)}
        syncing={sync.isPending && sync.variables === open?.id}
        onConnect={() => open && connect.mutate(open.id)}
        connecting={connect.isPending}
        onEdit={() => open && setEditing(open)}
        onDelete={() => open && askDelete(open)}
      />
    </SettingsPage>
  );
}

/** Reads ?connected / ?error once after the OAuth redirect, says so, and clears the URL. */
function useOAuthReturn(openServer: (id: string) => void) {
  const { t } = useTranslation("agent");
  const search = useSearch({ strict: false }) as { connected?: string; error?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || (!search.connected && !search.error)) return;
    done.current = true;
    if (search.connected) {
      void qc.invalidateQueries({ queryKey: qk.mcpServers });
      const s = qc.getQueryData<McpServer[]>(qk.mcpServers)?.find((x) => x.id === search.connected);
      toast.success(s ? t("tools.oauthDoneNamed", { name: s.name }) : t("tools.oauthDone"));
      openServer(search.connected);
    } else if (search.error) {
      const known = ["oauth_state", "access_denied", "forbidden", "not_found", "provider_error", "internal"].includes(search.error);
      toast.error(known ? t(`tools.oauthFail.${search.error as "access_denied"}`) : t("tools.oauthFail.other"));
    }
    void navigate({ to: "/settings/ai/tools", search: {}, replace: true });
  }, [search.connected, search.error, navigate, qc, t, openServer]);
}

function StatusPill({ s }: { s: McpServer }) {
  const { t } = useTranslation("agent");
  const hue = s.enabled ? STATUS_TONE[s.status] : "gray";
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 text-[11px] font-medium", tone[hue].chip)}>
      <span className={cn("size-1.5 rounded-full", tone[hue].solid, s.status === "connecting" && "animate-pulse-soft motion-reduce:animate-none")} aria-hidden />
      {s.enabled ? t(`tools.status.${s.status}`) : t("tools.status.off")}
    </span>
  );
}

function ServerRow({
  s,
  onOpen,
  onToggle,
  onSync,
  onConnect,
  connecting,
  onEdit,
  onDelete,
}: {
  s: McpServer;
  onOpen: () => void;
  onToggle: (v: boolean) => void;
  onSync: () => void;
  onConnect: () => void;
  connecting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("agent");
  const on = s.tools.filter((x) => x.enabled).length;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-sunken focus-visible:bg-sunken md:grid md:grid-cols-[minmax(0,1fr)_140px_110px_auto] md:gap-4"
    >
      <div className={cn("flex min-w-0 flex-1 items-center gap-3", !s.enabled && "opacity-60")}>
        <IconTile tone={s.status === "error" ? "red" : s.status === "needs_auth" ? "amber" : "indigo"}>
          <Plug />
        </IconTile>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12.5px] font-medium text-fg">{s.name}</span>
            {s.server_info && (
              <span className="mono hidden truncate text-[11px] text-fg-4 sm:inline">
                {s.server_info.name} {s.server_info.version}
              </span>
            )}
          </div>
          <div className="mono truncate text-[11.5px] text-fg-3">{s.status === "error" && s.error ? <span className="font-sans text-danger-fg">{s.error}</span> : s.url}</div>
        </div>
      </div>
      <span className="hidden text-[11.5px] text-fg-3 md:block">
        {s.status === "needs_auth" ? (
          <span className="text-fg-4">{t("tools.toolsAfterConnectShort")}</span>
        ) : (
          <span className="mono tabular-nums">{t("tools.toolsOn", { on, total: s.tools.length })}</span>
        )}
      </span>
      <span>
        <StatusPill s={s} />
      </span>
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {s.status === "needs_auth" && (
          <Button size="xs" variant="primary" icon={<Link2 className="size-3" />} loading={connecting} onClick={onConnect}>
            {t("tools.connect")}
          </Button>
        )}
        <Switch checked={s.enabled} onCheckedChange={onToggle} aria-label={t("tools.enableServer", { name: s.name })} />
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={t("tools.actions", { name: s.name })}
              className="flex size-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<RefreshCw />} disabled={s.status === "connecting"} onSelect={onSync}>
              {t("tools.sync")}
            </MenuItem>
            <MenuItem icon={<Pencil />} onSelect={onEdit}>
              {t("tools.edit")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger icon={<Trash2 />} onSelect={onDelete}>
              {t("tools.delete")}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}

function ServerDrawer({
  server: s,
  onClose,
  onSync,
  syncing,
  onConnect,
  connecting,
  onEdit,
  onDelete,
}: {
  server: McpServer | null;
  onClose: () => void;
  onSync: () => void;
  syncing: boolean;
  onConnect: () => void;
  connecting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("agent");
  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: (v: { id: string; tool: string; patch: McpToolPatch }) => api.ai.mcp.update(v.id, { tools: { [v.tool]: v.patch } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.mcpServers });
      const prev = qc.getQueryData<McpServer[]>(qk.mcpServers);
      qc.setQueryData<McpServer[]>(qk.mcpServers, (rows) =>
        rows?.map((r) => (r.id === v.id ? { ...r, tools: r.tools.map((x) => (x.name === v.tool ? { ...x, ...v.patch } : x)) } : r)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.mcpServers, ctx.prev);
      toast.error(e, t("tools.updateError"));
    },
    onSuccess: (srv) => qc.setQueryData<McpServer[]>(qk.mcpServers, (rows) => rows?.map((r) => (r.id === srv.id ? srv : r))),
  });

  const authText = s
    ? s.auth.kind === "oauth"
      ? s.auth.oauth?.connected
        ? t("tools.authState.oauthOn")
        : t("tools.authState.oauthOff")
      : s.auth.kind === "none"
        ? t("tools.authState.none")
        : s.auth.kind === "bearer"
          ? t("tools.authState.bearer")
          : t("tools.authState.header", { name: s.auth.header_name ?? "" })
    : "";

  return (
    <Drawer
      open={!!s}
      onOpenChange={(o) => !o && onClose()}
      title={s?.name ?? t("tools.title")}
      width={640}
      header={
        s ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <IconTile size="sm" tone="indigo">
              <Plug />
            </IconTile>
            <span className="truncate text-sm font-medium">{s.name}</span>
            <StatusPill s={s} />
          </div>
        ) : null
      }
    >
      {s && (
        <div className="flex flex-col gap-5 px-5 py-4">
          {s.status === "needs_auth" && (
            <div className={cn("flex items-center gap-3 rounded-lg border px-3.5 py-3", tone.amber.soft, tone.amber.line)}>
              <KeyRound className="size-4 shrink-0 text-tone-amber" />
              <div className="min-w-0 flex-1 text-[12.5px] leading-[18px]">
                <div className="font-medium text-fg">{t("tools.needsAuth")}</div>
                <div className="text-fg-3">{t("tools.needsAuthBody")}</div>
              </div>
              <Button variant="primary" icon={<Link2 className="size-3.5" />} loading={connecting} onClick={onConnect}>
                {t("tools.connect")}
              </Button>
            </div>
          )}
          {s.status === "error" && s.error && (
            <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2.5 text-[12.5px]", tone.red.soft, tone.red.line)} role="alert">
              <AlertCircle className="mt-px size-3.5 shrink-0 text-tone-red" />
              <span className="text-fg">{s.error}</span>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-lg border border-line bg-sunken px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="mono min-w-0 flex-1 truncate text-[12px] text-fg-2">{s.url}</span>
              <Button size="xs" icon={<RefreshCw className={cn("size-3", (syncing || s.status === "connecting") && "animate-spin motion-reduce:animate-none")} />} disabled={syncing} onClick={onSync}>
                {t("tools.sync")}
              </Button>
              <Button size="xs" icon={<Pencil className="size-3" />} onClick={onEdit}>
                {t("tools.edit")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-fg-3">
              <span className="inline-flex items-center gap-1.5">
                <KeyRound className="size-3" />
                {authText}
                {(s.auth.kind === "bearer" || s.auth.kind === "header") && s.auth.has_secret && (
                  <span className={cn("inline-flex h-4 items-center rounded-xs px-1 text-[10px] font-medium", tone.green.chip)}>{t("tools.secretSet")}</span>
                )}
              </span>
              {s.server_info && (
                <span className="mono">
                  {s.server_info.name} {s.server_info.version}
                </span>
              )}
              {s.last_synced_at && (
                <Tooltip content={fullDate(s.last_synced_at)}>
                  <span>{t("tools.lastSynced", { when: relShort(s.last_synced_at) })}</span>
                </Tooltip>
              )}
            </div>
            {s.auth.kind === "oauth" && s.auth.oauth?.scopes.length ? (
              <div className="flex flex-wrap items-center gap-1">
                {s.auth.oauth.scopes.map((x) => (
                  <MonoChip key={x}>{x}</MonoChip>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2 pb-2">
              <span className="label-caps">{t("tools.toolsHeading")}</span>
              <span className="mono text-[10.5px] tabular-nums text-fg-4">{s.tools.length}</span>
            </div>
            {!s.tools.length ? (
              <div className="rounded-lg border border-line px-4 py-8 text-center text-[12.5px] text-fg-3">
                {s.status === "needs_auth" ? t("tools.toolsAfterConnect") : t("tools.noTools")}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {s.tools.map((tool) => (
                  <ToolCard key={tool.name} server={s} tool={tool} onPatch={(p) => patch.mutate({ id: s.id, tool: tool.name, patch: p })} />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-line-soft pt-4">
            <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
              {t("tools.deleteServer")}
            </Button>
            <p className="mt-2 text-xs text-fg-3">{t("tools.deleteHint")}</p>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function ToolCard({ server, tool, onPatch }: { server: McpServer; tool: McpTool; onPatch: (p: McpToolPatch) => void }) {
  const { t } = useTranslation("agent");
  const reduce = useReducedMotion();
  const [testing, setTesting] = useState(false);
  const [more, setMore] = useState(false);
  const long = tool.description.length > 180;
  return (
    <div className={cn("rounded-lg border border-line bg-surface transition-opacity", !tool.enabled && "bg-sunken")}>
      <div className="flex items-start gap-3 px-3.5 py-3">
        <div className={cn("min-w-0 flex-1", !tool.enabled && "opacity-70")}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] font-medium text-fg">{tool.title || tool.name}</span>
            {tool.title && <span className="mono text-[11px] text-fg-4">{tool.name}</span>}
            {tool.read_only ? (
              <span className={cn("inline-flex h-[18px] items-center gap-1 rounded-xs px-1.5 text-[10.5px] font-medium", tone.green.chip)}>
                <Eye className="size-2.5" />
                {t("tools.readOnly")}
              </span>
            ) : tool.destructive ? (
              <span className={cn("inline-flex h-[18px] items-center gap-1 rounded-xs px-1.5 text-[10.5px] font-medium", tone.red.chip)}>
                <ShieldAlert className="size-2.5" />
                {t("tools.destructive")}
              </span>
            ) : (
              <span className={cn("inline-flex h-[18px] items-center gap-1 rounded-xs px-1.5 text-[10.5px] font-medium", tone.amber.chip)}>
                <Pencil className="size-2.5" />
                {t("tools.writes")}
              </span>
            )}
          </div>
          {tool.description && (
            <p className={cn("mt-1 text-[12px] leading-[18px] text-fg-3", !more && long && "line-clamp-2")}>
              {tool.description}
              {long && (
                <button type="button" onClick={() => setMore((v) => !v)} className="ml-1 text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg">
                  {more ? t("tools.less") : t("tools.more")}
                </button>
              )}
            </p>
          )}
        </div>
        <Switch checked={tool.enabled} onCheckedChange={(enabled) => onPatch({ enabled })} aria-label={t("tools.enableTool", { name: tool.title || tool.name })} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft px-3.5 py-2">
        <Segmented<"auto" | "confirm">
          size="xs"
          value={tool.policy}
          onChange={(policy) => onPatch({ policy })}
          options={[
            { value: "auto", label: t("tools.policy.auto") },
            { value: "confirm", label: t("tools.policy.confirm") },
          ]}
        />
        <label className="flex items-center gap-2 text-[12px] text-fg-2">
          <Switch checked={tool.verified_only} onCheckedChange={(verified_only) => onPatch({ verified_only })} aria-label={t("tools.verifiedOnly")} />
          <Tooltip content={t("tools.verifiedOnlyHint")}>
            <span>{t("tools.verifiedOnly")}</span>
          </Tooltip>
        </label>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          aria-expanded={testing}
          icon={<Wrench className="size-3" />}
          iconRight={<ChevronDown className={cn("size-3 transition-transform duration-150", testing && "rotate-180")} />}
          onClick={() => setTesting((v) => !v)}
          disabled={server.status !== "connected"}
        >
          {t("tools.test.open")}
        </Button>
      </div>
      {!tool.read_only && tool.policy === "auto" && tool.enabled && (
        <p className="border-t border-line-soft px-3.5 py-1.5 text-[11.5px] text-tone-amber">{t("tools.autoWarning")}</p>
      )}
      <AnimatePresence initial={false}>
        {testing && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
            transition={springs.snap}
            className="overflow-hidden"
          >
            <div className="border-t border-line-soft p-3">
              <ToolTest server={server} tool={tool} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** opendesk is an MCP server too: AI clients connect with an API key. */
function ClientsCard() {
  const { t } = useTranslation("agent");
  return (
    <Section title={t("tools.clients.title")} description={t("tools.clients.description")}>
      <div className="flex flex-col gap-3 py-4">
        <CopyField value={mcpEndpoint()} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
          <Link to="/settings/api-keys" className="inline-flex items-center gap-1.5 text-fg-2 hover:text-fg">
            <KeyRound className="size-3.5 text-fg-3" />
            {t("tools.clients.keys")}
          </Link>
          <a href={DOCS} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-fg-2 hover:text-fg">
            <BookOpen className="size-3.5 text-fg-3" />
            {t("tools.clients.docs")}
            <ExternalLink className="size-3 text-fg-4" />
          </a>
        </div>
        <p className="text-xs text-fg-3">{t("tools.clients.scopes")}</p>
      </div>
    </Section>
  );
}
