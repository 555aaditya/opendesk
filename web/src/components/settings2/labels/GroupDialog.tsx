// Create or edit a label group, and merge one label into another.

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TagChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Label as FieldLabel, TextInput } from "@/components/ui/input";
import { Picker } from "@/components/ui/picker";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { tone as tones, type Tone } from "@/lib/tones";
import { ColorSwatchPicker } from "../ColorSwatchPicker";
import type { Label, LabelGroup } from "./model";

export type GroupInput = { name: string; color: Tone | null; exclusive: boolean };

export function GroupDialog({ group, onClose, onSave }: { group: LabelGroup | null; onClose: () => void; onSave: (v: GroupInput) => Promise<unknown> }) {
  const { t } = useTranslation("settings");
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState<Tone | null>(group?.color ?? null);
  const [exclusive, setExclusive] = useState(group?.exclusive ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return setError(t("labels.group.nameRequired"));
    setBusy(true);
    try {
      await onSave({ name: name.trim(), color, exclusive });
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
      size="sm"
      onOpenChange={(o) => !o && onClose()}
      title={group ? t("labels.group.editTitle") : t("labels.group.newTitle")}
      description={t("labels.group.description")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {group ? t("labels.group.save") : t("labels.group.create")}
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
        <Field label={t("labels.group.name")} error={error}>
          {({ id, invalid }) => (
            <TextInput id={id} autoFocus invalid={invalid} value={name} maxLength={50} placeholder={t("labels.group.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <div className="flex flex-col gap-2">
          <FieldLabel optional>{t("labels.dialog.colour")}</FieldLabel>
          <ColorSwatchPicker value={color} onChange={(c) => setColor((cur) => (cur === c ? null : c))} size="sm" label={t("labels.dialog.colour")} />
        </div>
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-line px-3 py-2.5">
          <span>
            <span className="block text-[12.5px] font-medium">{t("labels.group.exclusive")}</span>
            <span className="mt-0.5 block text-xs text-fg-3">{t("labels.group.exclusiveHint")}</span>
          </span>
          <Switch checked={exclusive} onCheckedChange={setExclusive} aria-label={t("labels.group.exclusive")} />
        </label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function MergeDialog({ label, labels, onClose, onMerge }: { label: Label; labels: Label[]; onClose: () => void; onMerge: (intoId: string) => Promise<unknown> }) {
  const { t } = useTranslation("settings");
  const [into, setInto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = labels.find((l) => l.id === into);
  const items = labels
    .filter((l) => l.id !== label.id && !l.archived)
    .map((l) => ({ value: l.id, label: l.name, icon: <span className={cn("size-2 rounded-xs", tones[l.color].solid)} /> }));
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && onClose()}
      title={t("labels.merge.title")}
      description={t("labels.merge.description", { name: label.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="danger-solid"
            disabled={!into}
            loading={busy}
            onClick={async () => {
              if (!into) return;
              setBusy(true);
              try {
                await onMerge(into);
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("labels.merge.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <div className="flex items-center gap-2.5 rounded-md border border-line bg-sunken px-3 py-3">
          <TagChip name={label.name} color={label.color} />
          <ArrowRight className="size-3.5 text-fg-4" />
          <Picker
            items={items}
            value={into}
            onSelect={setInto}
            placeholder={t("labels.merge.search")}
            trigger={
              <Button size="sm" className="font-normal">
                {target ? <TagChip name={target.name} color={target.color} /> : t("labels.merge.choose")}
              </Button>
            }
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger-fg">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
