import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { SettingsPage, Section } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { SearchInput, TextInput } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { ListSkeleton } from "@/components/settings2/bits";
import { useListMutation } from "@/components/settings2/optimistic";
import { api } from "@/lib/api/endpoints";
import type { Tag } from "@/lib/api/types";
import { q, qk, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { cn } from "@/lib/cn";

export default function Tags() {
  const { data: tags, isLoading } = useQuery(q.tags());
  const role = useRole();
  const canEdit = atLeast(role, "agent");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();
  const qc = useQueryClient();

  const rename = useListMutation<Tag, { id: string; name: string }>(
    qk.tags,
    (v) => api.tags.update(v.id, { name: v.name }),
    (rows, v) => rows.map((t) => (t.id === v.id ? { ...t, name: v.name } : t)),
    { errorText: "Couldn't rename the tag" },
  );
  const remove = useListMutation<Tag, string>(qk.tags, (id) => api.tags.remove(id), (rows, id) => rows.filter((t) => t.id !== id), {
    errorText: "Couldn't delete the tag",
  });
  const create = useMutation({
    mutationFn: (name: string) => api.tags.create({ name }),
    onSuccess: (t) => {
      upsertInList(qc, qk.tags, t);
      toast.success(`Tag “${t.name}” created`);
    },
    onError: (e) => toast.error(e, "Couldn't create the tag"),
  });

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...(tags ?? [])].filter((t) => !term || t.name.toLowerCase().includes(term)).sort((a, b) => a.name.localeCompare(b.name));
  }, [tags, query]);

  return (
    <SettingsPage
      title="Tags"
      description="Label tickets so they are easy to find, filter and report on. Removing a tag takes it off every ticket that has it."
      actions={
        canEdit && (
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            New tag
          </Button>
        )
      }
    >
      <Section
        flush
        title={tags ? `${tags.length} ${tags.length === 1 ? "tag" : "tags"}` : "Tags"}
        actions={<SearchInput value={query} onChange={setQuery} placeholder="Filter tags" className="w-[220px]" />}
      >
        {creating && (
          <NewTagRow
            onCancel={() => setCreating(false)}
            onSave={async (name) => {
              await create.mutateAsync(name);
              setCreating(false);
            }}
            existing={tags ?? []}
          />
        )}
        {isLoading ? (
          <ListSkeleton rows={6} />
        ) : !shown.length && !creating ? (
          <EmptyState
            compact
            lit={2}
            title={query ? "No tags match" : "No tags yet"}
            description={query ? "Try a different name." : "Tags you add to tickets show up here."}
            action={
              canEdit && !query ? (
                <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
                  New tag
                </Button>
              ) : undefined
            }
          />
        ) : (
          shown.map((t) => (
            <TagRow
              key={t.id}
              tag={t}
              canEdit={canEdit}
              onRename={(name) => rename.mutate({ id: t.id, name })}
              onDelete={() =>
                confirm.show(
                  <>
                    <span className="font-medium text-fg">{t.name}</span> will be removed from every ticket that has it. This can't be undone.
                  </>,
                  () => remove.mutateAsync(t.id),
                  { title: "Delete this tag?", confirmLabel: "Delete tag", danger: true },
                )
              }
            />
          ))
        )}
      </Section>
    </SettingsPage>
  );
}

function TagRow({ tag, canEdit, onRename, onDelete }: { tag: Tag; canEdit: boolean; onRename: (n: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.name);
  const cancelled = useRef(false);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const v = draft.trim();
    setEditing(false);
    if (v && v !== tag.name) onRename(v);
    else setDraft(tag.name);
  };

  return (
    <div className="group flex h-11 items-center gap-3 border-b border-line-soft px-4 last:border-0">
      <span className="size-1.5 shrink-0 rounded-full bg-fg-4" aria-hidden />
      {editing ? (
        <TextInput
          autoFocus
          inputSize="sm"
          value={draft}
          maxLength={50}
          aria-label="Tag name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              e.stopPropagation();
              cancelled.current = true;
              setDraft(tag.name);
              setEditing(false);
            }
          }}
          className="max-w-[280px]"
        />
      ) : canEdit ? (
        <Tooltip content="Click to rename">
          <button
            type="button"
            onClick={() => {
              setDraft(tag.name);
              setEditing(true);
            }}
            className="-mx-1.5 truncate rounded-md px-1.5 py-0.5 text-left text-[13px] text-fg hover:bg-hover"
          >
            {tag.name}
          </button>
        </Tooltip>
      ) : (
        <span className="truncate text-[13px]">{tag.name}</span>
      )}
      <span className="flex-1" />
      {canEdit && !editing && (
        <Tooltip content="Delete tag">
          <button
            type="button"
            aria-label={`Delete ${tag.name}`}
            onClick={onDelete}
            className={cn(
              "flex size-7 items-center justify-center rounded-md text-fg-3 transition-opacity hover:bg-hover hover:text-danger-fg",
              "opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            <Trash2 className="size-3.5" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function NewTagRow({ onSave, onCancel, existing }: { onSave: (n: string) => Promise<void>; onCancel: () => void; existing: Tag[] }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const dup = existing.some((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  const submit = async () => {
    const v = name.trim();
    if (!v || dup) return;
    setBusy(true);
    try {
      await onSave(v);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex items-center gap-2 border-b border-line-soft bg-hover/40 px-4 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-fg" aria-hidden />
      <TextInput
        autoFocus
        inputSize="sm"
        value={name}
        maxLength={50}
        placeholder="Tag name, like billing"
        aria-label="New tag name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        invalid={dup}
        className="max-w-[280px]"
      />
      {dup && <span className="text-xs text-danger-fg">Already exists</span>}
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!name.trim() || dup}>
        Add tag
      </Button>
    </form>
  );
}
