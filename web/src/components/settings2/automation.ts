import { i18n } from "@/i18n";
import type { ActionType, AutomationTrigger, ConditionField, ConditionOp, Sentiment } from "@/lib/api/types";
import type { Tone } from "@/lib/tones";

const tr = i18n.t as unknown as (key: string) => string;

/** A label table read from the settingsInbox catalog on access, so it follows the loaded language. */
function labels<K extends string>(keys: readonly K[], group: string): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of keys)
    Object.defineProperty(out, k, {
      get: () => tr(`settingsInbox:${group}.${k}`),
      enumerable: true,
    });
  return out;
}

const triggers = ["ticket_created", "customer_replied", "agent_replied", "ticket_updated"] as const satisfies readonly AutomationTrigger[];

export const triggerLabel: Record<AutomationTrigger, string> = labels(triggers, "triggers");
export const triggerShort: Record<AutomationTrigger, string> = labels(triggers, "triggersShort");

/** Each trigger keeps one hue across the list and the builder. */
export const triggerTone: Record<AutomationTrigger, Tone> = {
  ticket_created: "blue",
  customer_replied: "teal",
  agent_replied: "indigo",
  ticket_updated: "amber",
};

const plainFields = ["subject", "body", "from_email", "channel", "mailbox_id", "priority", "status", "tag"] as const;
export const fieldLabel: Record<ConditionField, string> = Object.defineProperty(labels(plainFields, "fields"), "sentiment", {
  get: () => i18n.t("ai:automation.sentiment"),
  enumerable: true,
}) as Record<ConditionField, string>;

/** Fields and actions that need the instance's AI (contracts/ai.md). */
export const aiFields: ReadonlySet<ConditionField> = new Set(["sentiment"]);
export const aiActions: ReadonlySet<ActionType> = new Set(["ai_triage"]);

export const sentiments: Sentiment[] = ["positive", "neutral", "negative", "frustrated"];
export function sentimentLabel(s: string): string {
  return (sentiments as string[]).includes(s) ? i18n.t(`ai:sentiment.${s as Sentiment}`) : s;
}

export const opLabel: Record<ConditionOp, string> = labels(["contains", "not_contains", "equals", "not_equals", "eq"] as const, "ops");

/** Text fields take any operator; enumerated fields only is / is not. */
export function opsFor(field: ConditionField): ConditionOp[] {
  if (field === "sentiment") return ["equals", "not_equals"]; // the API stores "eq" as "equals"
  return field === "subject" || field === "body" || field === "from_email" ? ["contains", "not_contains", "equals", "not_equals"] : ["equals", "not_equals"];
}

const plainActions = ["set_status", "set_priority", "assign_user", "assign_team", "add_tag", "remove_tag", "set_field", "send_reply", "add_note", "mark_spam"] as const;
export const actionLabel: Record<ActionType, string> = Object.defineProperty(labels(plainActions, "actionTypes"), "ai_triage", {
  get: () => i18n.t("ai:automation.ai_triage"),
  enumerable: true,
}) as Record<ActionType, string>;

/** Whether the action's `value` must be filled. set_field may write "" to clear, so it needs only its field. */
export function actionNeedsValue(t: ActionType) {
  return t !== "mark_spam" && t !== "ai_triage" && t !== "set_field";
}

/** Picker items for a builder list: AI entries only when AI is on, but an entry already in use always shows. */
export function offered<K extends string>(keys: K[], ai: ReadonlySet<K>, aiEnabled: boolean, current?: K): K[] {
  return keys.filter((k) => aiEnabled || !ai.has(k) || k === current);
}
