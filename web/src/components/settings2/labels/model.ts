// Labels (the API's tags) for the settings screens, shaped like the "Labels
// and custom fields" contract. The page reads and writes through this seam
// so it works against today's API (name only) and lights up colours, groups,
// descriptions, scopes, usage, archive and merge as the server speaks them.
//
// TODO(labels): when the label hooks land in lib/queries.ts (tag groups,
// reorder, merge), replace `groupsQuery` and the guarded writes below with them.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api/endpoints";
import type { Tag as ApiTag } from "@/lib/api/types";
import { q, qk } from "@/lib/queries";
import { isTone, toneFor, type Tone } from "@/lib/tones";

export type LabelScope = "tickets" | "contacts" | "companies";
export const SCOPES: LabelScope[] = ["tickets", "contacts", "companies"];

export type Label = {
  id: string;
  name: string;
  color: Tone;
  description: string;
  group_id: string | null;
  position: number;
  archived: boolean;
  applies_to: LabelScope[];
  usage: { tickets: number; contacts: number; companies: number } | null;
};

export type LabelGroup = { id: string; name: string; color: Tone | null; exclusive: boolean; position: number; tag_count: number };

/** What the server understands today; the page hides what it can't save. */
export type LabelCaps = { colors: boolean; describe: boolean; scope: boolean; archive: boolean; usage: boolean; groups: boolean; merge: boolean; reorder: boolean };

export type LabelInput = { name: string; color?: Tone; description?: string; group_id?: string | null; applies_to?: LabelScope[]; archived?: boolean };

type RichTag = ApiTag & Partial<Omit<Label, "color" | "usage">> & { usage?: Label["usage"] };

function normalize(t: RichTag, i: number): Label {
  return {
    id: t.id,
    name: t.name,
    color: isTone(t.color) ? t.color : toneFor(t.name),
    description: t.description ?? "",
    group_id: t.group_id ?? null,
    position: typeof t.position === "number" ? t.position : i,
    archived: !!t.archived,
    applies_to: Array.isArray(t.applies_to) && t.applies_to.length ? t.applies_to : SCOPES,
    usage: t.usage ?? null,
  };
}

export function useLabels() {
  const { data, isLoading } = useQuery(q.tags());
  return useMemo(() => {
    const raw = (data ?? []) as RichTag[];
    // The contract makes `color` and `applies_to` required, so their presence says the server speaks it.
    const rich = raw.some((t) => typeof t.color === "string" && Array.isArray(t.applies_to));
    const caps: LabelCaps = { colors: rich, describe: rich, scope: rich, archive: rich, usage: rich && raw.some((t) => !!t.usage), groups: false, merge: false, reorder: false };
    const sorted = [...raw].sort((a, b) => a.name.localeCompare(b.name));
    const labels = sorted.map(normalize).sort((a, b) => (rich ? a.position - b.position : 0) || a.name.localeCompare(b.name));
    const groups: LabelGroup[] = [];
    return { labels, groups, caps, isLoading };
  }, [data, isLoading]);
}

/** Only the members the server accepts; today that is the name. */
function body(v: Partial<LabelInput>, caps: LabelCaps): { name: string } {
  const b: Record<string, unknown> = {};
  if (v.name !== undefined) b.name = v.name;
  if (caps.colors && v.color) b.color = v.color;
  if (caps.describe && v.description !== undefined) b.description = v.description;
  if (caps.scope && v.applies_to) b.applies_to = v.applies_to;
  if (caps.archive && v.archived !== undefined) b.archived = v.archived;
  if (caps.groups && v.group_id !== undefined) b.group_id = v.group_id;
  return b as { name: string };
}

export function useLabelWrites(caps: LabelCaps) {
  const qc = useQueryClient();
  const key = qk.tags;
  const patchList = (fn: (rows: RichTag[]) => RichTag[]) => {
    const prev = qc.getQueryData<RichTag[]>(key);
    if (prev) qc.setQueryData(key, fn(prev));
    return prev;
  };
  const settle = () => qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (v: LabelInput) => api.tags.create(body(v, caps)),
    onSuccess: (t) => {
      qc.setQueryData<RichTag[]>(key, (old) => (old ? [...old.filter((x) => x.id !== t.id), t] : old));
    },
    onSettled: settle,
  });

  const update = useMutation({
    mutationFn: ({ id, ...v }: Partial<LabelInput> & { id: string }) => api.tags.update(id, body(v, caps)),
    onMutate: async ({ id, ...v }) => {
      await qc.cancelQueries({ queryKey: key });
      return { prev: patchList((rows) => rows.map((t) => (t.id === id ? ({ ...t, ...v } as RichTag) : t))) };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e, "Couldn't save the label");
    },
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.tags.remove(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      return { prev: patchList((rows) => rows.filter((t) => t.id !== id)) };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e, "Couldn't delete the label");
    },
    onSettled: settle,
  });

  return { create, update, remove };
}

export const scopeOf = (l: Label, s: LabelScope) => l.applies_to.includes(s);
export const totalUsage = (l: Label) => (l.usage ? l.usage.tickets + l.usage.contacts + l.usage.companies : 0);

const notYet = () => Promise.reject(new Error("This needs a newer server."));

/** Group, merge and reorder writes. Placeholders until the label hooks land (see the TODO above). */
export function useLabelStructureWrites() {
  return {
    reorder: (_ids: string[]) => notYet(),
    merge: (_id: string, _into: string) => notYet(),
    saveGroup: (_id: string | null, _v: { name: string; color: Tone | null; exclusive: boolean }) => notYet(),
    removeGroup: (_id: string) => notYet(),
  };
}
