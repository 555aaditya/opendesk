import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BackLink, NoAccess, SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { RichEditor } from "@/components/editor/RichEditor";
import { UnsavedGuard } from "@/components/settings2/UnsavedGuard";
import {
  SinglePick,
  channelItems,
  priorityItems,
  statusItems,
  useMailboxItems,
  useMemberItems,
  useTagItems,
  useTeamItems,
} from "@/components/settings2/pickers";
import {
  actionLabel,
  actionNeedsValue,
  aiActions,
  aiFields,
  fieldLabel,
  offered,
  opLabel,
  opsFor,
  sentimentLabel,
  sentiments,
  triggerLabel,
} from "@/components/settings2/automation";
import { AiIcon } from "@/components/ai/bits";
import { SentimentDot } from "@/components/ai/SentimentDot";
import { useAI } from "@/lib/ai";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Action, ActionType, Automation, AutomationTrigger, Condition, ConditionField, ConditionOp } from "@/lib/api/types";
import { q, qk, removeFromList, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { cn } from "@/lib/cn";

type Draft = { name: string; trigger: AutomationTrigger; conditions: Condition[]; actions: Action[]; enabled: boolean };

const blank: Draft = {
  name: "",
  trigger: "ticket_created",
  conditions: [{ field: "subject", op: "contains", value: "" }],
  actions: [{ type: "add_tag", value: "" }],
  enabled: true,
};

const allFields = Object.keys(fieldLabel) as ConditionField[];
const allActions = Object.keys(actionLabel) as ActionType[];

/** Builder lists; AI fields and actions only when the instance has AI, unless already in use. */
function useFieldItems(current: ConditionField) {
  const { enabled } = useAI();
  return offered(allFields, aiFields, enabled, current).map((f) => ({ value: f, label: fieldLabel[f], icon: aiFields.has(f) ? <AiIcon /> : undefined }));
}
function useActionItems(current: ActionType) {
  const { enabled, cost } = useAI();
  const { t } = useTranslation();
  return offered(allActions, aiActions, enabled, current).map((a) => {
    const n = aiActions.has(a) ? cost("triage") : null;
    return { value: a, label: actionLabel[a], icon: aiActions.has(a) ? <AiIcon /> : undefined, hint: n !== null ? t("credits", { count: n }) : undefined };
  });
}
const triggerItems = (Object.keys(triggerLabel) as AutomationTrigger[]).map((t) => ({ value: t, label: triggerLabel[t] }));

const isEmptyHtml = (h: string) => !h || h.replace(/<[^>]+>/g, "").trim() === "";

export default function AutomationEdit() {
  const { automationId } = useParams({ from: "/app/settings/automations/$automationId" });
  const isNew = automationId === "new";
  const role = useRole();
  const { data: all, isLoading } = useQuery({ ...q.automations(), enabled: atLeast(role, "admin") });
  const existing = all?.find((a) => a.id === automationId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const initial: Draft | null = useMemo(() => {
    if (isNew) return blank;
    if (!existing) return null;
    return { name: existing.name, trigger: existing.trigger, conditions: existing.conditions, actions: existing.actions, enabled: existing.enabled };
  }, [isNew, existing]);

  const [draft, setDraft] = useState<Draft | null>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (initial && !draft) setDraft(initial);
  }, [initial, draft]);

  const dirty = !!draft && !!initial && !saved && JSON.stringify(draft) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = { ...d, name: d.name.trim(), position: existing?.position ?? all?.length ?? 0 };
      return isNew ? api.automations.create(body) : api.automations.update(automationId, body);
    },
    onSuccess: (a: Automation) => {
      upsertInList(qc, qk.automations, a);
      toast.success(isNew ? "Automation created" : "Automation saved");
      setSaved(true);
      if (isNew) setTimeout(() => void navigate({ to: "/settings/automations/$automationId", params: { automationId: a.id }, replace: true }));
      else setDraft({ name: a.name, trigger: a.trigger, conditions: a.conditions, actions: a.actions, enabled: a.enabled });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  useEffect(() => setSaved(false), [existing]);

  if (!atLeast(role, "admin"))
    return (
      <SettingsPage title="Automation">
        <NoAccess what="automations" />
      </SettingsPage>
    );

  const back = <BackLink to="/settings/automations">Automations</BackLink>;

  if (!isNew && !isLoading && !existing)
    return (
      <SettingsPage title="Automation" back={back}>
        <EmptyState lit={3} title="Automation not found" description="It may have been deleted." />
      </SettingsPage>
    );
  if (!draft)
    return (
      <SettingsPage title="Automation" back={back}>
        <div className="flex flex-col gap-3">
          <div className="skeleton h-24 rounded-lg" />
          <div className="skeleton h-32 rounded-lg" />
        </div>
      </SettingsPage>
    );

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const condInvalid = (c: Condition) => !c.value.trim();
  const actInvalid = (a: Action) => actionNeedsValue(a.type) && (a.type === "send_reply" || a.type === "add_note" ? isEmptyHtml(a.value) : !a.value.trim());
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push("Name the automation.");
  if (!draft.actions.length) problems.push("Add at least one action.");
  if (draft.conditions.some(condInvalid)) problems.push("Every condition needs a value, or remove it.");
  if (draft.actions.some(actInvalid)) problems.push("Every action needs a value.");

  const submit = () => {
    setError(null);
    setShowErrors(true);
    if (problems.length) return;
    save.mutate(draft);
  };

  return (
    <SettingsPage
      back={back}
      title={isNew ? "New automation" : draft.name || "Automation"}
      description={isNew ? "Choose when it runs, what has to match, and what it does." : existing ? `Ran ${existing.run_count.toLocaleString()} times` : undefined}
      actions={
        <>
          {!isNew && existing && (
            <Button
              variant="ghost"
              icon={<Trash2 className="size-3.5" />}
              onClick={() =>
                confirm.show(
                  <>
                    <span className="font-medium text-fg">{existing.name}</span> stops running. Tickets it already changed stay as they are.
                  </>,
                  async () => {
                    await api.automations.remove(existing.id);
                    removeFromList(qc, qk.automations, existing.id);
                    setSaved(true);
                    toast.success("Automation deleted");
                    setTimeout(() => void navigate({ to: "/settings/automations" }));
                  },
                  { title: "Delete this automation?", confirmLabel: "Delete", danger: true },
                )
              }
            >
              Delete
            </Button>
          )}
          <Button variant="primary" loading={save.isPending} onClick={submit} disabled={!isNew && !dirty}>
            {isNew ? "Create automation" : "Save"}
          </Button>
        </>
      }
    >
      <UnsavedGuard when={dirty && !save.isPending} />

      <div className="flex items-end gap-4">
        <Field label="Name" className="flex-1" error={showErrors && !draft.name.trim() ? "Name the automation." : undefined}>
          {(p) => <TextInput {...p} autoFocus={isNew} value={draft.name} maxLength={80} placeholder="Route billing mail to the billing team" onChange={(e) => set({ name: e.target.value })} />}
        </Field>
        <label className="flex h-8 items-center gap-2.5 text-[12.5px] text-fg-2">
          {draft.enabled ? "On" : "Off"}
          <Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} aria-label="Automation enabled" />
        </label>
      </div>

      <div className="flex flex-col">
        <Step n={1} title="When">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
            <Select size="sm" value={draft.trigger} onChange={(trigger) => set({ trigger })} options={triggerItems} className="w-[240px]" aria-label="Trigger" />
          </div>
        </Step>

        <Step
          n={2}
          title={draft.conditions.length ? "If all of these match" : "For every ticket"}
          hint={draft.conditions.length ? undefined : "No conditions: the actions run every time."}
        >
          {draft.conditions.map((c, i) => (
            <ConditionRow
              key={i}
              c={c}
              first={i === 0}
              invalid={showErrors && condInvalid(c)}
              onChange={(nc) => set({ conditions: draft.conditions.map((x, j) => (j === i ? nc : x)) })}
              onRemove={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })}
            />
          ))}
          <div className="px-3 py-2">
            <Button
              size="xs"
              variant="ghost"
              icon={<Plus className="size-3" />}
              onClick={() => set({ conditions: [...draft.conditions, { field: "subject", op: "contains", value: "" }] })}
            >
              Add condition
            </Button>
          </div>
        </Step>

        <Step n={3} title="Then" last>
          {draft.actions.map((a, i) => (
            <ActionRow
              key={i}
              a={a}
              invalid={showErrors && actInvalid(a)}
              onChange={(na) => set({ actions: draft.actions.map((x, j) => (j === i ? na : x)) })}
              onRemove={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}
            />
          ))}
          {!draft.actions.length && <p className={cn("px-4 pt-3 text-[12.5px]", showErrors ? "text-danger-fg" : "text-fg-3")}>Add at least one action.</p>}
          <div className="px-3 py-2">
            <Button size="xs" variant="ghost" icon={<Plus className="size-3" />} onClick={() => set({ actions: [...draft.actions, { type: "add_tag", value: "" }] })}>
              Add action
            </Button>
          </div>
        </Step>
      </div>

      {(error || (showErrors && problems.length > 0)) && (
        <div className="-mt-3 rounded-md border border-line px-3 py-2.5 text-[12.5px]">
          {error && <p className="text-danger-fg">{error}</p>}
          {showErrors &&
            problems.map((p) => (
              <p key={p} className="flex items-center gap-2 text-fg-2">
                <span className="size-1.5 rounded-full bg-danger" />
                {p}
              </p>
            ))}
        </div>
      )}
    </SettingsPage>
  );
}

