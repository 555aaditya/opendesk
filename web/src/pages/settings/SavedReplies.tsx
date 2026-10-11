import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Field, SearchInput, TextInput } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { RichEditor } from "@/components/editor/RichEditor";
import { ListSkeleton } from "@/components/settings2/bits";
import { api } from "@/lib/api/endpoints";
import type { SavedReply } from "@/lib/api/types";
import { q, qk, removeFromList, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { relShort } from "@/lib/format";
import { cn } from "@/lib/cn";

type Draft = { title: string; shortcut: string; body_html: string };
const empty: Draft = { title: "", shortcut: "", body_html: "" };
const NEW = "__new";

function cleanShortcut(s: string) {
  return s.toLowerCase().replace(/^\/+/, "").replace(/[^a-z0-9_-]/g, "-").slice(0, 32);
}

export default function SavedReplies() {
  const { data: replies, isLoading } = useQuery(q.savedReplies());
  const role = useRole();
  const canEdit = atLeast(role, "agent");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...(replies ?? [])]
      .filter((r) => !term || r.title.toLowerCase().includes(term) || r.shortcut.toLowerCase().includes(term))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [replies, query]);

  const current = replies?.find((r) => r.id === selected) ?? null;
  const base: Draft = current ? { title: current.title, shortcut: current.shortcut, body_html: current.body_html } : empty;
  const dirty = selected !== null && (draft.title !== base.title || draft.shortcut !== base.shortcut || draft.body_html !== base.body_html);

  // Open the first reply once the list is in.
  useEffect(() => {
    if (selected === null && replies?.length) {
      const first = [...replies].sort((a, b) => a.title.localeCompare(b.title))[0];
      setSelected(first.id);
      setDraft({ title: first.title, shortcut: first.shortcut, body_html: first.body_html });
    }
  }, [replies, selected]);

  const open = (id: string | null) => {
    const go = () => {
      setError(null);
      setSelected(id);
      const r = replies?.find((x) => x.id === id);
      setDraft(r ? { title: r.title, shortcut: r.shortcut, body_html: r.body_html } : empty);
    };
    if (dirty) confirm.show("Your changes to this reply will be lost.", go, { title: "Discard changes?", confirmLabel: "Discard", danger: true });
    else go();
  };

  const save = useMutation({
    mutationFn: (d: Draft) => (selected && selected !== NEW ? api.savedReplies.update(selected, d) : api.savedReplies.create(d)),
    onSuccess: (r) => {
      upsertInList(qc, qk.savedReplies, r);
      setSelected(r.id);
      setDraft({ title: r.title, shortcut: r.shortcut, body_html: r.body_html });
      toast.success("Saved reply saved");
    },
    onError: (e) => toast.error(e, "Couldn't save the reply"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.savedReplies.remove(id),
    onMutate: async (id) => {
      const prev = qc.getQueryData<SavedReply[]>(qk.savedReplies);
      removeFromList(qc, qk.savedReplies, id);
      setSelected(null);
      setDraft(empty);
      return { prev };
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.savedReplies, ctx.prev);
      toast.error(e, "Couldn't delete the reply");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.savedReplies }),
  });

  const submit = () => {
    setError(null);
    if (!draft.title.trim()) return setError("Give the reply a title.");
    if (!draft.body_html) return setError("Write the reply text.");
    const taken = replies?.some((r) => r.id !== selected && draft.shortcut && r.shortcut === draft.shortcut);
    if (taken) return setError(`Another reply already uses /${draft.shortcut}.`);
    save.mutate({ ...draft, title: draft.title.trim() });
  };

  return (
    <SettingsPage
      wide
      title="Saved replies"
      description={
        <>
          Answers your team sends often. In the composer, type <Kbd>/</Kbd> followed by a shortcut, or pick one from the saved replies menu.
        </>
      }
      actions={
        canEdit && (
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => open(NEW)}>
            New reply
          </Button>
        )
      }
    >
      <div className="grid min-h-[480px] grid-cols-1 overflow-hidden rounded-lg border border-line md:grid-cols-[280px_1fr]">
        <div className="flex min-h-0 flex-col border-b border-line md:border-b-0 md:border-r">
          <div className="border-b border-line-soft p-2">
            <SearchInput value={query} onChange={setQuery} placeholder="Find a reply" />
          </div>
          <div className="max-h-[560px] flex-1 overflow-y-auto p-1">
            {isLoading ? (
              <ListSkeleton rows={5} />
            ) : !sorted.length && selected !== NEW ? (
              <EmptyState compact lit={1} title={query ? "No matches" : "No saved replies"} description={query ? undefined : "Create one for the answers you write most."} />
            ) : (
              <>
                {selected === NEW && (
                  <div className="flex h-12 flex-col justify-center rounded-md bg-active px-2.5">
                    <span className="truncate text-[13px] font-medium">{draft.title || "Untitled reply"}</span>
                    <span className="mono text-[11px] text-fg-3">{draft.shortcut ? `/${draft.shortcut}` : "New"}</span>
                  </div>
                )}
                {sorted.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => r.id !== selected && open(r.id)}
                    aria-current={r.id === selected}
                    className={cn(
                      "flex w-full flex-col justify-center rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover",
                      r.id === selected && "bg-active hover:bg-active",
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.title}</span>
                      <span className="mono shrink-0 text-[10.5px] text-fg-4">{relShort(r.updated_at)}</span>
                    </span>
                    <span className="mono truncate text-[11.5px] text-fg-3">{r.shortcut ? `/${r.shortcut}` : "No shortcut"}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          {selected === null ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <EmptyState
                lit={3}
                icon={<MessageSquareText className="size-8 text-fg-4" strokeWidth={1.25} />}
                title="Pick a reply to edit"
                description="Or create a new one."
              />
            </div>
          ) : (
            <form
              className="flex flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-[1fr_200px]">
                <Field label="Title">
                  {(f) => (
                    <TextInput
                      {...f}
                      disabled={!canEdit}
                      value={draft.title}
                      maxLength={120}
                      placeholder="Refund confirmation"
                      onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    />
                  )}
                </Field>
                <Field label="Shortcut" optional>
                  {(f) => (
                    <TextInput
                      {...f}
                      disabled={!canEdit}
                      value={draft.shortcut}
                      placeholder="refund"
                      className="mono"
                      leading={<span className="mono text-[12px] text-fg-3">/</span>}
                      onChange={(e) => setDraft((d) => ({ ...d, shortcut: cleanShortcut(e.target.value) }))}
                    />
                  )}
                </Field>
              </div>
              <div className="mx-5 mb-5 flex min-h-[260px] flex-1 flex-col rounded-md border border-line focus-within:border-fg-3 focus-within:shadow-[0_0_0_3px_var(--focus)]">
                <RichEditor
                  key={selected}
                  className="flex-1"
                  value={draft.body_html}
                  onChange={(html) => setDraft((d) => ({ ...d, body_html: html }))}
                  placeholder="Hi there, thanks for reaching out…"
                  contentClassName="min-h-[220px]"
                  editable={canEdit}
                  onSubmit={submit}
                  ariaLabel="Reply text"
                />
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 border-t border-line px-5 py-3">
                  {selected !== NEW && current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="size-3.5" />}
                      onClick={() =>
                        confirm.show(
                          <>
                            <span className="font-medium text-fg">{current.title}</span> will no longer be available in the composer.
                          </>,
                          () => remove.mutateAsync(current.id),
                          { title: "Delete this reply?", confirmLabel: "Delete", danger: true },
                        )
                      }
                    >
                      Delete
                    </Button>
                  )}
                  <span className="flex-1 text-xs text-danger-fg">{error}</span>
                  {(dirty || selected === NEW) && (
                    <>
                      <span className="text-xs text-fg-3">{selected === NEW ? "New reply" : "Unsaved changes"}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          if (selected === NEW) open(null);
                          else setDraft(base);
                        }}
                      >
                        {selected === NEW ? "Cancel" : "Revert"}
                      </Button>
                    </>
                  )}
                  <Button variant="primary" size="sm" type="submit" loading={save.isPending} disabled={!dirty && selected !== NEW}>
                    Save
                  </Button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </SettingsPage>
  );
}
