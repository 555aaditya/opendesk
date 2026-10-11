import { i18n } from "@/i18n";
import type { ActionType, AutomationTrigger, ConditionField, ConditionOp, Sentiment } from "@/lib/api/types";

export const triggerLabel: Record<AutomationTrigger, string> = {
  ticket_created: "A ticket is created",
  customer_replied: "The customer replies",
  agent_replied: "An agent replies",
  ticket_updated: "A ticket is updated",
};

export const triggerShort: Record<AutomationTrigger, string> = {
  ticket_created: "Ticket created",
  customer_replied: "Customer replied",
  agent_replied: "Agent replied",
  ticket_updated: "Ticket updated",
};

export const fieldLabel: Record<ConditionField, string> = {
  subject: "Subject",
  body: "Message text",
  from_email: "Sender email",
  channel: "Channel",
  mailbox_id: "Mailbox",
  priority: "Priority",
  status: "Status",
  tag: "Tag",
  get sentiment() {
    return i18n.t("ai:automation.sentiment");
  },
};

/** Fields and actions that need the instance's AI (contracts/ai.md). */
export const aiFields: ReadonlySet<ConditionField> = new Set(["sentiment"]);
export const aiActions: ReadonlySet<ActionType> = new Set(["ai_triage"]);

export const sentiments: Sentiment[] = ["positive", "neutral", "negative", "frustrated"];
export function sentimentLabel(s: string): string {
  return (sentiments as string[]).includes(s) ? i18n.t(`ai:sentiment.${s as Sentiment}`) : s;
}

export const opLabel: Record<ConditionOp, string> = {
  contains: "contains",
  not_contains: "doesn't contain",
  equals: "is",
  not_equals: "is not",
  eq: "is",
};

/** Text fields take any operator; enumerated fields only is / is not. */
export function opsFor(field: ConditionField): ConditionOp[] {
  if (field === "sentiment") return ["equals", "not_equals"]; // the API stores "eq" as "equals"
  return field === "subject" || field === "body" || field === "from_email"
    ? ["contains", "not_contains", "equals", "not_equals"]
    : ["equals", "not_equals"];
}

export const actionLabel: Record<ActionType, string> = {
  set_status: "Set status to",
  set_priority: "Set priority to",
  assign_user: "Assign to",
  assign_team: "Assign to team",
  add_tag: "Add tag",
  remove_tag: "Remove tag",
  send_reply: "Send a reply",
  add_note: "Add an internal note",
  mark_spam: "Mark as spam",
  get ai_triage() {
    return i18n.t("ai:automation.ai_triage");
  },
};

export function actionNeedsValue(t: ActionType) {
  return t !== "mark_spam" && t !== "ai_triage";
}

/** Picker items for a builder list: AI entries only when AI is on, but an entry already in use always shows. */
export function offered<K extends string>(keys: K[], ai: ReadonlySet<K>, aiEnabled: boolean, current?: K): K[] {
  return keys.filter((k) => aiEnabled || !ai.has(k) || k === current);
}
