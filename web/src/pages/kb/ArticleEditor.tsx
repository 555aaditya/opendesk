import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useBlocker, useNavigate } from "@tanstack/react-router";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ChevronRight, ExternalLink, Folder, MoreHorizontal, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BackLink } from "@/components/layout";
import { RichEditor, Toolbar, type RichEditorHandle } from "@/components/editor/RichEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { TextInput } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Picker } from "@/components/ui/picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { useDocumentTitle } from "@/app/RootLayout";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { KbArticle } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { fullDate, relLong } from "@/lib/format";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole, useWorkspace } from "@/lib/session";
import { slugify } from "@/components/kb/slug";
import { AiIcon, AiTooltip } from "@/components/ai/bits";
import { KbDraftDialog } from "@/components/ai/KbDraftDialog";
import { takeKbDraftRequest } from "@/components/ai/kbDraftIntent";
import { useAI } from "@/lib/ai";
import type { KBArticleDraft } from "@/lib/api/types";
import { useTranslation } from "react-i18next";

const route = getRouteApi("/app/kb/articles/$articleId");

type Draft = { title: string; excerpt: string; slug: string; collection_id: string | null; body_html: string };

const same = (a: Draft, b: Draft) =>
  a.title === b.title && a.excerpt === b.excerpt && a.slug === b.slug && a.collection_id === b.collection_id && a.body_html === b.body_html;

export default function ArticleEditor() {
  const { articleId } = route.useParams();
  const isNew = articleId === "new";
  const article = useQuery({ ...q.kbArticle(articleId), enabled: !isNew });

  if (!isNew && article.isLoading)
    return (
      <div className="mx-auto w-full max-w-[720px] px-6 pt-20">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-4 h-3 w-1/2" />
        <Skeleton className="mt-10 h-3 w-full" />
        <Skeleton className="mt-3 h-3 w-5/6" />
        <Skeleton className="mt-3 h-3 w-4/6" />
      </div>
    );
  if (!isNew && (article.error || !article.data))
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState lit={3} title="Article not found" description={article.error ? errorMessage(article.error) : undefined} />
      </div>
    );
  return <EditorScreen key={articleId} article={isNew ? null : article.data!} />;
}

