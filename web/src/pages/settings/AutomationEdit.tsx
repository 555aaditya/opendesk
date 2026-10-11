import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Plus, Trash2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  TagPick,
  TriggerIcon,
  channelItems,
  priorityItems,
  sentimentItems,
  statusItems,
  triggerItems,
  useMailboxItems,
  useMemberItems,
  useTeamItems,
} from "@/components/settings2/pickers";
import { rowSpring } from "@/components/settings2/motion";
import { actionLabel, actionNeedsValue, aiActions, aiFields, fieldLabel, offered, opLabel, opsFor } from "@/components/settings2/automation";
import { AiIcon } from "@/components/ai/bits";
import { useAI } from "@/lib/ai";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Action, ActionType, Automation, AutomationTrigger, Condition, ConditionField, ConditionOp } from "@/lib/api/types";
import { q, qk, removeFromList, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { cn } from "@/lib/cn";
import { tone, type Tone } from "@/lib/tones";

type Draft = {
  name: string;
  trigger: AutomationTrigger;
  conditions: Condition[];
  actions: Action[];
  enabled: boolean;
};

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
  return offered(allFields, aiFields, enabled, current).map((f) => ({
    value: f,
    label: fieldLabel[f],
    icon: aiFields.has(f) ? <AiIcon /> : undefined,
  }));
}
function useActionItems(current: ActionType) {
  const { enabled, cost } = useAI();
  const { t } = useTranslation();
  return offered(allActions, aiActions, enabled, current).map((a) => {
    const n = aiActions.has(a) ? cost("triage") : null;
    return {
      value: a,
      label: actionLabel[a],
      icon: aiActions.has(a) ? <AiIcon /> : undefined,
      hint: n !== null ? t("credits", { count: n }) : undefined,
    };
  });
}

const isEmptyHtml = (h: string) => !h || h.replace(/<[^>]+>/g, "").trim() === "";

