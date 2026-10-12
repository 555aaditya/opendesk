// The AI agent's setup checklist logic (GET /v1/ai/agent/setup, contracts/agent.md
// "Setup"): progress over the required steps, which steps wait for AI to be on,
// and the one step to suggest next. Kept apart from the component so it is tested.

import type { AgentSetup, AgentSetupStep, AgentSetupStepId } from "@/lib/api/types";

/** Steps that can't be done until AI is on (they call the AI or its settings). */
const NEEDS_AI: ReadonlySet<AgentSetupStepId> = new Set(["playground", "answers_on", "email_answers"]);

/** Done and total of the required steps; optional steps never hold completion back. */
export function setupProgress(s: Pick<AgentSetup, "steps">) {
  const required = s.steps.filter((st) => !st.optional);
  const done = required.filter((st) => st.done).length;
  const total = required.length;
  return { done, total, pct: total ? done / total : 1, complete: done === total };
}

/** The step that has to come first, or null when this one can be done now. */
export function blockedBy(step: AgentSetupStep, steps: AgentSetupStep[]): AgentSetupStepId | null {
  if (step.done || !NEEDS_AI.has(step.id)) return null;
  const ai = steps.find((s) => s.id === "ai_on");
  return ai && !ai.done ? "ai_on" : null;
}

/** The first open required step that can be done now, else the first open optional one. */
export function nextStep(s: Pick<AgentSetup, "steps">): AgentSetupStep | null {
  const open = s.steps.filter((st) => !st.done && !blockedBy(st, s.steps));
  return open.find((st) => !st.optional) ?? open.find((st) => st.optional) ?? null;
}

/** The checklist starts open until every required step is done, then folds away. */
export const startsOpen = (s: Pick<AgentSetup, "steps">) => !setupProgress(s).complete;
