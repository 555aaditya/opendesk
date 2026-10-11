// Labels and custom fields on a contact or company, edited in place in the
// drawer. Each change patches the record optimistically and rolls back on error.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TagChip } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { LabelPicker } from "@/components/tickets/detail/LabelPicker";
import { FieldsSection } from "@/components/tickets/detail/FieldsSection";
import { api } from "@/lib/api/endpoints";
import type { Company, Contact, FieldValue, FieldValues, Tag, TagRef } from "@/lib/api/types";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { patchCompany, patchContact, restore, snapshot } from "./cache";

type Kind = "contact" | "company";
type Patch = { tags?: string[]; fields?: Record<string, FieldValue | null> };

function useRecordPatch(kind: Kind, record: Contact | Company) {
  const qc = useQueryClient();
  const { t } = useTranslation("contacts");
  const { data: allTags } = useQuery(q.tags());
  return useMutation({
    mutationFn: (p: Patch): Promise<Contact | Company> => (kind === "contact" ? api.contacts.update(record.id, p) : api.companies.update(record.id, p)),
    onMutate: async (p) => {
      const key = kind === "contact" ? qk.contact(record.id) : qk.company(record.id);
      await qc.cancelQueries({ queryKey: key });
      const snap = snapshot(qc, [key, kind === "contact" ? qk.contactLists : qk.companyLists]);
      const next = { ...record };
      if (p.tags) {
        const known = new Map<string, TagRef>([...record.tags.map((x) => [x.name, x] as const), ...((allTags ?? []) as Tag[]).map((x) => [x.name, { id: x.id, name: x.name, color: x.color, group_id: x.group_id }] as const)]);
        next.tags = p.tags.map((name) => known.get(name) ?? { id: `new-${name}`, name, color: "gray", group_id: null });
      }
      if (p.fields) {
        const f: FieldValues = { ...record.fields };
        for (const [k, v] of Object.entries(p.fields)) {
          if (v === null) delete f[k];
          else f[k] = v;
        }
        next.fields = f;
      }
      if (kind === "contact") patchContact(qc, next as Contact);
      else patchCompany(qc, next as Company);
      return { snap };
    },
    onError: (e, _p, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast.error(e, t("labels.saveFailed"));
    },
    onSuccess: (u) => {
      if (kind === "contact") patchContact(qc, u as Contact);
      else patchCompany(qc, u as unknown as Company);
      void qc.invalidateQueries({ queryKey: qk.tags });
    },
  });
}

export function RecordLabels({ kind, record }: { kind: Kind; record: Contact | Company }) {
  const { t } = useTranslation("contacts");
  const canEdit = atLeast(useRole(), "agent");
  const save = useRecordPatch(kind, record);
  const names = record.tags.map((x) => x.name);
  const set = (next: string[]) => save.mutate({ tags: next });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {record.tags.map((x) => (
        <TagChip key={x.id} name={x.name} color={x.color} onRemove={canEdit ? () => set(names.filter((n) => n !== x.name)) : undefined} />
      ))}
      {canEdit && (
        <LabelPicker
          scope={kind === "contact" ? "contacts" : "companies"}
          values={names}
          onChange={set}
          trigger={
            <button
              type="button"
              className="inline-flex h-[18px] items-center gap-1 rounded-sm px-1.5 text-[11px] text-fg-3 first:-ml-1.5 outline-none transition-colors hover:bg-hover hover:text-fg focus-visible:shadow-[0_0_0_2px_var(--focus)] data-[state=open]:bg-hover"
            >
              <Plus className="size-3" />
              {record.tags.length ? t("labels.edit") : t("labels.add")}
            </button>
          }
        />
      )}
    </div>
  );
}

export function useRecordFields(kind: Kind) {
  return useQuery({
    ...q.customFields(),
    select: (d) => d.filter((f) => f.entity === kind && !f.archived).sort((a, b) => a.position - b.position),
  });
}

export function RecordFields({ kind, record }: { kind: Kind; record: Contact | Company }) {
  const canEdit = atLeast(useRole(), "agent");
  const { data: fields } = useRecordFields(kind);
  const save = useRecordPatch(kind, record);
  if (!fields?.length) return null;
  return (
    <FieldsSection
      fields={fields}
      values={record.fields ?? {}}
      disabled={!canEdit}
      labelWidth="w-[138px]"
      className="-mx-1.5"
      onChange={(key, v) => save.mutate({ fields: { [key]: v } })}
    />
  );
}