/** One card in the flow, hung on a thin vertical rail with a step dot. */
function Step({ n, title, hint, children, last }: { n: number; title: string; hint?: string; children: ReactNode; last?: boolean }) {
  return (
    <div className="relative pb-5 pl-9 last:pb-0">
      {!last && <span aria-hidden className="absolute bottom-0 left-[11px] top-7 w-px bg-line" />}
      <span
        aria-hidden
        className="mono absolute left-0 top-2 flex size-[23px] items-center justify-center rounded-full border border-line bg-surface text-[10.5px] font-medium text-fg-2 shadow-[0_1px_1px_rgb(0_0_0/0.04)]"
      >
        {n}
      </span>
      <div className="mb-2 flex h-[38px] items-center gap-2">
        <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">{title}</h2>
        {hint && <span className="text-[12px] text-fg-3">{hint}</span>}
      </div>
      <div className="rounded-lg border border-line bg-surface">{children}</div>
    </div>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Tooltip content={label}>
      <button type="button" aria-label={label} onClick={onClick} className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-4 hover:bg-hover hover:text-fg">
        <X className="size-3.5" />
      </button>
    </Tooltip>
  );
}

function ConditionRow({ c, first, invalid, onChange, onRemove }: { c: Condition; first: boolean; invalid: boolean; onChange: (c: Condition) => void; onRemove: () => void }) {
  const ops = opsFor(c.field);
  const fieldItems = useFieldItems(c.field);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
      <span className="w-9 shrink-0 text-[12px] text-fg-4">{first ? "If" : "and"}</span>
      <SinglePick
        items={fieldItems}
        value={c.field}
        onChange={(v) => {
          const field = v as ConditionField;
          const nextOps = opsFor(field);
          onChange({ field, op: nextOps.includes(c.op) ? c.op : nextOps[0], value: "" });
        }}
        placeholder="Field"
        className="w-[140px]"
      />
      <Select<ConditionOp>
        size="sm"
        value={c.op}
        onChange={(op) => onChange({ ...c, op })}
        options={ops.map((o) => ({ value: o, label: opLabel[o] }))}
        className="w-[150px]"
        aria-label="Operator"
      />
      <div className="min-w-[180px] flex-1">
        <ConditionValue c={c} invalid={invalid} onChange={(value) => onChange({ ...c, value })} />
      </div>
      <RemoveButton onClick={onRemove} label="Remove condition" />
    </div>
  );
}

