// Custom fields for the settings screens: the list from the query cache and
// optimistic writes. Realtime keeps qk.customFields fresh.

import { useQueryClient, useQuery } from "@tanstack/react-query";
import { AtSign, Calendar, CheckSquare, Hash, Link2, List, ListChecks, Text, TextQuote, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/tones";
import { api, rows } from "@/lib/api/endpoints";
import type { CustomField as ApiField } from "@/lib/api/types";
import { q, qk } from "@/lib/queries";

export type FieldEntity = "ticket" | "contact" | "company";
export const ENTITIES: FieldEntity[] = ["ticket", "contact", "company"];

export type FieldType = "text" | "long_text" | "number" | "select" | "multi_select" | "date" | "checkbox" | "url" | "email" | "user";
export const FIELD_TYPES: FieldType[] = ["text", "long_text", "number", "select", "multi_select", "date", "checkbox", "url", "email", "user"];

export type FieldOption = { id: string; label: string; color: Tone };

export type CustomField = {
  id: string;
  entity: FieldEntity;
  key: string;
  name: string;
  type: FieldType;
  options: FieldOption[];
  required_on_solve: boolean;
  description: string;
  position: number;
  archived: boolean;
};

export type FieldInput = {
  entity: FieldEntity;
  key?: string;
  name: string;
  type: FieldType;
  options?: FieldOption[];
  required_on_solve?: boolean;
  description?: string;
  archived?: boolean;
};

export const typeIcon: Record<FieldType, ReactNode> = {
  text: <Text />,
  long_text: <TextQuote />,
  number: <Hash />,
  select: <List />,
  multi_select: <ListChecks />,
  date: <Calendar />,
  checkbox: <CheckSquare />,
  url: <Link2 />,
  email: <AtSign />,
  user: <UserRound />,
};

/** A quiet hue per kind of value, so a list of fields scans by type. */
export const typeTone: Record<FieldType, Tone> = {
  text: "gray",
  long_text: "gray",
  number: "blue",
  select: "violet",
  multi_select: "purple",
  date: "amber",
  checkbox: "green",
  url: "cyan",
  email: "teal",
  user: "indigo",
};

export const hasOptions = (t: FieldType) => t === "select" || t === "multi_select";

/** The contract's key rule: a lowercase slug, starting with a letter, up to 40. */
export const keyRe = /^[a-z][a-z0-9_]{0,39}$/;
export function slugKey(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "");
  return s.slice(0, 40);
}
export function slugOption(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "option"
  );
}

export function useCustomFields(): { fields: CustomField[]; isLoading: boolean } {
  const { data, isLoading } = useQuery(q.customFields());
  return { fields: (data ?? []) as CustomField[], isLoading };
}

export function useFieldWrites() {
  const qc = useQueryClient();
  const key = qk.customFields;
  const snapshot = () => qc.getQueryData<ApiField[]>(key);
  const restore = (prev: ApiField[] | undefined) => prev && qc.setQueryData(key, prev);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const upsert = (f: ApiField) => qc.setQueryData<ApiField[]>(key, (old) => (old ? [...old.filter((x) => x.id !== f.id), f] : old));
  return {
    create: async (v: FieldInput) => {
      const f = await api.customFields.create({ entity: v.entity, key: v.key, name: v.name, type: v.type, options: v.options, required_on_solve: v.required_on_solve, description: v.description });
      upsert(f);
      void refresh();
      return f;
    },
    update: async (id: string, v: Partial<FieldInput>) => {
      const prev = snapshot();
      const patch = { name: v.name, options: v.options, required_on_solve: v.required_on_solve, description: v.description, archived: v.archived };
      const clean = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined));
      qc.setQueryData<ApiField[]>(key, (old) => old?.map((f) => (f.id === id ? ({ ...f, ...clean } as ApiField) : f)));
      try {
        const f = await api.customFields.update(id, clean);
        upsert(f);
        return f;
      } catch (e) {
        restore(prev);
        throw e;
      } finally {
        void refresh();
      }
    },
    remove: async (id: string) => {
      const prev = snapshot();
      qc.setQueryData<ApiField[]>(key, (old) => old?.filter((f) => f.id !== id));
      try {
        await api.customFields.remove(id);
      } catch (e) {
        restore(prev);
        throw e;
      } finally {
        void refresh();
      }
    },
    reorder: async (entity: FieldEntity, ids: string[]) => {
      const prev = snapshot();
      const pos = new Map(ids.map((id, i) => [id, i]));
      qc.setQueryData<ApiField[]>(key, (old) => old?.map((f) => (f.entity === entity && pos.has(f.id) ? { ...f, position: pos.get(f.id)! } : f)));
      try {
        const res = rows(await api.customFields.reorder(entity, ids));
        const byId = new Map(res.map((f) => [f.id, f]));
        qc.setQueryData<ApiField[]>(key, (old) => old?.map((f) => byId.get(f.id) ?? f));
      } catch (e) {
        restore(prev);
        throw e;
      } finally {
        void refresh();
      }
    },
  };
}
