import { useQuery } from "@tanstack/react-query";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Filter, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Menu, MenuCheckItem, MenuContent, MenuLabel, MenuSeparator, MenuSub, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import type { Channel, Priority } from "@/lib/api/types";
import type { InboxSearch } from "@/lib/folders";
import { q } from "@/lib/queries";
import { cn } from "@/lib/cn";
import { ChannelIcon, PriorityIcon, channelLabel, priorityLabel, priorityOrder } from "./bits";

const sorts = [
  { value: "last_message_at", label: "Last activity" },
  { value: "created_at", label: "Created" },
  { value: "priority", label: "Priority" },
  { value: "due", label: "SLA due" },
] as const;

function Chip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface pl-2 pr-0.5 text-xs text-fg-2 [&_svg]:size-3">
      {children}
      <button type="button" aria-label="Remove filter" onClick={onRemove} className="flex size-5 items-center justify-center rounded text-fg-4 hover:bg-hover hover:text-fg">
        <X />
      </button>
    </span>
  );
}

export function ListToolbar({
  title,
  icon,
  count,
  search,
  onSearch,
  searchRef,
  compact,
}: {
  title: string;
  icon: ReactNode;
  count?: number | null;
  search: InboxSearch;
  onSearch: (s: InboxSearch) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  compact: boolean;
}) {
  const { data: tags } = useQuery(q.tags());
  const { data: mailboxes } = useQuery(q.mailboxes());
  const [term, setTerm] = useState(search.q ?? "");
  const [searchOpen, setSearchOpen] = useState(!!search.q);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => onSearch({ ...search, q: term.trim() || undefined }), 250);
    return () => clearTimeout(t);
    // Only the typed term drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen, searchRef]);

  const priorities = (search.priority?.split(",") ?? []) as Priority[];
  const sort = search.sort ?? "last_message_at";
  const order = search.order ?? (sort === "due" ? "asc" : "desc");
  const togglePriority = (p: Priority) => {
    const next = priorities.includes(p) ? priorities.filter((x) => x !== p) : [...priorities, p];
    onSearch({ ...search, priority: next.length ? next.join(",") : undefined });
  };
  const activeFilters = priorities.length + (search.channel ? 1 : 0) + (search.tag ? 1 : 0) + (search.mailbox ? 1 : 0);

  return (
    <div className="shrink-0 border-b border-line">
      <div className="flex h-12 items-center gap-2 px-3">
        <span className="flex text-fg-3 [&_svg]:size-4">{icon}</span>
        {searchOpen ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              ref={searchRef}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setTerm("");
                  setSearchOpen(false);
                  onSearch({ ...search, q: undefined });
                }
                if (e.key === "ArrowDown" || e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder={`Search ${title.toLowerCase()}`}
              aria-label="Search tickets"
              className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-4"
            />
            <button
              type="button"
              aria-label="Close search"
              onClick={() => {
                setTerm("");
                setSearchOpen(false);
                onSearch({ ...search, q: undefined });
              }}
              className="flex size-6 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <h1 className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{title}</h1>
            {count !== null && count !== undefined && <span className="mono text-[11.5px] text-fg-4 tabular-nums">{count}</span>}
          </div>
        )}
        {!searchOpen && (
          <Tooltip content="Search" shortcut="/">
            <Button variant="ghost" size="sm" square aria-label="Search" icon={<Search className="size-3.5" />} onClick={() => setSearchOpen(true)} />
          </Tooltip>
        )}
        <Menu>
          <Tooltip content="Filter">
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" square={compact || !activeFilters} aria-label="Filter" icon={<Filter className="size-3.5" />} className={cn(activeFilters > 0 && "text-fg")}>
                {!compact && activeFilters > 0 ? <span className="mono text-[11px]">{activeFilters}</span> : null}
              </Button>
            </MenuTrigger>
          </Tooltip>
          <MenuContent align="end" className="w-[200px]">
            <MenuSub label="Priority">
              {priorityOrder.map((p) => (
                <MenuCheckItem key={p} checked={priorities.includes(p)} onSelect={() => togglePriority(p)} icon={<PriorityIcon priority={p} />}>
                  {priorityLabel[p]}
                </MenuCheckItem>
              ))}
            </MenuSub>
            <MenuSub label="Channel">
              {(["email", "chat", "api", "portal"] as Channel[]).map((c) => (
                <MenuCheckItem
                  key={c}
                  checked={search.channel === c}
                  onSelect={() => onSearch({ ...search, channel: search.channel === c ? undefined : c })}
                  icon={<ChannelIcon channel={c} />}
                >
                  {channelLabel[c]}
                </MenuCheckItem>
              ))}
            </MenuSub>
            <MenuSub label="Tag">
              <div className="max-h-[260px] overflow-y-auto">
                {(tags ?? []).map((t) => (
                  <MenuCheckItem key={t.id} checked={search.tag === t.name} onSelect={() => onSearch({ ...search, tag: search.tag === t.name ? undefined : t.name })}>
                    {t.name}
                  </MenuCheckItem>
                ))}
              </div>
            </MenuSub>
            {!!mailboxes?.length && (
              <MenuSub label="Mailbox">
                {mailboxes.map((m) => (
                  <MenuCheckItem key={m.id} checked={search.mailbox === m.id} onSelect={() => onSearch({ ...search, mailbox: search.mailbox === m.id ? undefined : m.id })}>
                    {m.name}
                  </MenuCheckItem>
                ))}
              </MenuSub>
            )}
            {activeFilters > 0 && (
              <>
                <MenuSeparator />
                <MenuCheckItem checked={false} onSelect={() => onSearch({ sort: search.sort, order: search.order, q: search.q })}>
                  Clear filters
                </MenuCheckItem>
              </>
            )}
          </MenuContent>
        </Menu>
        <Menu>
          <Tooltip content="Sort">
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" square aria-label="Sort" icon={order === "asc" ? <ArrowUpNarrowWide className="size-3.5" /> : <ArrowDownWideNarrow className="size-3.5" />} />
            </MenuTrigger>
          </Tooltip>
          <MenuContent align="end" className="w-[190px]">
            <MenuLabel>Sort by</MenuLabel>
            {sorts.map((s) => (
              <MenuCheckItem key={s.value} checked={sort === s.value} onSelect={() => onSearch({ ...search, sort: s.value === "last_message_at" ? undefined : s.value, order: undefined })}>
                {s.label}
              </MenuCheckItem>
            ))}
            <MenuSeparator />
            <MenuCheckItem checked={order === "desc"} onSelect={() => onSearch({ ...search, order: "desc" })}>
              {sort === "due" ? "Latest first" : "Newest first"}
            </MenuCheckItem>
            <MenuCheckItem checked={order === "asc"} onSelect={() => onSearch({ ...search, order: "asc" })}>
              {sort === "due" ? "Soonest first" : "Oldest first"}
            </MenuCheckItem>
          </MenuContent>
        </Menu>
      </div>
      {activeFilters > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-2.5">
          {priorities.map((p) => (
            <Chip key={p} onRemove={() => togglePriority(p)}>
              <PriorityIcon priority={p} />
              {priorityLabel[p]}
            </Chip>
          ))}
          {search.channel && (
            <Chip onRemove={() => onSearch({ ...search, channel: undefined })}>
              <ChannelIcon channel={search.channel as Channel} />
              {channelLabel[search.channel as Channel] ?? search.channel}
            </Chip>
          )}
          {search.tag && <Chip onRemove={() => onSearch({ ...search, tag: undefined })}>Tag: {search.tag}</Chip>}
          {search.mailbox && (
            <Chip onRemove={() => onSearch({ ...search, mailbox: undefined })}>{mailboxes?.find((m) => m.id === search.mailbox)?.name ?? "Mailbox"}</Chip>
          )}
        </div>
      )}
    </div>
  );
}
