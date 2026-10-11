import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  CircleDashed,
  FileText,
  Inbox,
  Keyboard,
  Layers,
  Moon,
  Search,
  Settings,
  SquarePen,
  Sun,
  User,
  Users,
} from "lucide-react";
import { useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { StatusIcon } from "@/components/tickets/bits";
import { folders } from "@/lib/folders";
import { relShort } from "@/lib/format";
import { q } from "@/lib/queries";
import { selectWorkspace, useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { shell, usePageCommands, useShell } from "./shellStore";
import { useTranslation } from "react-i18next";
import { AiIcon } from "@/components/ai/bits";
import { useDebounced } from "@/components/contacts/hooks";
import { useAI } from "@/lib/ai";
import type { SearchResults } from "@/lib/api/types";

const itemCls =
  "flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg data-[selected=true]:bg-hover [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-3";
const groupCls =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-3";

function Item({ children, onSelect, icon, hint, value, keywords, forceMount }: { children: ReactNode; onSelect: () => void; icon?: ReactNode; hint?: ReactNode; value: string; keywords?: string[]; forceMount?: boolean }) {
  return (
    <Command.Item value={value} keywords={keywords} onSelect={onSelect} forceMount={forceMount} className={itemCls}>
      {icon}
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
      {hint && <span className="shrink-0 text-xs text-fg-4">{hint}</span>}
    </Command.Item>
  );
}

export function CommandPalette() {
  const open = useShell((s) => s.paletteOpen);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: views } = useQuery(q.views());
  const search = useQuery({ ...q.search(deferred), enabled: open && deferred.length > 1 });
  const pageCommands = usePageCommands((s) => s.commands);
  const memberships = useSession((s) => s.memberships);
  const workspaceId = useSession((s) => s.workspaceId);
  const { dark, setTheme } = useTheme();
  const ai = useAI();
  const { t } = useTranslation("ai");
  const [aiMode, setAiMode] = useState(false);
  const aiQuery = useDebounced(query.trim(), 300);
  const aiSearch = useQuery({ ...q.aiSearch(aiQuery), enabled: open && aiMode && ai.enabled && aiQuery.length > 1 });

  useEffect(() => {
    if (!open) {
      setQuery("");
      setAiMode(false);
    }
  }, [open]);

  const go = (fn: () => void) => {
    shell.palette(false);
    fn();
  };

  const results = search.data;
  const hasResults = !!results && (results.tickets.length + results.contacts.length + results.articles.length > 0);

  return (
    <D.Root open={open} onOpenChange={(o) => shell.palette(o)}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-scrim/70 data-[state=open]:animate-fade-in" />
        <D.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-raised shadow-float outline-none data-[state=open]:animate-pop-in"
        >
          <D.Title className="sr-only">Command menu</D.Title>
          <Command loop shouldFilter={!aiMode} className="flex flex-col">
            <div className="flex h-12 items-center gap-2.5 border-b border-line px-4">
              {aiMode ? (
                <button
                  type="button"
                  onClick={() => setAiMode(false)}
                  aria-label={t("palette.exit")}
                  className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border border-line bg-sunken px-1.5 text-[12px] font-medium text-fg-2 hover:text-fg"
                >
                  <AiIcon className="size-3" />
                  {t("palette.mode")}
                </button>
              ) : (
                <Search className="size-4 shrink-0 text-fg-3" />
              )}
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                onKeyDown={(e) => {
                  if (e.key === "Tab" && !e.shiftKey && ai.enabled) {
                    e.preventDefault();
                    setAiMode((m) => !m);
                  } else if (e.key === "Backspace" && aiMode && !query) {
                    e.preventDefault();
                    setAiMode(false);
                  }
                }}
                placeholder={aiMode ? t("palette.placeholder") : "Search tickets, contacts, articles, or type a command"}
                className="h-full flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-4"
              />
              {(aiMode ? aiSearch.isFetching : search.isFetching) && <Spinner className="size-3.5 text-fg-4" />}
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
              {aiMode ? (
                <AiResults
                  query={aiQuery}
                  pending={query.trim() !== aiQuery || aiSearch.isFetching}
                  data={aiSearch.data}
                  error={!!aiSearch.error}
                  onTicket={(id) => go(() => void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "open", ticketId: id } }))}
                  onArticle={(id) => go(() => void navigate({ to: "/kb/articles/$articleId", params: { articleId: id }, search: { collection: undefined } }))}
                />
              ) : (
              <>
              {ai.enabled && query.trim().length > 2 && (
                <Command.Group forceMount className={groupCls}>
                  <Item forceMount value={`ask ai ${query}`} icon={<AiIcon className="text-fg-3" />} hint={<Kbd>tab</Kbd>} onSelect={() => setAiMode(true)}>
                    <span className="truncate">{t("palette.ask_item", { query: query.trim() })}</span>
                  </Item>
                </Command.Group>
              )}
              {!(ai.enabled && query.trim().length > 2) && (
                <Command.Empty>
                  {deferred.length > 1 && search.isFetching ? (
                    <p className="py-10 text-center text-[13px] text-fg-3">Searching</p>
                  ) : (
                    <EmptyState compact lit={2} title="No results" description="Try another word, a ticket number or an email." />
                  )}
                </Command.Empty>
              )}

              {hasResults && results.tickets.length > 0 && (
                <Command.Group heading="Tickets" forceMount className={groupCls}>
                  {results.tickets.map((t) => (
                    <Item
                      forceMount
                      key={t.id}
                      value={`ticket ${t.number} ${t.subject} ${t.contact?.name ?? ""} ${t.id}`}
                      icon={<StatusIcon status={t.status} />}
                      hint={<span className="mono">{relShort(t.last_message_at)}</span>}
                      onSelect={() =>
                        go(() => void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "open", ticketId: t.id } }))
                      }
                    >
                      <span className="mono shrink-0 text-xs text-fg-3">#{t.number}</span>
                      <span className="truncate" data-ph-mask>
                        {t.subject}
                      </span>
                      {t.contact && <span className="shrink-0 truncate text-xs text-fg-3">{t.contact.name}</span>}
                    </Item>
                  ))}
                </Command.Group>
              )}
              {hasResults && results.contacts.length > 0 && (
                <Command.Group heading="Contacts" forceMount className={groupCls}>
                  {results.contacts.map((c) => (
                    <Item
                      forceMount
                      key={c.id}
                      value={`contact ${c.name} ${c.email ?? ""} ${c.id}`}
                      icon={<Avatar name={c.name || c.email || "?"} src={c.avatar_url} size="sm" />}
                      hint={c.company?.name}
                      onSelect={() => go(() => void navigate({ to: "/contacts/{-$contactId}", params: { contactId: c.id } }))}
                    >
                      <span className="truncate" data-ph-mask>
                        {c.name}
                      </span>
                      <span className="truncate text-xs text-fg-3" data-ph-mask>
                        {c.email}
                      </span>
                    </Item>
                  ))}
                </Command.Group>
              )}
              {hasResults && results.articles.length > 0 && (
                <Command.Group heading="Articles" forceMount className={groupCls}>
                  {results.articles.map((a) => (
                    <Item
                      forceMount
                      key={a.id}
                      value={`article ${a.title} ${a.id}`}
                      icon={<FileText />}
                      hint={a.status === "draft" ? "Draft" : undefined}
                      onSelect={() => go(() => void navigate({ to: "/kb/articles/$articleId", params: { articleId: a.id }, search: { collection: undefined } }))}
                    >
                      {a.title}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {pageCommands.length > 0 && (
                <Command.Group heading="This ticket" className={groupCls}>
                  {pageCommands.map((c) => (
                    <Item key={c.id} value={`${c.label} ${c.id}`} icon={c.icon} hint={c.shortcut && <Kbd>{c.shortcut}</Kbd>} onSelect={() => go(c.run)}>
                      {c.label}
                    </Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Go to" className={groupCls}>
                {folders.map((f) => (
                  <Item
                    key={f.id}
                    value={`go inbox ${f.label}`}
                    icon={f.id === "unassigned" ? <CircleDashed /> : f.id === "mine" ? <User /> : <Inbox />}
                    onSelect={() => go(() => void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: f.id, ticketId: undefined } }))}
                  >
                    {f.label}
                  </Item>
                ))}
                {views?.map((v) => (
                  <Item
                    key={v.id}
                    value={`go view ${v.name}`}
                    icon={<Layers />}
                    hint="View"
                    onSelect={() => go(() => void navigate({ to: "/views/$viewId/{-$ticketId}", params: { viewId: v.id, ticketId: undefined } }))}
                  >
                    {v.name}
                  </Item>
                ))}
                <Item value="go contacts" icon={<Users />} onSelect={() => go(() => void navigate({ to: "/contacts/{-$contactId}", params: { contactId: undefined } }))}>
                  Contacts
                </Item>
                <Item value="go companies" icon={<Building2 />} onSelect={() => go(() => void navigate({ to: "/companies/{-$companyId}", params: { companyId: undefined } }))}>
                  Companies
                </Item>
                <Item value="go knowledge base kb articles" icon={<BookOpen />} onSelect={() => go(() => void navigate({ to: "/kb" }))}>
                  Knowledge base
                </Item>
                <Item value="go reports analytics" icon={<BarChart3 />} onSelect={() => go(() => void navigate({ to: "/reports" }))}>
                  Reports
                </Item>
                {(
                  [
                    ["/settings/profile", "Profile"],
                    ["/settings/security", "Security"],
                    ["/settings/workspace", "Workspace settings"],
                    ["/settings/members", "Members"],
                    ["/settings/teams", "Teams"],
                    ["/settings/mailboxes", "Mailboxes"],
                    ["/settings/tags", "Tags"],
                    ["/settings/saved-replies", "Saved replies"],
                    ["/settings/views", "Views"],
                    ["/settings/sla", "SLA policies"],
                    ["/settings/automations", "Automations"],
                    ["/settings/ai", "AI settings"],
                    ["/settings/widget", "Chat widget"],
                    ["/settings/api-keys", "API keys"],
                    ["/settings/webhooks", "Webhooks"],
                    ["/settings/audit-log", "Audit log"],
                  ] as const
                ).map(([to, label]) => (
                  <Item key={to} value={`settings ${label}`} icon={<Settings />} hint="Settings" onSelect={() => go(() => void navigate({ to }))}>
                    {label}
                  </Item>
                ))}
              </Command.Group>

              <Command.Group heading="Actions" className={groupCls}>
                <Item value="new ticket compose create" icon={<SquarePen />} hint={<Kbd>c</Kbd>} onSelect={() => go(() => shell.newTicket())}>
                  New ticket
                </Item>
                <Item value="toggle theme dark light mode" icon={dark ? <Sun /> : <Moon />} onSelect={() => go(() => setTheme(dark ? "light" : "dark"))}>
                  Switch to {dark ? "light" : "dark"} theme
                </Item>
                <Item value="keyboard shortcuts help" icon={<Keyboard />} hint={<Kbd>?</Kbd>} onSelect={() => go(() => shell.shortcuts())}>
                  Keyboard shortcuts
                </Item>
                {memberships
                  .filter((m) => m.workspace.id !== workspaceId)
                  .map((m) => (
                    <Item
                      key={m.workspace.id}
                      value={`switch workspace ${m.workspace.name}`}
                      icon={<ArrowRight />}
                      onSelect={() =>
                        go(() => {
                          selectWorkspace(m.workspace.id);
                          qc.clear();
                          void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: undefined } });
                        })
                      }
                    >
                      Switch to {m.workspace.name}
                    </Item>
                  ))}
              </Command.Group>
              {ai.enabled && (
                <Command.Group heading={t("palette.ask")} className={groupCls}>
                  <Item value="ask ai semantic search meaning" icon={<AiIcon />} hint={<Kbd>tab</Kbd>} onSelect={() => setAiMode(true)}>
                    {t("palette.ask_hint")}
                  </Item>
                </Command.Group>
              )}
              </>
              )}
            </Command.List>
            <div className="flex h-9 items-center gap-4 border-t border-line px-4 text-[11.5px] text-fg-4">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> to move
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>enter</Kbd> to open
              </span>
              {ai.enabled && (
                <span className="ml-auto flex items-center gap-1.5">
                  <Kbd>tab</Kbd> {aiMode ? t("palette.exit") : t("palette.ask")}
                </span>
              )}
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Semantic results (GET /v1/ai/search): tickets and articles related by meaning. */
function AiResults({
  query,
  pending,
  data,
  error,
  onTicket,
  onArticle,
}: {
  query: string;
  pending: boolean;
  data: SearchResults | undefined;
  error: boolean;
  onTicket: (id: string) => void;
  onArticle: (id: string) => void;
}) {
  const { t } = useTranslation("ai");
  if (query.length < 2)
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <span className="flex size-8 items-center justify-center rounded-md border border-line text-fg-3">
          <AiIcon className="size-4" />
        </span>
        <p className="text-[13px] text-fg-3">{t("palette.start")}</p>
      </div>
    );
  if (!data && pending)
    return (
      <div className="flex flex-col gap-1 p-1" aria-live="polite" aria-label={t("palette.searching")}>
        <div className="px-1.5 pb-1.5 pt-2 text-[11.5px] font-medium text-fg-3">{t("palette.searching")}</div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-9 items-center gap-2.5 px-2.5">
            <span className="skeleton size-4 rounded-[3px]" />
            <span className="skeleton h-2.5" style={{ width: `${62 - i * 14}%` }} />
          </div>
        ))}
      </div>
    );
  const tickets = data?.tickets ?? [];
  const articles = data?.articles ?? [];
  if (error || (!tickets.length && !articles.length))
    return <p className="px-6 py-10 text-center text-[13px] text-fg-3">{error ? t("palette.error") : t("palette.empty")}</p>;
  const heading = (label: string) => (
    <span className="flex items-center gap-1.5">
      <AiIcon className="size-3" />
      {label}
    </span>
  );
  return (
    <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
      {tickets.length > 0 && (
        <Command.Group heading={heading(t("palette.tickets"))} className={groupCls}>
          {tickets.map((x) => (
            <Item
              key={x.id}
              value={`ai ticket ${x.id}`}
              icon={<StatusIcon status={x.status} />}
              hint={<span className="mono">{relShort(x.last_message_at)}</span>}
              onSelect={() => onTicket(x.id)}
            >
              <span className="mono shrink-0 text-xs text-fg-3">#{x.number}</span>
              <span className="truncate" data-ph-mask>
                {x.subject}
              </span>
              {x.contact && <span className="shrink-0 truncate text-xs text-fg-3">{x.contact.name}</span>}
            </Item>
          ))}
        </Command.Group>
      )}
      {articles.length > 0 && (
        <Command.Group heading={heading(t("palette.articles"))} className={groupCls}>
          {articles.map((a) => (
            <Item key={a.id} value={`ai article ${a.id}`} icon={<FileText />} hint={a.status === "draft" ? "Draft" : undefined} onSelect={() => onArticle(a.id)}>
              <span className="truncate">{a.title}</span>
              {a.excerpt && <span className="hidden min-w-0 truncate text-xs text-fg-3 sm:inline">{a.excerpt}</span>}
            </Item>
          ))}
        </Command.Group>
      )}
    </div>
  );
}
