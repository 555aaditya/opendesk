// AI credits in mock mode (contracts/billing.md "Metered credits"): reserve
// the typical cost before a model call, then spend what the call really used
// (model, thread and answer length). Shared by every AI handler.

import type { AIFeature, AIModel } from "@/lib/api/types";
import type { AiUsageRow, WsData } from "./db";
import { db } from "./db";
import { billingOut } from "./handlers/billing";
import { HttpError } from "./router";
import { nowIso } from "./util";

/** Typical credits per call, also the minimum balance to start one. */
export const COSTS: Record<AIFeature, number> = {
  summarize: 1,
  rewrite: 1,
  translate: 1,
  triage: 1,
  decide: 1,
  answer_check: 0.1,
  copilot: 2,
  draft_reply: 3,
  answer: 3,
  playground: 3,
  kb_draft: 5,
  assistant: 2,
};

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
export const FAST_MODEL = "anthropic/claude-haiku-5.5";
export const JEV = "jev";

/** The curated OpenRouter list (contracts/ai.md "Models"); prices include the 1.5 markup at 1 credit = $0.01. */
export const MODELS: AIModel[] = [
  { id: DEFAULT_MODEL, name: "Claude Sonnet 5.5", vendor: "Anthropic", context_length: 1_000_000, credits_per_mtok: { input: 450, output: 2250 } },
  { id: FAST_MODEL, name: "Claude Haiku 5.5", vendor: "Anthropic", context_length: 200_000, credits_per_mtok: { input: 150, output: 750 } },
  { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", vendor: "Anthropic", context_length: 1_000_000, credits_per_mtok: { input: 2250, output: 11250 } },
  { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol", vendor: "OpenAI", context_length: 400_000, credits_per_mtok: { input: 187.5, output: 1500 } },
  { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", vendor: "OpenAI", context_length: 400_000, credits_per_mtok: { input: 37.5, output: 300 } },
  { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", vendor: "Google", context_length: 1_048_576, credits_per_mtok: { input: 45, output: 375 } },
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", vendor: "DeepSeek", context_length: 128_000, credits_per_mtok: { input: 27, output: 165 } },
];

/** How much pricier a model is than Sonnet for the same call. */
const FACTORS: [string, number][] = [
  ["sonnet", 1],
  ["haiku", 0.3],
  ["opus", 3.2],
  ["gpt-5.6-sol", 1.1],
  ["gpt-5.6-luna", 0.25],
  ["gemini-3.8-flash", 0.2],
  ["deepseek-v4.1-flash", 0.12],
  [JEV, 0.05],
];

export function modelFactor(model: string): number {
  return FACTORS.find(([k]) => model.includes(k))?.[1] ?? 1;
}

/** Credits are kept in thousandths; sums are rounded so 12.3 never reads 12.300000001. */
export const round3 = (n: number) => Math.round(n * 1000) / 1000;
const ceil3 = (n: number) => Math.ceil(n * 1000 - 1e-6) / 1000;

const known = (id: string | undefined) => !!id && MODELS.some((m) => m.id === id);

/** The workspace's effective models: its choice, else the instance defaults. */
export function effectiveModels(ws: WsData) {
  const model = known(ws.ai.model) ? ws.ai.model! : DEFAULT_MODEL;
  const fast = known(ws.ai.fast_model) ? ws.ai.fast_model! : FAST_MODEL;
  const widget = known(ws.ai.widget_model) ? ws.ai.widget_model! : model;
  return { model, fast, widget };
}

/** The model a feature runs on (contracts/ai.md "Models and prompts"). */
export function modelFor(ws: WsData, feature: AIFeature): string {
  const m = effectiveModels(ws);
  switch (feature) {
    case "triage":
    case "decide":
    case "answer_check":
      return JEV;
    case "rewrite":
    case "translate":
      return m.fast;
    case "answer":
    case "playground":
      return m.widget;
    default:
      return m.model;
  }
}

/**
 * One metered call: typical × model factor × a length factor, rounded up to
 * 0.001, with token counts that match the model's price.
 */
export function meter(feature: AIFeature, model: string, random: () => number = Math.random): Omit<AiUsageRow, "user_id" | "at"> {
  const length = 0.35 + random() * 1.55;
  const credits = Math.max(0.001, ceil3(COSTS[feature] * modelFactor(model) * length));
  const price = MODELS.find((m) => m.id === model)?.credits_per_mtok;
  if (model === JEV || !price) {
    // Jev charges per input token; output is free.
    return { feature, model, credits, input_tokens: Math.round((credits * 1e6) / 15), output_tokens: 0 };
  }
  // About two thirds of a call's cost is the prompt, a third the answer.
  return {
    feature,
    model,
    credits,
    input_tokens: Math.round((credits * 0.65 * 1e6) / price.input),
    output_tokens: Math.round((credits * 0.35 * 1e6) / price.output),
  };
}

/** Throws 402 no_credits when the balance is below `feature`'s typical cost. */
export function reserve(ws: WsData, feature: AIFeature) {
  billingOut(ws); // derive remaining from the current plan, allowance and packs
  const c = ws.billing.credits;
  if (c.unlimited) return;
  if (c.remaining < COSTS[feature]) {
    throw new HttpError(402, "no_credits", "This workspace has used all of its AI credits for this month.");
  }
}

/**
 * Records a successful call and returns the credits charged. A call that costs
 * more than the balance takes it to 0; the rest is not charged.
 */
export function spend(ws: WsData, feature: AIFeature, userId: string | null = db.meId, model = modelFor(ws, feature)): number {
  const row = meter(feature, model);
  const c = ws.billing.credits;
  if (!c.unlimited) {
    billingOut(ws);
    row.credits = round3(Math.min(row.credits, c.remaining));
    c.used = round3(c.used + row.credits);
  }
  ws.aiUsage.push({ ...row, user_id: userId, at: nowIso() });
  if (!c.unlimited) billingOut(ws);
  return row.credits;
}
