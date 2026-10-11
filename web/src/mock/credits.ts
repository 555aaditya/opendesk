// AI credits in mock mode (contracts/billing.md): reserve before a model call,
// spend after it succeeds. Shared by handlers/ai.ts and handlers/aiTicket.ts.

import type { AIFeature } from "@/lib/api/types";
import type { WsData } from "./db";
import { db } from "./db";
import { billingOut } from "./handlers/billing";
import { HttpError } from "./router";
import { nowIso } from "./util";

export const COSTS: Record<AIFeature, number> = {
  summarize: 1,
  rewrite: 1,
  translate: 1,
  triage: 1,
  copilot: 2,
  draft_reply: 3,
  answer: 3,
  kb_draft: 5,
};

/** Throws 402 no_credits when the workspace can't afford `feature`. */
export function reserve(ws: WsData, feature: AIFeature) {
  billingOut(ws); // derive remaining from the current plan, allowance and packs
  const c = ws.billing.credits;
  if (c.unlimited) return;
  if (c.remaining < COSTS[feature]) {
    throw new HttpError(402, "no_credits", "This workspace has used all of its AI credits for this month.");
  }
}

/** Records a successful call. */
export function spend(ws: WsData, feature: AIFeature, userId: string | null = db.meId) {
  const cost = COSTS[feature];
  ws.aiUsage.push({ feature, user_id: userId, credits: cost, at: nowIso() });
  const c = ws.billing.credits;
  if (c.unlimited) return;
  c.used += cost;
  billingOut(ws);
}
