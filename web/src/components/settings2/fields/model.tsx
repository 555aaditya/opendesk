// Custom fields for the settings screens, shaped like the "Labels and custom
// fields" contract. Local types until lib/api/types.ts carries them.
//
// TODO(fields): when the custom field hooks land in lib/queries.ts, read the
// list from them and wire `useFieldWrites` to their create, update, delete and
// reorder calls. Until then the page shows that the server needs an update.

import { AtSign, Calendar, CheckSquare, Hash, Link2, List, ListChecks, Text, TextQuote, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/tones";

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

export function useCustomFields(): { fields: CustomField[]; available: boolean; isLoading: boolean } {
  return { fields: [], available: false, isLoading: false };
}

const notYet = () => Promise.reject(new Error("This needs a newer server."));

export function useFieldWrites() {
  return {
    create: (_v: FieldInput) => notYet(),
    update: (_id: string, _v: Partial<FieldInput>) => notYet(),
    remove: (_id: string) => notYet(),
    reorder: (_entity: FieldEntity, _ids: string[]) => notYet(),
  };
}
