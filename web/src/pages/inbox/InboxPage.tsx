import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { CircleCheck, CircleDashed, Clock, Inbox, Layers, ShieldAlert, User } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Ticket } from "@/lib/api/types";
import { folderById, listQuery, type FolderId, type InboxSearch } from "@/lib/folders";
import { q } from "@/lib/queries";
import { useHotkeys } from "@/lib/hotkeys";
import { realtime } from "@/lib/realtime/manager";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui/empty";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { TicketRow } from "@/components/tickets/TicketRow";
import { BulkBar } from "@/components/tickets/BulkBar";
import { ListToolbar } from "@/components/tickets/ListToolbar";
import { useDocumentTitle } from "@/app/RootLayout";
import { shell } from "@/app/shellStore";
import { useQueryClient } from "@tanstack/react-query";

const TicketDetail = lazy(() => import("@/components/tickets/detail/TicketDetail"));

const folderIcon: Record<FolderId, ReactNode> = {
  unassigned: <CircleDashed />,
  mine: <User />,
  open: <Inbox />,
  pending: <Clock />,
  solved: <CircleCheck />,
  spam: <ShieldAlert />,
};

const emptyCopy: Record<FolderId | "view", { title: string; description: string; lit: 0 | 1 | 2 | 3 }> = {
  unassigned: { title: "Nothing waiting for an owner", description: "New conversations land here until someone picks them up.", lit: 1 },
  mine: { title: "You're all caught up", description: "Tickets assigned to you show up here.", lit: 0 },
  open: { title: "No open tickets", description: "When customers write in, their conversations appear here.", lit: 2 },
  pending: { title: "Nothing pending", description: "Tickets waiting on the customer or on hold collect here.", lit: 3 },
  solved: { title: "No solved tickets yet", description: "Solved conversations are kept here for reference.", lit: 0 },
  spam: { title: "No spam", description: "Messages marked as spam are kept here, out of the way.", lit: 3 },
  view: { title: "Nothing matches this view", description: "Tickets that match the view's filters appear here.", lit: 1 },
};

