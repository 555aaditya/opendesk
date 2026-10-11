import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { BookOpen, ExternalLink, Folder, FolderPlus, Library, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Field, SearchInput, Textarea, TextInput } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/tabs";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { useDebounced } from "@/components/contacts/hooks";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { KbCollection } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { compact, relShort } from "@/lib/format";
import { q, qk, removeFromList, upsertInList } from "@/lib/queries";
import { atLeast, useRole, useWorkspace } from "@/lib/session";
import { useAI } from "@/lib/ai";
import { useTranslation } from "react-i18next";
import { AiIcon, AiTooltip } from "@/components/ai/bits";
import { requestKbDraft } from "@/components/ai/kbDraftIntent";

const route = getRouteApi("/app/kb");

type StatusFilter = "all" | "published" | "draft";

export default function KbPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const ws = useWorkspace();
  const role = useRole();
  const canEdit = atLeast(role, "agent");
  const [term, setTerm] = useState(search.q ?? "");
  const debounced = useDebounced(term, 250);
  const [editing, setEditing] = useState<KbCollection | "new" | null>(null);

  useEffect(() => {
    if ((debounced || undefined) === search.q) return;
    void navigate({ search: (s) => ({ ...s, q: debounced || undefined }), replace: true });
  }, [debounced, search.q, navigate]);

  const collections = useQuery(q.kbCollections());
  const articles = useQuery(q.kbArticles({ collection_id: search.collection, status: search.status, q: search.q }));
  const sorted = [...(collections.data ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const current = sorted.find((c) => c.id === search.collection);
  const total = sorted.reduce((n, c) => n + c.article_count, 0);
  const collectionName = (id: string | null) => sorted.find((c) => c.id === id)?.name;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Knowledge base"
        icon={<BookOpen />}
        actions={
          <>
            {ws?.settings.help_center_enabled && (
              <Button asChild variant="ghost" size="sm">
                <a href={`/help/${ws.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                  View help center
                </a>
              </Button>
            )}
            {canEdit && <DraftFromTicketsLink collection={search.collection} />}
            {canEdit && (
              <Button asChild variant="primary">
                <Link to="/kb/articles/$articleId" params={{ articleId: "new" }} search={{ collection: search.collection }}>
                  <Plus className="size-3.5" />
                  New article
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[232px] shrink-0 flex-col border-r border-line md:flex">
          <div className="flex h-10 items-center justify-between px-3">
            <span className="text-[11.5px] font-medium text-fg-3">Collections</span>
            {canEdit && (
              <button
                type="button"
                aria-label="New collection"
                onClick={() => setEditing("new")}
                className="flex size-6 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
              >
                <FolderPlus className="size-3.5" />
              </button>
            )}
          </div>
          <nav aria-label="Collections" className="flex-1 overflow-y-auto px-2 pb-3">
            <CollectionLink active={!search.collection} label="All articles" count={total} icon={<Library />} collection={undefined} />
            {collections.isLoading ? (
              <div className="flex flex-col gap-2.5 px-2 pt-2">
                <Skeleton className="h-2.5 w-3/4" />
                <Skeleton className="h-2.5 w-2/3" />
                <Skeleton className="h-2.5 w-4/5" />
              </div>
            ) : (
              sorted.map((c) => (
                <div key={c.id} className="group/c relative">
                  <CollectionLink active={search.collection === c.id} label={c.name} count={c.article_count} icon={<Folder />} collection={c.id} />
                  {canEdit && <CollectionMenu c={c} onRename={() => setEditing(c)} onDeleted={() => search.collection === c.id && void navigate({ search: (s) => ({ ...s, collection: undefined }) })} />}
                </div>
              ))
            )}
            {!collections.isLoading && sorted.length === 0 && canEdit && (
              <button
                type="button"
                onClick={() => setEditing("new")}
                className="mt-2 flex w-full items-center gap-2 rounded-md border border-dashed border-line px-2.5 py-2 text-left text-xs text-fg-3 hover:border-line-strong hover:text-fg-2"
              >
                <FolderPlus className="size-3.5" />
                Group articles into collections
              </button>
            )}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line-soft px-4">
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-medium">{current?.name ?? "All articles"}</h2>
            </div>
            {current?.description && <p className="hidden truncate text-xs text-fg-3 lg:block">{current.description}</p>}
            <div className="ml-auto flex items-center gap-2">
              <Segmented<StatusFilter>
                size="xs"
                value={search.status ?? "all"}
                onChange={(v) => void navigate({ search: (s) => ({ ...s, status: v === "all" ? undefined : v }) })}
                options={[
                  { value: "all", label: "All" },
                  { value: "published", label: "Published" },
                  { value: "draft", label: "Drafts" },
                ]}
              />
              <div className="w-[220px]">
                <SearchInput value={term} onChange={setTerm} placeholder="Search articles" />
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {articles.isLoading ? (
              <SkeletonRows rows={7} />
            ) : !articles.data?.length ? (
              <EmptyState
                lit={search.q ? 3 : 1}
                title={search.q ? "No articles match" : search.status === "draft" ? "No drafts" : "No articles yet"}
                description={
                  search.q
                    ? "Try different words, or clear the filters."
                    : "Write answers once and share them in replies, the chat widget and your help center."
                }
                action={
                  search.q ? (
                    <Button onClick={() => setTerm("")}>Clear search</Button>
                  ) : canEdit ? (
                    <Button asChild variant="primary">
                      <Link to="/kb/articles/$articleId" params={{ articleId: "new" }} search={{ collection: search.collection }}>
                        <Plus className="size-3.5" />
                        Write an article
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul role="list">
                {articles.data.map((a) => (
                  <li key={a.id}>
                    <Link
                      to="/kb/articles/$articleId"
                      params={{ articleId: a.id }}
                      search={{ collection: undefined }}
                      className="group flex items-center gap-4 border-b border-line-soft px-4 py-3 transition-colors hover:bg-hover/60"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-sunken text-fg-3">
                        <BookOpen className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium">{a.title || "Untitled"}</span>
                          {a.status === "draft" && <Badge tone="outline">Draft</Badge>}
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-3">
                          {!search.collection && collectionName(a.collection_id) && (
                            <>
                              <span className="shrink-0">{collectionName(a.collection_id)}</span>
                              <span className="text-fg-4">·</span>
                            </>
                          )}
                          <span className="truncate">{a.excerpt || "No excerpt"}</span>
                        </span>
                      </span>
                      <span className="mono hidden w-20 shrink-0 text-right text-[11.5px] text-fg-3 sm:block">
                        {a.status === "published" ? `${compact(a.views)} views` : ""}
                      </span>
                      <span className="flex w-24 shrink-0 items-center justify-end gap-2">
                        {a.author && <Avatar name={a.author.name} src={a.author.avatar_url} size="sm" />}
                        <span className="mono text-[11px] text-fg-3">{relShort(a.updated_at)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <CollectionDialog value={editing} onClose={() => setEditing(null)} onCreated={(id) => void navigate({ search: (s) => ({ ...s, collection: id }) })} />
    </div>
  );
}

function CollectionLink({ active, label, count, icon, collection }: { active: boolean; label: string; count: number; icon: React.ReactNode; collection: string | undefined }) {
  return (
    <Link
      to="/kb"
      search={(s) => ({ ...s, collection })}
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-2 pr-7 text-[13px] text-fg-2 transition-colors hover:bg-hover hover:text-fg [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:text-fg-3",
        active && "bg-active font-medium text-fg [&_svg]:text-fg",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="mono text-[11px] tabular-nums text-fg-3 group-hover/c:opacity-0">{count}</span>
    </Link>
  );
}

function CollectionMenu({ c, onRename, onDeleted }: { c: KbCollection; onRename: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: () => api.kb.collections.remove(c.id),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: qk.kbCollections });
      const prev = qc.getQueryData(qk.kbCollections);
      removeFromList(qc, qk.kbCollections, c.id);
      onDeleted();
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.kbCollections, ctx.prev);
      toast.error(e);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.kbArticleLists }),
  });
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`${c.name} options`}
          className="absolute right-1 top-1 flex size-5 items-center justify-center rounded text-fg-3 opacity-100 hover:bg-active hover:text-fg data-[state=open]:opacity-100 md:opacity-0 md:group-hover/c:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuItem icon={<Pencil />} onSelect={onRename}>
          Rename
        </MenuItem>
        <MenuItem
          danger
          icon={<Trash2 />}
          onSelect={() =>
            confirm.show(
              c.article_count ? `Its ${c.article_count} articles stay in the knowledge base without a collection.` : "This collection is empty.",
              () => remove.mutateAsync(),
              { title: `Delete ${c.name}?`, confirmLabel: "Delete collection", danger: true },
            )
          }
        >
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function CollectionDialog({ value, onClose, onCreated }: { value: KbCollection | "new" | null; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isNew = value === "new";

  useEffect(() => {
    if (!value) return;
    setError(null);
    setName(value === "new" ? "" : value.name);
    setDescription(value === "new" ? "" : value.description);
  }, [value]);

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? api.kb.collections.create({ name: name.trim(), description: description.trim() })
        : api.kb.collections.update((value as KbCollection).id, { name: name.trim(), description: description.trim() }),
    onSuccess: (c) => {
      upsertInList(qc, qk.kbCollections, c);
      toast.success(isNew ? "Collection created" : "Collection renamed");
      onClose();
      if (isNew) onCreated(c.id);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog
      open={!!value}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? "New collection" : "Edit collection"}
      size="sm"
      footer={
        <>
          {error && <p className="mr-auto text-xs text-danger-fg">{error}</p>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="kb-collection" loading={save.isPending}>
            {isNew ? "Create" : "Save"}
          </Button>
        </>
      }
    >
      <form
        id="kb-collection"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Add a name.");
          save.mutate();
        }}
      >
        <Field label="Name">{(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Getting started" />}</Field>
        <Field label="Description" optional hint="Shown under the collection title in your help center.">
          {(p) => <Textarea {...p} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}

/** Opens a new article with the AI draft dialog already up. */
function DraftFromTicketsLink({ collection }: { collection?: string }) {
  const ai = useAI();
  const { t } = useTranslation("ai");
  if (!ai.enabled) return null;
  return (
    <AiTooltip feature="kb_draft" label={t("kb_draft.tooltip")}>
      <Button asChild variant="ghost" size="sm">
        <Link to="/kb/articles/$articleId" params={{ articleId: "new" }} search={{ collection }} onClick={requestKbDraft}>
          <AiIcon />
          {t("kb_draft.button")}
        </Link>
      </Button>
    </AiTooltip>
  );
}
