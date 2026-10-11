// Custom ticket fields in the sidebar, edited in place. Each type gets the
// lightest control that fits: text inline, options in a picker, a checkbox for
// yes/no. Changes save on Enter or blur and patch the ticket optimistically.

import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { q } from "@/lib/queries";
import { cn } from "@/lib/cn";
import { isTone, tone, toneFor } from "@/lib/tones";
import { Picker } from "@/components/ui/picker";
import { Avatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { TagSwatch } from "../TagSwatch";
import { hasValue, useFieldFocus, useTicketFields, type CustomField, type FieldValue } from "../fields";

const shell =
  "flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[12.5px] outline-none transition-colors hover:bg-hover focus-visible:shadow-[0_0_0_2px_var(--focus)] data-[state=open]:bg-hover";

function OptionChip({ label, color }: { label: string; color: string }) {
  const hue = isTone(color) ? color : toneFor(label);
  return <span className={cn("inline-flex h-[18px] max-w-full items-center truncate rounded-sm px-1.5 text-[11px] font-medium", tone[hue].chip)}>{label}</span>;
}

function TextEditor({
  field,
  value,
  onSave,
  autoOpen,
  disabled,
}: {
  field: CustomField;
  value: FieldValue | undefined;
  onSave: (v: FieldValue | null) => void;
  autoOpen: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation("inbox");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  useEffect(() => {
    if (autoOpen && !disabled) setEditing(true);
  }, [autoOpen, disabled]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = () => {
    const v = text.trim();
    if (field.type === "number" && v && !Number.isFinite(Number(v))) return setInvalid(true);
    if (field.type === "url" && v && !/^https?:\/\/\S+$/i.test(v)) return setInvalid(true);
    if (field.type === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setInvalid(true);
    setInvalid(false);
    setEditing(false);
    const next: FieldValue | null = !v ? null : field.type === "number" ? Number(v) : v;
    if (String(next ?? "") !== String(value ?? "")) onSave(next);
  };
  const cancel = () => {
    setText(value === undefined ? "" : String(value));
    setInvalid(false);
    setEditing(false);
  };

  if (!editing)
    return (
      <button type="button" disabled={disabled} onClick={() => setEditing(true)} className={cn(shell, "disabled:pointer-events-none", !hasValue(field, value) && "text-fg-4")}>
        <span className={cn("min-w-0 truncate", field.type === "long_text" && "line-clamp-3 whitespace-pre-wrap", (field.type === "number" || field.type === "date") && "mono tabular-nums")}>
          {hasValue(field, value) ? String(value) : t("fields.empty")}
        </span>
      </button>
    );

  const common = {
    ref,
    value: text,
    "aria-label": field.name,
    "aria-invalid": invalid || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      }
      if (e.key === "Enter" && (field.type !== "long_text" || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    },
    className: cn(
      "w-full min-w-0 flex-1 rounded-md border bg-surface px-2 py-1 text-[12.5px] outline-none transition-[border-color,box-shadow] focus:shadow-[0_0_0_3px_var(--focus)]",
      invalid ? "border-danger" : "border-line focus:border-fg-4",
    ),
  };
  return field.type === "long_text" ? (
    <textarea {...common} rows={3} className={cn(common.className, "resize-none leading-5")} />
  ) : (
    <input
      {...common}
      type={field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
      inputMode={field.type === "number" ? "decimal" : undefined}
      className={cn(common.className, "h-7", (field.type === "number" || field.type === "date") && "mono")}
    />
  );
}

function FieldControl({ field, value, onSave, autoOpen, disabled }: { field: CustomField; value: FieldValue | undefined; onSave: (v: FieldValue | null) => void; autoOpen: boolean; disabled: boolean }) {
  const { t } = useTranslation("inbox");
  const { data: members } = useQuery(q.members());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (autoOpen && !disabled) setOpen(true);
  }, [autoOpen, disabled]);
  const empty = <span className="text-fg-4">{t("fields.empty")}</span>;
  const caret = <ChevronDown className="ml-auto size-3 shrink-0 text-fg-4 opacity-0 transition-opacity group-hover:opacity-100" />;

  if (field.type === "checkbox")
    return (
      <div className="flex min-h-7 flex-1 items-center px-2">
        <Checkbox checked={value === true} disabled={disabled} aria-label={field.name} onCheckedChange={(v) => onSave(v ? true : null)} />
      </div>
    );

  if (field.type === "select" || field.type === "user") {
    const items =
      field.type === "select"
        ? field.options.map((o) => ({ value: o.id, label: o.label, icon: <TagSwatch name={o.label} color={o.color} /> }))
        : (members ?? []).filter((m) => m.role !== "viewer").map((m) => ({ value: m.user.id, label: m.user.name, keywords: [m.user.email], icon: <Avatar name={m.user.name} src={m.user.avatar_url} size="xs" /> }));
    const current = typeof value === "string" ? value : null;
    let shown: ReactNode = empty;
    if (current && field.type === "select") {
      const o = field.options.find((x) => x.id === current);
      shown = <OptionChip label={o?.label ?? current} color={o?.color ?? "gray"} />;
    } else if (current) {
      const m = members?.find((x) => x.user.id === current)?.user;
      shown = (
        <>
          <Avatar name={m?.name ?? "?"} src={m?.avatar_url} size="xs" />
          <span className="truncate">{m?.name ?? t("fields.formerMember")}</span>
        </>
      );
    }
    return (
      <Picker
        open={open}
        onOpenChange={setOpen}
        value={current}
        placeholder={field.name}
        items={current ? [...items, { value: "__clear", label: t("fields.clear") }] : items}
        onSelect={(v) => onSave(v === "__clear" || v === current ? null : v)}
        trigger={
          <button type="button" disabled={disabled} className={cn(shell, "group disabled:pointer-events-none")}>
            {shown}
            {caret}
          </button>
        }
      />
    );
  }

  if (field.type === "multi_select") {
    const vals = Array.isArray(value) ? value.map(String) : [];
    return (
      <Picker
        multi
        open={open}
        onOpenChange={setOpen}
        values={vals}
        placeholder={field.name}
        items={field.options.map((o) => ({ value: o.id, label: o.label, icon: <TagSwatch name={o.label} color={o.color} /> }))}
        onChange={(v) => onSave(v.length ? v : null)}
        trigger={
          <button type="button" disabled={disabled} className={cn(shell, "group flex-wrap py-1 disabled:pointer-events-none")}>
            {vals.length
              ? vals.map((id) => {
                  const o = field.options.find((x) => x.id === id);
                  return <OptionChip key={id} label={o?.label ?? id} color={o?.color ?? "gray"} />;
                })
              : empty}
            {caret}
          </button>
        }
      />
    );
  }

  return <TextEditor field={field} value={value} onSave={onSave} autoOpen={autoOpen} disabled={disabled} />;
}

export function FieldsSection({
  values,
  onChange,
  disabled,
  fields: fieldsOverride,
  className,
  labelWidth,
}: {
  values: Record<string, FieldValue>;
  onChange: (key: string, v: FieldValue | null) => void;
  disabled: boolean;
  /** Field definitions to show instead of the ticket fields (contacts, companies). */
  fields?: CustomField[];
  className?: string;
  /** Width class for the name column; 76px by default. */
  labelWidth?: string;
}) {
  const { t } = useTranslation("inbox");
  const { data: ticketFields } = useTicketFields();
  const fields = fieldsOverride ?? ticketFields;
  const focus = useFieldFocus();
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus.key) section.current?.querySelector(`[data-field="${focus.key}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus.key, focus.at]);
  if (!fields?.length) return null;
  return (
    <section ref={section} className={className ?? "border-b border-line-soft px-2.5 py-2.5"} aria-label={t("fields.title")}>
      <h3 className="label-caps px-1.5 pb-1.5 pt-1">{t("fields.title")}</h3>
      {fields.map((f) => {
        const v = values[f.key];
        const missing = f.required_on_solve && !hasValue(f, v);
        const flagged = focus.key === f.key;
        return (
          <div
            key={f.id}
            data-field={f.key}
            className={cn("flex items-start gap-1 rounded-md transition-shadow duration-300", flagged && missing && "shadow-[0_0_0_2px_var(--tone-amber-solid)]")}
          >
            <Tooltip content={f.description || undefined}>
              <span className={cn("flex min-h-7 shrink-0 items-center gap-1 pl-1.5 text-[12px] text-fg-3", labelWidth ?? "w-[76px]")}>
                <span className="truncate">{f.name}</span>
                {f.required_on_solve && (
                  <span aria-label={t("fields.required")} title={t("fields.required")} className={cn("size-1 shrink-0 rounded-full", missing ? tone.amber.solid : "bg-fg-4")} />
                )}
              </span>
            </Tooltip>
            <div className="flex min-w-0 flex-1">
              <FieldControl key={flagged ? focus.at : "f"} field={f} value={v} disabled={disabled} autoOpen={flagged} onSave={(nv) => onChange(f.key, nv)} />
            </div>
          </div>
        );
      })}
    </section>
  );
}
