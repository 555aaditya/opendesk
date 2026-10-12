import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import "@/i18n";
import type { AgentSetup, AgentSetupStep, AgentSetupStepId } from "@/lib/api/types";
import { AgentSetupCard } from "./SetupChecklist";
import { blockedBy, nextStep, setupProgress, startsOpen } from "./setup";

const ORDER: AgentSetupStepId[] = ["ai_on", "identity", "knowledge", "tools", "playground", "widget", "answers_on", "email_answers"];
const OPTIONAL = new Set<AgentSetupStepId>(["tools", "email_answers"]);

const setupOf = (done: AgentSetupStepId[], ids = ORDER): AgentSetup => {
  const steps: AgentSetupStep[] = ids.map((id) => ({ id, title: id, description: `why ${id}`, done: done.includes(id), optional: OPTIONAL.has(id), href: `/settings/x/${id}` }));
  const p = setupProgress({ steps });
  return { steps, done_count: p.done, total: p.total, complete: p.complete };
};

const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
const render = (s: AgentSetup) =>
  renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <AgentSetupCard setup={s} />
    </RouterContextProvider>,
  );

describe("agent setup progress", () => {
  it("counts required steps only", () => {
    expect(setupProgress(setupOf([]))).toEqual({ done: 0, total: 6, pct: 0, complete: false });
    expect(setupProgress(setupOf(["ai_on", "tools", "email_answers"]))).toMatchObject({ done: 1, total: 6, complete: false });
  });

  it("is complete without the optional steps", () => {
    const s = setupOf(["ai_on", "identity", "knowledge", "playground", "widget", "answers_on"]);
    expect(setupProgress(s).complete).toBe(true);
    expect(startsOpen(s)).toBe(false);
    expect(startsOpen(setupOf(["ai_on"]))).toBe(true);
  });

  it("treats an empty list as complete", () => {
    expect(setupProgress({ steps: [] })).toEqual({ done: 0, total: 0, pct: 1, complete: true });
  });

  it("holds AI steps until AI is on", () => {
    const s = setupOf([]);
    const step = (id: AgentSetupStepId) => s.steps.find((x) => x.id === id)!;
    expect(blockedBy(step("playground"), s.steps)).toBe("ai_on");
    expect(blockedBy(step("answers_on"), s.steps)).toBe("ai_on");
    expect(blockedBy(step("email_answers"), s.steps)).toBe("ai_on");
    expect(blockedBy(step("knowledge"), s.steps)).toBeNull();
    const on = setupOf(["ai_on"]);
    expect(blockedBy(on.steps.find((x) => x.id === "playground")!, on.steps)).toBeNull();
  });

  it("suggests the first open required step that can be done now", () => {
    expect(nextStep(setupOf([]))?.id).toBe("ai_on");
    expect(nextStep(setupOf(["ai_on", "identity"]))?.id).toBe("knowledge");
    // Optional tools are skipped while a required step is open.
    expect(nextStep(setupOf(["ai_on", "identity", "knowledge"]))?.id).toBe("playground");
    // Only optional steps left: suggest the first.
    expect(nextStep(setupOf(["ai_on", "identity", "knowledge", "playground", "widget", "answers_on"]))?.id).toBe("tools");
    expect(nextStep(setupOf(ORDER))).toBeNull();
  });

  it("works without the email step on instances that lack it", () => {
    const s = setupOf(["ai_on"], ORDER.slice(0, 7));
    expect(setupProgress(s).total).toBe(6);
    expect(s.steps.some((x) => x.id === "email_answers")).toBe(false);
  });
});

describe("agent setup card", () => {
  it("shows progress, optional pills, and the AI gate", () => {
    const html = render(setupOf(["identity"]));
    expect(html).toContain("1 of 6 required steps done");
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain("Optional");
    expect(html).toContain("Turn on AI first");
    expect(html).toContain('href="/settings/x/ai_on"');
    // A blocked step offers no action.
    expect(html).not.toContain('href="/settings/x/playground"');
    // A done step offers no action either.
    expect(html).not.toContain('href="/settings/x/identity"');
  });

  it("folds into one line once complete", () => {
    const html = render(setupOf(["ai_on", "identity", "knowledge", "playground", "widget", "answers_on"]));
    expect(html).toContain("Your agent is set up");
    expect(html).toContain("Show steps");
    expect(html).not.toContain('data-step="ai_on"');
  });
});