export default function AutomationEdit() {
  const { automationId } = useParams({
    from: "/app/settings/automations/$automationId",
  });
  const isNew = automationId === "new";
  const role = useRole();
  const { data: all, isLoading } = useQuery({
    ...q.automations(),
    enabled: atLeast(role, "admin"),
  });
  const existing = all?.find((a) => a.id === automationId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { t } = useTranslation("settingsInbox");
  const reduce = useReducedMotion();
  // Stable keys for builder rows, so a removed row folds away instead of its neighbour.
  const seq = useRef(0);
  const [condKeys, setCondKeys] = useState<number[]>([]);
  const [actKeys, setActKeys] = useState<number[]>([]);

  const initial: Draft | null = useMemo(() => {
    if (isNew) return blank;
    if (!existing) return null;
    return {
      name: existing.name,
      trigger: existing.trigger,
      conditions: existing.conditions,
      actions: existing.actions,
      enabled: existing.enabled,
    };
  }, [isNew, existing]);

  const [draft, setDraft] = useState<Draft | null>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (initial && !draft) setDraft(initial);
  }, [initial, draft]);
  if (draft && condKeys.length !== draft.conditions.length) setCondKeys(draft.conditions.map(() => seq.current++));
  if (draft && actKeys.length !== draft.actions.length) setActKeys(draft.actions.map(() => seq.current++));

  const dirty = !!draft && !!initial && !saved && JSON.stringify(draft) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = {
        ...d,
        name: d.name.trim(),
        position: existing?.position ?? all?.length ?? 0,
      };
      return isNew ? api.automations.create(body) : api.automations.update(automationId, body);
    },
    onSuccess: (a: Automation) => {
      upsertInList(qc, qk.automations, a);
      toast.success(isNew ? t("edit.created") : t("edit.saved"));
      setSaved(true);
      if (isNew)
        setTimeout(
          () =>
            void navigate({
              to: "/settings/automations/$automationId",
              params: { automationId: a.id },
              replace: true,
            }),
        );
      else
        setDraft({
          name: a.name,
          trigger: a.trigger,
          conditions: a.conditions,
          actions: a.actions,
          enabled: a.enabled,
        });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  useEffect(() => setSaved(false), [existing]);

  if (!atLeast(role, "admin"))
    return (
      <SettingsPage title={t("edit.fallbackTitle")}>
        <NoAccess what="automations" />
      </SettingsPage>
    );

  const back = <BackLink to="/settings/automations">{t("edit.back")}</BackLink>;

  if (!isNew && !isLoading && !existing)
    return (
      <SettingsPage title={t("edit.fallbackTitle")} back={back}>
        <EmptyState
          lit={3}
          title={t("edit.notFound")}
          description={t("edit.notFoundHint")}
          action={
            <Button size="sm" onClick={() => void navigate({ to: "/settings/automations" })}>
              {t("edit.backToList")}
            </Button>
          }
        />
      </SettingsPage>
    );
  if (!draft)
    return (
      <SettingsPage title={t("edit.fallbackTitle")} back={back}>
        <div className="flex flex-col gap-5" aria-busy="true">
          <div className="skeleton h-8 w-2/3 rounded-md" />
          <div className="skeleton h-16 rounded-lg" />
          <div className="skeleton h-28 rounded-lg" />
          <div className="skeleton h-20 rounded-lg" />
        </div>
      </SettingsPage>
    );

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const condInvalid = (c: Condition) => !c.value.trim();
  const actInvalid = (a: Action) => actionNeedsValue(a.type) && (a.type === "send_reply" || a.type === "add_note" ? isEmptyHtml(a.value) : !a.value.trim());
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push(t("edit.problems.name"));
  if (!draft.actions.length) problems.push(t("edit.problems.action"));
  if (draft.conditions.some(condInvalid)) problems.push(t("edit.problems.condition"));
  if (draft.actions.some(actInvalid)) problems.push(t("edit.problems.actionValue"));

  const rowMotion = {
    layout: reduce ? false : ("position" as const),
    initial: reduce ? false : { opacity: 0, y: -4 },
    animate: { opacity: 1, y: 0 },
    exit: reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: { duration: 0.12 } },
    transition: rowSpring,
  };
  const addCondition = () => {
    setCondKeys((k) => [...k, seq.current++]);
    set({
      conditions: [...draft.conditions, { field: "subject", op: "contains", value: "" }],
    });
  };
  const removeCondition = (i: number) => {
    setCondKeys((k) => k.filter((_, j) => j !== i));
    set({ conditions: draft.conditions.filter((_, j) => j !== i) });
  };
  const addAction = () => {
    setActKeys((k) => [...k, seq.current++]);
    set({ actions: [...draft.actions, { type: "add_tag", value: "" }] });
  };
  const removeAction = (i: number) => {
    setActKeys((k) => k.filter((_, j) => j !== i));
    set({ actions: draft.actions.filter((_, j) => j !== i) });
  };

  const submit = () => {
    setError(null);
    setShowErrors(true);
    if (problems.length) return;
    save.mutate(draft);
  };

  return (
    <SettingsPage
      back={back}
      title={isNew ? t("edit.newTitle") : draft.name || t("edit.fallbackTitle")}
      description={isNew ? t("edit.newHint") : existing ? t("edit.ran", { n: existing.run_count.toLocaleString() }) : undefined}
      actions={
        <>
          {!isNew && existing && (
            <Button
              variant="ghost"
              icon={<Trash2 className="size-3.5" />}
              onClick={() =>
                confirm.show(
                  <>
                    <span className="font-medium text-fg">{existing.name}</span> {t("automations.deleteBody")}
                  </>,
                  async () => {
                    await api.automations.remove(existing.id);
                    removeFromList(qc, qk.automations, existing.id);
                    setSaved(true);
                    toast.success(t("edit.deleted"));
                    setTimeout(() => void navigate({ to: "/settings/automations" }));
                  },
                  {
                    title: t("automations.deleteTitle"),
                    confirmLabel: t("common.delete"),
                    danger: true,
                  },
                )
              }
            >
              {t("common.delete")}
            </Button>
          )}
          <Button variant="primary" loading={save.isPending} onClick={submit} disabled={!isNew && !dirty}>
            {isNew ? t("edit.create") : t("edit.save")}
          </Button>
        </>
      }
    >
      <UnsavedGuard when={dirty && !save.isPending} />

      <div className="flex items-end gap-4">
        <Field label={t("edit.nameLabel")} className="flex-1" error={showErrors && !draft.name.trim() ? t("edit.problems.name") : undefined}>
          {(p) => (
            <TextInput
              {...p}
              autoFocus={isNew}
              value={draft.name}
              maxLength={80}
              placeholder={t("edit.namePlaceholder")}
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </Field>
        <label
          className={cn(
            "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors",
            draft.enabled ? tone.green.chip : "bg-hover text-fg-3",
          )}
        >
          <span className={cn("size-1.5 rounded-full", draft.enabled ? tone.green.solid : "bg-fg-4")} aria-hidden />
          {draft.enabled ? t("edit.on") : t("edit.off")}
          <Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} aria-label={t("edit.enabled")} />
        </label>
      </div>

      <div className="flex flex-col">
        <Step n={1} title={t("edit.when")} hue="blue">
          <div className="flex flex-wrap items-center gap-2.5 px-4 py-3">
            <TriggerIcon trigger={draft.trigger} />
            <Select
              size="sm"
              value={draft.trigger}
              onChange={(trigger) => set({ trigger })}
              options={triggerItems()}
              className="w-[240px]"
              aria-label={t("edit.trigger")}
            />
          </div>
        </Step>

        <Step
          n={2}
          hue="amber"
          title={draft.conditions.length ? t("edit.ifAll") : t("edit.everyTicket")}
          hint={draft.conditions.length ? undefined : t("edit.noConditions")}
        >
          <AnimatePresence initial={false}>
            {draft.conditions.map((c, i) => (
              <motion.div key={condKeys[i] ?? `c${i}`} {...rowMotion} className="border-b border-line-soft">
                <ConditionRow
                  c={c}
                  first={i === 0}
                  invalid={showErrors && condInvalid(c)}
                  onChange={(nc) =>
                    set({
                      conditions: draft.conditions.map((x, j) => (j === i ? nc : x)),
                    })
                  }
                  onRemove={() => removeCondition(i)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          <div className="px-3 py-2">
            <Button size="xs" variant="ghost" icon={<Plus className="size-3" />} onClick={addCondition}>
              {t("edit.addCondition")}
            </Button>
          </div>
        </Step>

        <Step n={3} title={t("edit.then")} hue="green" last>
          <AnimatePresence initial={false}>
            {draft.actions.map((a, i) => (
              <motion.div key={actKeys[i] ?? `a${i}`} {...rowMotion} className="border-b border-line-soft">
                <ActionRow
                  a={a}
                  invalid={showErrors && actInvalid(a)}
                  onChange={(na) =>
                    set({
                      actions: draft.actions.map((x, j) => (j === i ? na : x)),
                    })
                  }
                  onRemove={() => removeAction(i)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {!draft.actions.length && <p className={cn("px-4 pt-3 text-[12.5px]", showErrors ? "text-danger-fg" : "text-fg-3")}>{t("edit.problems.action")}</p>}
          <div className="px-3 py-2">
            <Button size="xs" variant="ghost" icon={<Plus className="size-3" />} onClick={addAction}>
              {t("edit.addAction")}
            </Button>
          </div>
        </Step>
      </div>

      {(error || (showErrors && problems.length > 0)) && (
        <div role="alert" className={cn("-mt-3 flex animate-rise-in flex-col gap-1 rounded-lg border px-3.5 py-3 text-[12.5px]", tone.red.line, tone.red.soft)}>
          {error && <p className="text-danger-fg">{error}</p>}
          {showErrors &&
            problems.map((p) => (
              <p key={p} className="flex items-center gap-2 text-fg-2">
                <span className={cn("size-1.5 rounded-full", tone.red.solid)} />
                {p}
              </p>
            ))}
        </div>
      )}
    </SettingsPage>
  );
}

/** One card in the flow, hung on a thin vertical rail with a step dot. */
function Step({ n, title, hint, children, last, hue }: { n: number; title: string; hint?: string; children: ReactNode; last?: boolean; hue: Tone }) {
  return (
    <div className="relative pb-5 pl-9 last:pb-0">
      {!last && <span aria-hidden className="absolute bottom-0 left-[11px] top-7 w-px bg-line" />}
      <span
        aria-hidden
        className={cn("mono absolute left-0 top-2 flex size-6 items-center justify-center rounded-md text-[11px] font-semibold", tone[hue].chip)}
      >
        {n}
      </span>
      <div className="mb-2 flex h-[38px] items-center gap-2">
        <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">{title}</h2>
        {hint && <span className="text-[12px] text-fg-3">{hint}</span>}
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">{children}</div>
    </div>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-4 hover:bg-hover hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
    </Tooltip>
  );
}

function ConditionRow({
  c,
  first,
  invalid,
  onChange,
  onRemove,
}: {
  c: Condition;
  first: boolean;
  invalid: boolean;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("settingsInbox");
  const ops = opsFor(c.field);
  const fieldItems = useFieldItems(c.field);
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <span className="w-9 shrink-0 text-[12px] text-fg-4">{first ? t("edit.if") : t("edit.and")}</span>
      <SinglePick
        items={fieldItems}
        value={c.field}
        onChange={(v) => {
          const field = v as ConditionField;
          const nextOps = opsFor(field);
          onChange({
            field,
            op: nextOps.includes(c.op) ? c.op : nextOps[0],
            value: "",
          });
        }}
        placeholder={t("edit.field")}
        className="w-[140px]"
      />
      <Select<ConditionOp>
        size="sm"
        value={c.op}
        onChange={(op) => onChange({ ...c, op })}
        options={ops.map((o) => ({ value: o, label: opLabel[o] }))}
        className="w-[150px]"
        aria-label={t("edit.operator")}
      />
      <div className="min-w-[180px] flex-1">
        <ConditionValue c={c} invalid={invalid} onChange={(value) => onChange({ ...c, value })} />
      </div>
      <RemoveButton onClick={onRemove} label={t("edit.removeCondition")} />
    </div>
  );
}

function ConditionValue({ c, invalid, onChange }: { c: Condition; invalid: boolean; onChange: (v: string) => void }) {
  const { t } = useTranslation("ai");
  const { t: ts } = useTranslation("settingsInbox");
  const mailboxes = useMailboxItems();
  switch (c.field) {
    case "status":
      return <SinglePick items={statusItems} value={c.value} onChange={onChange} placeholder={ts("edit.chooseStatus")} invalid={invalid} className="w-full" />;
    case "priority":
      return (
        <SinglePick items={priorityItems} value={c.value} onChange={onChange} placeholder={ts("edit.choosePriority")} invalid={invalid} className="w-full" />
      );
    case "channel":
      return (
        <SinglePick items={channelItems} value={c.value} onChange={onChange} placeholder={ts("edit.chooseChannel")} invalid={invalid} className="w-full" />
      );
    case "mailbox_id":
      return (
        <SinglePick
          items={mailboxes}
          value={c.value}
          onChange={onChange}
          placeholder={ts("edit.chooseMailbox")}
          invalid={invalid}
          width={300}
          className="w-full"
        />
      );
    case "tag":
      return <TagPick value={c.value} onChange={onChange} placeholder={ts("edit.chooseTag")} invalid={invalid} onCreate={onChange} className="w-full" />;
    case "sentiment":
      return (
        <SinglePick
          items={sentimentItems()}
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
          aria-label={ts("edit.valueLabel", { field: fieldLabel[c.field] })}
          placeholder={c.field === "from_email" ? "@acme.com" : c.field === "subject" ? "refund" : "invoice"}
          onChange={(e) => onChange(e.target.value)}
          className={c.field === "from_email" ? "mono" : undefined}
        />
      );
  }
}

function ActionRow({ a, invalid, onChange, onRemove }: { a: Action; invalid: boolean; onChange: (a: Action) => void; onRemove: () => void }) {
  const { t } = useTranslation("ai");
  const { t: ts } = useTranslation("settingsInbox");
  const { cost } = useAI();
  const actionItems = useActionItems(a.type);
  const members = useMemberItems();
  const teams = useTeamItems();
  const rich = a.type === "send_reply" || a.type === "add_note";
  const set = (value: string) => onChange({ ...a, value });

  let control: ReactNode = null;
  switch (a.type) {
    case "set_status":
      control = (
        <SinglePick
          items={statusItems.filter((s) => s.value !== "closed")}
          value={a.value}
          onChange={set}
          placeholder={ts("edit.chooseStatus")}
          invalid={invalid}
          className="w-full"
        />
      );
      break;
    case "set_priority":
      control = (
        <SinglePick items={priorityItems} value={a.value} onChange={set} placeholder={ts("edit.choosePriority")} invalid={invalid} className="w-full" />
      );
      break;
    case "assign_user":
      control = (
        <SinglePick items={members} value={a.value} onChange={set} placeholder={ts("edit.chooseTeammate")} invalid={invalid} width={280} className="w-full" />
      );
      break;
    case "assign_team":
      control = <SinglePick items={teams} value={a.value} onChange={set} placeholder={ts("edit.chooseTeam")} invalid={invalid} className="w-full" />;
      break;
    case "add_tag":
    case "remove_tag":
      control = (
        <TagPick
          value={a.value}
          onChange={set}
          placeholder={ts("edit.chooseTag")}
          invalid={invalid}
          onCreate={a.type === "add_tag" ? set : undefined}
          className="w-full"
        />
      );
      break;
    case "mark_spam":
      control = <span className="text-[12px] text-fg-3">{ts("edit.markSpamHint")}</span>;
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
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-9 shrink-0 text-[12px] text-fg-4">{ts("edit.do")}</span>
        <SinglePick
          items={actionItems}
          value={a.type}
          onChange={(v) => onChange({ type: v as ActionType, value: "" })}
          placeholder={ts("edit.action")}
          className="w-[190px]"
          width={240}
        />
        <div className="min-w-[180px] flex-1">{control}</div>
        <RemoveButton onClick={onRemove} label={ts("edit.removeAction")} />
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
            placeholder={a.type === "send_reply" ? ts("edit.replyPlaceholder") : ts("edit.notePlaceholder")}
            contentClassName="min-h-[72px]"
            ariaLabel={a.type === "send_reply" ? ts("edit.replyText") : ts("edit.noteText")}
          />
        </div>
      )}
    </div>
  );
}