function ConditionValue({ c, invalid, onChange }: { c: Condition; invalid: boolean; onChange: (v: string) => void }) {
  const { t } = useTranslation("ai");
  const mailboxes = useMailboxItems();
  const tags = useTagItems();
  switch (c.field) {
    case "status":
      return <SinglePick items={statusItems} value={c.value} onChange={onChange} placeholder="Choose a status" invalid={invalid} className="w-full" />;
    case "priority":
      return <SinglePick items={priorityItems} value={c.value} onChange={onChange} placeholder="Choose a priority" invalid={invalid} className="w-full" />;
    case "channel":
      return <SinglePick items={channelItems} value={c.value} onChange={onChange} placeholder="Choose a channel" invalid={invalid} className="w-full" />;
    case "mailbox_id":
      return <SinglePick items={mailboxes} value={c.value} onChange={onChange} placeholder="Choose a mailbox" invalid={invalid} width={300} className="w-full" />;
    case "tag":
      return <SinglePick items={tags} value={c.value} onChange={onChange} placeholder="Choose a tag" invalid={invalid} onCreate={onChange} className="w-full" />;
    case "sentiment":
      return (
        <SinglePick
          items={sentiments.map((v) => ({ value: v, label: sentimentLabel(v), icon: <SentimentDot sentiment={v} /> }))}
          value={c.value}
          onChange={onChange}
          placeholder={t("automation.choose_sentiment")}
          invalid={invalid}
          className="w-full"
        />
      );
    default:
      return (
        <TextInput
          inputSize="sm"
          value={c.value}
          invalid={invalid}
          aria-label={`${fieldLabel[c.field]} value`}
          placeholder={c.field === "from_email" ? "@acme.com" : c.field === "subject" ? "refund" : "invoice"}
          onChange={(e) => onChange(e.target.value)}
          className={c.field === "from_email" ? "mono" : undefined}
        />
      );
  }
}

