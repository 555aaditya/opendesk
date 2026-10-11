// Create or edit a label: name with a live chip, colour, description, group
// and where it applies. Fields the server can't save yet stay hidden.

import { Building2, Ticket, User } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TagChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Label as FieldLabel, Textarea, TextInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { toneFor, tone as tones, type Tone } from "@/lib/tones";
import { ColorSwatchPicker } from "../ColorSwatchPicker";
import { SCOPES, type Label, type LabelCaps, type LabelGroup, type LabelInput, type LabelScope } from "./model";

const nameRe = /^[\p{L}\p{N} _\-./:&+#]+$/u;

export const scopeIcon: Record<LabelScope, React.ReactNode> = { tickets: <Ticket />, contacts: <User />, companies: <Building2 /> };

export function LabelDialog({
  label,
  caps,
  groups,
  existing,
  defaultGroup,
  onClose,
  onSave,
}: {
  label: Label | null;
  caps: LabelCaps;
  groups: LabelGroup[];
  existing: Label[];
  defaultGroup?: string | null;
  onClose: () => void;
  onSave: (v: LabelInput) => Promise<unknown>;
}) {
  const { t } = useTranslation("settings");
  const [name, setName] = useState(label?.name ?? "");
  const [color, setColor] = useState<Tone | null>(label?.color ?? null);
  const [description, setDescription] = useState(label?.description ?? "");
  const [group, setGroup] = useState<string>(label?.group_id ?? defaultGroup ?? "none");
  const [scope, setScope] = useState<LabelScope[]>(label?.applies_to ?? SCOPES);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();
  const shownColor = color ?? toneFor(trimmed || "label");
  const dup = existing.some((l) => l.id !== label?.id && l.name.toLowerCase() === trimmed.toLowerCase());
  const nameError = dup ? t("labels.dialog.duplicate") : trimmed && !nameRe.test(trimmed) ? t("labels.dialog.badChars") : null;

  const submit = async () => {
    if (!trimmed) return setError(t("labels.dialog.nameRequired"));
    if (nameError) return setError(nameError);
    if (caps.scope && !scope.length) return setError(t("labels.dialog.scopeRequired"));
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: trimmed,
        color: color ?? undefined,
        description: description.trim(),
        group_id: group === "none" ? null : group,
        applies_to: scope,
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={label ? t("labels.dialog.editTitle") : t("labels.dialog.newTitle")}
      description={label ? undefined : t("labels.dialog.newDescription")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!trimmed || !!nameError} onClick={() => void submit()}>
            {label ? t("labels.dialog.save") : t("labels.dialog.create")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t("labels.dialog.name")} error={error ?? nameError}>
          {({ id, invalid }) => (
            <div className="flex items-center gap-3">
              <TextInput
                id={id}
                autoFocus
                invalid={invalid}
                value={name}
                maxLength={50}
                placeholder={t("labels.dialog.namePlaceholder")}
                aria-label={label ? t("labels.dialog.name") : t("labels.dialog.newName")}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                className="flex-1"
              />
              <span className="flex h-8 w-[150px] shrink-0 items-center justify-center rounded-md border border-dashed border-line bg-sunken px-2">
                <TagChip name={trimmed || t("labels.dialog.preview")} color={shownColor} className={cn(!trimmed && "opacity-60")} />
              </span>
            </div>
          )}
        </Field>

        {caps.colors && (
          <div className="flex flex-col gap-2">
            <FieldLabel>{t("labels.dialog.colour")}</FieldLabel>
            <ColorSwatchPicker value={shownColor} onChange={setColor} label={t("labels.dialog.colour")} />
          </div>
        )}

        {caps.describe && (
          <Field label={t("labels.dialog.description")} optional hint={t("labels.dialog.descriptionHint")}>
            {({ id }) => (
              <Textarea id={id} rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("labels.dialog.descriptionPlaceholder")} />
            )}
          </Field>
        )}

        {caps.groups && groups.length > 0 && (
          <Field label={t("labels.dialog.group")} hint={groups.find((g) => g.id === group)?.exclusive ? t("labels.dialog.exclusiveHint") : undefined}>
            {({ id }) => (
              <Select
                id={id}
                value={group}
                onChange={setGroup}
                options={[
                  { value: "none", label: t("labels.dialog.noGroup") },
                  ...groups.map((g) => ({
                    value: g.id,
                    label: g.name,
                    icon: <span className={cn("size-2 rounded-xs", tones[g.color ?? "gray"].solid)} />,
                  })),
                ]}
              />
            )}
          </Field>
        )}

        {caps.scope && (
          <div className="flex flex-col gap-2">
            <FieldLabel>{t("labels.dialog.appliesTo")}</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {SCOPES.map((s) => {
                const on = scope.includes(s);
                return (
                  <label
                    key={s}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-[12.5px] transition-colors [&_svg]:size-3.5",
                      on ? "border-line-strong bg-sunken text-fg" : "border-line text-fg-3 hover:border-line-strong",
                    )}
                  >
                    <Checkbox checked={on} onCheckedChange={(v) => setScope((cur) => (v ? [...cur, s] : cur.filter((x) => x !== s)))} aria-label={t(`labels.scope.${s}`)} />
                    <span className="text-fg-3">{scopeIcon[s]}</span>
                    {t(`labels.scope.${s}`)}
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