function EditorScreen({ article }: { article: KbArticle | null }) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const ws = useWorkspace();
  const canEdit = atLeast(useRole(), "agent");
  const collections = useQuery(q.kbCollections());

  const initial: Draft = useMemo(
    () => ({
      title: article?.title ?? "",
      excerpt: article?.excerpt ?? "",
      slug: article?.slug ?? "",
      collection_id: article ? article.collection_id : (search.collection ?? null),
      body_html: article?.body_html ?? "",
    }),
    // The baseline is the article as loaded; later saves move it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [saved, setSaved] = useState<Draft>(initial);
  const [draft, setDraft] = useState<Draft>(initial);
  const [status, setStatus] = useState<KbArticle["status"]>(article?.status ?? "draft");
  const [current, setCurrent] = useState<KbArticle | null>(article);
  const [slugTouched, setSlugTouched] = useState(!!article);
  const [advanced, setAdvanced] = useState(false);
  const dirty = !same(draft, saved);
  useDocumentTitle(draft.title || (current ? "Untitled" : "New article"));

  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const save = useMutation({
    mutationFn: (nextStatus: KbArticle["status"]) => {
      const body = {
        title: draft.title.trim() || "Untitled",
        excerpt: draft.excerpt.trim(),
        slug: (draft.slug || slugify(draft.title)) || undefined,
        collection_id: draft.collection_id,
        body_html: draft.body_html,
        status: nextStatus,
      };
      return current ? api.kb.articles.update(current.id, body) : api.kb.articles.create(body);
    },
    onSuccess: (a, nextStatus) => {
      const wasNew = !current;
      qc.setQueryData(qk.kbArticle(a.id), a);
      void qc.invalidateQueries({ queryKey: qk.kbArticleLists });
      void qc.invalidateQueries({ queryKey: qk.kbCollections });
      const next: Draft = { title: a.title, excerpt: a.excerpt, slug: a.slug, collection_id: a.collection_id, body_html: draft.body_html };
      setSaved(next);
      setDraft((d) => ({ ...d, title: a.title, slug: a.slug, excerpt: a.excerpt }));
      setCurrent(a);
      setStatus(a.status);
      setSlugTouched(true);
      toast.success(
        nextStatus === "published" && status === "draft" ? "Article published" : nextStatus === "draft" && status === "published" ? "Article unpublished" : "Saved",
      );
      if (wasNew) void navigate({ to: "/kb/articles/$articleId", params: { articleId: a.id }, search: { collection: undefined }, replace: true, ignoreBlocker: true });
    },
    onError: (e) => toast.error(e),
  });

  const remove = useMutation({
    mutationFn: () => api.kb.articles.remove(current!.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: qk.kbArticle(current!.id) });
      void qc.invalidateQueries({ queryKey: qk.kbArticleLists });
      void qc.invalidateQueries({ queryKey: qk.kbCollections });
      toast.success("Article deleted");
      void navigate({ to: "/kb", ignoreBlocker: true });
    },
  });

  // Cmd/Ctrl+S saves without changing the published state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canEdit && !save.isPending) save.mutate(status);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, save, status]);

  const blocker = useBlocker({ shouldBlockFn: () => dirty && !save.isPending, enableBeforeUnload: () => dirty, withResolver: true });

  const editorRef = useRef<RichEditorHandle>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const ed = editorRef.current?.editor ?? null;
    setEditor(ed);
    if (!ed) return;
    // The editor normalises stored HTML; that normalised form is the saved baseline.
    const normalised = ed.isEmpty ? "" : ed.getHTML();
    setSaved((d) => ({ ...d, body_html: normalised }));
    setDraft((d) => ({ ...d, body_html: normalised }));
    ed.on("transaction", rerender);
    return () => {
      ed.off("transaction", rerender);
    };
  }, []);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const a = await api.attachments.upload(file);
      // Use the URL exactly as returned (signed); only escape it for the attribute.
      const src = a.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[<>"]/g, "");
      editorRef.current?.insertHtml(`<img src="${src}" alt="${alt}">`);
    } catch (e) {
      toast.error(e, "Couldn't upload the image");
    } finally {
      setUploading(false);
    }
  };

  const ai = useAI();
  const { t: tai } = useTranslation("ai");
  const [draftOpen, setDraftOpen] = useState(() => !article && takeKbDraftRequest());
  const applyDraft = (d: KBArticleDraft) => {
    const fill = () => {
      set(slugTouched ? { title: d.title, excerpt: d.excerpt, body_html: d.body_html } : { title: d.title, excerpt: d.excerpt, body_html: d.body_html, slug: slugify(d.title) });
      editorRef.current?.setHtml(d.body_html);
      toast.success(tai("kb_draft.done"));
    };
    const hasContent = !!draft.title.trim() || !!draft.excerpt.trim() || !(editorRef.current?.isEmpty() ?? true);
    if (!hasContent) return fill();
    confirm.show(tai("kb_draft.replace_body"), fill, { title: tai("kb_draft.replace_title"), confirmLabel: tai("kb_draft.replace_confirm") });
  };

  const collectionName = collections.data?.find((c) => c.id === draft.collection_id)?.name;
  const publicUrl = current && status === "published" && ws ? `/help/${ws.slug}/a/${current.slug}` : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <BackLink to="/kb">Knowledge base</BackLink>
        <span className="text-fg-4">/</span>
        <Picker
          items={[
            { value: "__none", label: "No collection" },
            ...(collections.data ?? []).map((c) => ({ value: c.id, label: c.name, icon: <Folder /> })),
          ]}
          value={draft.collection_id ?? "__none"}
          onSelect={(v) => set({ collection_id: v === "__none" ? null : v })}
          placeholder="Move to collection"
          trigger={
            <button
              type="button"
              disabled={!canEdit}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg disabled:pointer-events-none"
            >
              <Folder className="size-3.5 text-fg-3" />
              {collectionName ?? "No collection"}
              <ChevronDown className="size-3 text-fg-4" />
            </button>
          }
        />
        {status === "published" ? <Badge tone="ok">Published</Badge> : <Badge tone="outline">Draft</Badge>}
        <span className="ml-1 hidden text-xs text-fg-4 lg:inline">
          {dirty ? "Unsaved changes" : current ? <span title={fullDate(current.updated_at)}>Saved {relLong(current.updated_at)}</span> : null}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {publicUrl && (
            <Tooltip content="Open in help center">
              <Button asChild variant="ghost" size="sm">
                <a href={publicUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                  View
                </a>
              </Button>
            </Tooltip>
          )}
          {canEdit && ai.enabled && (
            <AiTooltip feature="kb_draft" label={tai("kb_draft.tooltip")}>
              <Button variant="ghost" size="sm" icon={<AiIcon />} onClick={() => setDraftOpen(true)}>
                <span className="hidden sm:inline">{tai("kb_draft.button")}</span>
              </Button>
            </AiTooltip>
          )}
          {canEdit && (
            <>
              <Tooltip content={status === "published" ? "Save changes to the live article" : "Save without publishing"} shortcut="mod s">
                <Button variant="secondary" disabled={!dirty && !!current} loading={save.isPending && save.variables === status} onClick={() => save.mutate(status)}>
                  {status === "published" ? "Save" : "Save draft"}
                </Button>
              </Tooltip>
              {status === "draft" ? (
                <Button variant="primary" loading={save.isPending && save.variables === "published"} onClick={() => save.mutate("published")}>
                  Publish
                </Button>
              ) : null}
              <Menu>
                <MenuTrigger asChild>
                  <Button square variant="ghost" aria-label="More actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  {status === "published" && (
                    <MenuItem icon={<Undo2 />} onSelect={() => save.mutate("draft")}>
                      Unpublish
                    </MenuItem>
                  )}
                  {current && (
                    <>
                      {status === "published" && <MenuSeparator />}
                      <MenuItem
                        danger
                        icon={<Trash2 />}
                        onSelect={() =>
                          confirm.show(
                            status === "published" ? "It disappears from your help center right away." : "This draft will be gone for good.",
                            () => remove.mutateAsync(),
                            { title: `Delete “${current.title || "Untitled"}”?`, confirmLabel: "Delete article", danger: true },
                          )
                        }
                      >
                        Delete article
                      </MenuItem>
                    </>
                  )}
                  {!current && <MenuItem disabled>Save first to delete</MenuItem>}
                </MenuContent>
              </Menu>
            </>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-6 pb-32 pt-12 md:px-10">
          <textarea
            value={draft.title}
            onChange={(e) => {
              const title = e.target.value.replace(/\n/g, " ");
              set(slugTouched ? { title } : { title, slug: slugify(title) });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editorRef.current?.focus();
              }
            }}
            readOnly={!canEdit}
            rows={1}
            placeholder="Article title"
            aria-label="Title"
            autoFocus={!current}
            className="field-sizing-content w-full resize-none bg-transparent text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-fg outline-none placeholder:text-fg-4 focus-visible:shadow-none"
          />
          <input
            value={draft.excerpt}
            onChange={(e) => set({ excerpt: e.target.value })}
            readOnly={!canEdit}
            placeholder="A one-line summary for search results and the help center"
            aria-label="Excerpt"
            className="mt-2 w-full bg-transparent text-[15px] text-fg-2 outline-none placeholder:text-fg-4 focus-visible:shadow-none"
          />

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              className="-ml-1 inline-flex h-6 items-center gap-1 rounded-md px-1 text-xs text-fg-3 hover:bg-hover hover:text-fg"
            >
              <ChevronRight className={cn("size-3 transition-transform", advanced && "rotate-90")} />
              Advanced
            </button>
            {advanced && (
              <div className="mt-2 flex max-w-[480px] items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2.5">
                <label htmlFor="kb-slug" className="shrink-0 text-xs text-fg-3">
                  URL
                </label>
                <span className="mono shrink-0 text-xs text-fg-4">/a/</span>
                <TextInput
                  id="kb-slug"
                  inputSize="sm"
                  className="mono"
                  value={draft.slug}
                  readOnly={!canEdit}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set({ slug: slugify(e.target.value) || e.target.value.toLowerCase() });
                  }}
                  placeholder={slugify(draft.title) || "article-url"}
                />
              </div>
            )}
          </div>

          {canEdit && editor && (
            <div className="sticky top-0 z-10 -mx-2 mt-6 border-b border-line-soft bg-surface/95 pt-1.5 backdrop-blur">
              <Toolbar editor={editor} full onImage={() => fileRef.current?.click()} end={uploading ? <span className="pr-2 text-xs text-fg-4">Uploading image</span> : undefined} />
            </div>
          )}
          <RichEditor
            ref={editorRef}
            value={draft.body_html}
            onChange={(html) => set({ body_html: html })}
            toolbar="none"
            editable={canEdit}
            placeholder="Start writing. Use headings so readers can scan."
            ariaLabel="Article body"
            className="mt-4"
            contentClassName="prose-lg min-h-[360px] px-0"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {ai.enabled && <KbDraftDialog open={draftOpen} onOpenChange={setDraftOpen} onDraft={applyDraft} />}

      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="Leave without saving?"
        description="Your changes to this article haven't been saved."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button variant="danger-solid" onClick={() => blocker.proceed?.()}>
              Discard changes
            </Button>
          </>
        }
      />
    </div>
  );
}