function ActionRow({ a, invalid, onChange, onRemove }: { a: Action; invalid: boolean; onChange: (a: Action) => void; onRemove: () => void }) {
  const { t } = useTranslation("ai");
  const { cost } = useAI();
  const actionItems = useActionItems(a.type);
  const members = useMemberItems();
  const teams = useTeamItems();
  const tags = useTagItems();
  const rich = a.type === "send_reply" || a.type === "add_note";
  const set = (value: string) => onChange({ ...a, value });

  let control: ReactNode = null;
  switch (a.type) {
    case "set_status":
      control = <SinglePick items={statusItems.filter((s) => s.value !== "closed")} value={a.value} onChange={set} placeholder="Choose a status" invalid={invalid} className="w-full" />;
      break;
    case "set_priority":
      control = <SinglePick items={priorityItems} value={a.value} onChange={set} placeholder="Choose a priority" invalid={invalid} className="w-full" />;
      break;
    case "assign_user":
      control = <SinglePick items={members} value={a.value} onChange={set} placeholder="Choose a teammate" invalid={invalid} width={280} className="w-full" />;
      break;
    case "assign_team":
      control = <SinglePick items={teams} value={a.value} onChange={set} placeholder="Choose a team" invalid={invalid} className="w-full" />;
      break;
    case "add_tag":
    case "remove_tag":
      control = (
        <SinglePick items={tags} value={a.value} onChange={set} placeholder="Choose a tag" invalid={invalid} onCreate={a.type === "add_tag" ? set : undefined} className="w-full" />
      );
      break;
    case "mark_spam":
      control = <span className="text-[12px] text-fg-3">Moves the ticket to Spam. No reply is sent.</span>;
      break;
    case "ai_triage": {
      const n = cost("triage");
      control = (
        <span className="text-[12px] text-fg-3">
          {t("automation.ai_triage_hint")}
          {n !== null && <span className="mono ml-1.5 whitespace-nowrap text-[11px] text-fg-4">{t("automation.per_run", { count: n })}</span>}
        </span>
      );
      break;
    }
  }

  return (
    <div className="border-b border-line-soft px-4 py-2.5 last-of-type:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-9 shrink-0 text-[12px] text-fg-4">Do</span>
        <SinglePick
          items={actionItems}
          value={a.type}
          onChange={(v) => onChange({ type: v as ActionType, value: "" })}
          placeholder="Action"
          className="w-[190px]"
          width={240}
        />
        <div className="min-w-[180px] flex-1">{control}</div>
        <RemoveButton onClick={onRemove} label="Remove action" />
      </div>
      {rich && (
        <div
          className={cn(
            "ml-11 mt-2 rounded-md border focus-within:border-fg-3 focus-within:shadow-[0_0_0_3px_var(--focus)]",
            invalid ? "border-danger" : "border-line",
            a.type === "add_note" && "bg-note",
          )}
        >
          <RichEditor
            value={a.value}
            onChange={set}
            placeholder={a.type === "send_reply" ? "Thanks for writing in. We've received your message…" : "Internal note for the team"}
            contentClassName="min-h-[72px]"
            ariaLabel={a.type === "send_reply" ? "Reply text" : "Note text"}
          />
        </div>
      )}
    </div>
  );
}