export default function InboxPage() {
  const params = useParams({ strict: false }) as { folder?: string; viewId?: string; ticketId?: string };
  const search = useSearch({ strict: false }) as InboxSearch;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: views } = useQuery(q.views());
  const { data: counts } = useQuery(q.counts());

  const folder = params.folder ? folderById(params.folder) : undefined;
  const view = params.viewId ? views?.find((v) => v.id === params.viewId) : undefined;
  const base = folder ? folder.query : { view_id: params.viewId };
  const query = useMemo(() => listQuery(base, search), [JSON.stringify(base), JSON.stringify(search)]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = folder?.label ?? view?.name ?? "View";
  const count = folder ? (counts ? folder.count(counts) : null) : params.viewId ? counts?.views?.[params.viewId] : null;
  useDocumentTitle(params.ticketId ? null : title);

  const list = useInfiniteQuery(q.tickets(query));
  const tickets = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const openId = params.ticketId;
  const compact = !!openId;

  // ── Selection and keyboard focus ────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(0);
  const lastToggled = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelected(new Set());
    setFocusIdx(0);
  }, [params.folder, params.viewId]);

  // Drop selections that left the list (solved elsewhere, deleted).
  useEffect(() => {
    setSelected((s) => {
      if (!s.size) return s;
      const ids = new Set(tickets.map((t) => t.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [tickets]);

  // Keep the focus marker on the open ticket.
  useEffect(() => {
    if (!openId) return;
    const i = tickets.findIndex((t) => t.id === openId || String(t.number) === openId);
    if (i >= 0) setFocusIdx(i);
  }, [openId, tickets]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-ticket-id="${tickets[focusIdx]?.id}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIdx, tickets]);

  // Teammates' presence on the visible rows.
  useEffect(() => {
    realtime()?.setWatched(tickets.slice(0, 30).map((t) => t.id));
  }, [tickets]);
  useEffect(() => () => realtime()?.setWatched([]), []);

  const open = useCallback(
    (t: Ticket | undefined) => {
      if (!t) return;
      if (params.viewId)
        void navigate({ to: "/views/$viewId/{-$ticketId}", params: { viewId: params.viewId, ticketId: t.id }, search: (s) => s });
      else void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: params.folder!, ticketId: t.id }, search: (s) => s });
    },
    [navigate, params.folder, params.viewId],
  );

  const close = useCallback(() => {
    if (params.viewId) void navigate({ to: "/views/$viewId/{-$ticketId}", params: { viewId: params.viewId, ticketId: undefined }, search: (s) => s });
    else void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: params.folder!, ticketId: undefined }, search: (s) => s });
  }, [navigate, params.folder, params.viewId]);

  const setSearch = (s: InboxSearch) => {
    const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== ""));
    if (params.viewId) void navigate({ to: "/views/$viewId/{-$ticketId}", params: { viewId: params.viewId, ticketId: params.ticketId }, search: clean, replace: true });
    else void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: params.folder!, ticketId: params.ticketId }, search: clean, replace: true });
  };

  const toggle = useCallback(
    (t: Ticket, shift: boolean) => {
      setSelected((s) => {
        const next = new Set(s);
        if (shift && lastToggled.current) {
          const a = tickets.findIndex((x) => x.id === lastToggled.current);
          const b = tickets.findIndex((x) => x.id === t.id);
          if (a >= 0 && b >= 0) {
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(tickets[i].id);
            return next;
          }
        }
        if (next.has(t.id)) next.delete(t.id);
        else next.add(t.id);
        lastToggled.current = t.id;
        return next;
      });
    },
    [tickets],
  );

  const move = (d: 1 | -1) => {
    const i = Math.max(0, Math.min(tickets.length - 1, focusIdx + d));
    setFocusIdx(i);
    if (openId) open(tickets[i]);
    if (d === 1 && i >= tickets.length - 5 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  };

  useHotkeys({
    j: () => move(1),
    arrowdown: () => !openId && move(1),
    k: () => move(-1),
    arrowup: () => !openId && move(-1),
    enter: () => !openId && open(tickets[focusIdx]),
    o: () => open(tickets[focusIdx]),
    x: () => tickets[focusIdx] && toggle(tickets[focusIdx], false),
    "/": () => {
      searchRef.current?.focus();
      if (!searchRef.current) (document.querySelector('[aria-label="Search"]') as HTMLButtonElement | null)?.click();
    },
    escape: () => {
      if (selected.size) setSelected(new Set());
      else if (openId) close();
    },
    "mod+a": () => !openId && setSelected(new Set(tickets.map((t) => t.id))),
  });

  // Infinite scroll.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  const prefetch = useCallback(
    (t: Ticket) => {
      void qc.prefetchQuery(q.messages(t.id));
      void qc.prefetchQuery(q.activities(t.id));
    },
    [qc],
  );

  const empty = emptyCopy[folder?.id ?? "view"];
  const selecting = selected.size > 0;
  const idx = tickets.findIndex((t) => t.id === openId || String(t.number) === openId);

  return (
    <div className="relative flex h-full min-h-0">
      <section
        aria-label={title}
        className={cn(
          "relative flex min-h-0 flex-col",
          compact ? "hidden w-[340px] shrink-0 border-r border-line lg:flex xl:w-[380px]" : "min-w-0 flex-1",
        )}
      >
        <ListToolbar
          title={title}
          icon={folder ? folderIcon[folder.id] : <Layers />}
          count={count}
          search={search}
          onSearch={setSearch}
          searchRef={searchRef}
          compact={compact}
        />
        <div ref={listRef} role="listbox" aria-label="Tickets" aria-multiselectable className="min-h-0 flex-1 overflow-y-auto">
          {list.isPending ? (
            <SkeletonRows rows={compact ? 7 : 12} />
          ) : list.isError ? (
            <EmptyState lit={3} title="Couldn't load tickets" description="Check your connection and try again." action={<Button onClick={() => void list.refetch()}>Retry</Button>} />
          ) : !tickets.length ? (
            search.q || search.priority || search.channel || search.tag || search.mailbox ? (
              <EmptyState
                lit={2}
                title="No tickets match"
                description="Try a different search or clear the filters."
                action={<Button onClick={() => setSearch({ sort: search.sort, order: search.order })}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                lit={empty.lit}
                title={empty.title}
                description={empty.description}
                action={
                  folder?.id === "unassigned" || folder?.id === "open" ? (
                    <Button onClick={() => shell.newTicket()}>New ticket</Button>
                  ) : folder?.id === "mine" || folder?.id === "pending" ? (
                    <Button
                      onClick={() =>
                        void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: undefined } })
                      }
                    >
                      Go to Unassigned
                    </Button>
                  ) : !folder ? (
                    <Button onClick={() => void navigate({ to: "/settings/views" })}>Edit views</Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <>
              {tickets.map((t, i) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  active={t.id === openId || String(t.number) === openId}
                  focused={i === focusIdx}
                  selected={selected.has(t.id)}
                  selecting={selecting}
                  compact={compact}
                  onOpen={open}
                  onToggle={toggle}
                  onHover={prefetch}
                />
              ))}
              <div ref={sentinel} className="flex h-14 items-center justify-center">
                {list.isFetchingNextPage && <Spinner className="size-4 text-fg-4" />}
              </div>
            </>
          )}
        </div>
        <BulkBar ids={[...selected]} onClear={() => setSelected(new Set())} spamView={folder?.id === "spam"} />
      </section>

      {openId && (
        <section aria-label="Ticket" className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={null}>
            <TicketDetail
              key={openId}
              ticketId={openId}
              onClose={close}
              onPrev={idx > 0 ? () => open(tickets[idx - 1]) : undefined}
              onNext={idx >= 0 && idx < tickets.length - 1 ? () => open(tickets[idx + 1]) : undefined}
              position={idx >= 0 ? { index: idx + 1, total: count ?? tickets.length } : undefined}
            />
          </Suspense>
        </section>
      )}
    </div>
  );
}
