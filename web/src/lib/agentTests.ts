// The agent quality loop on the client (contracts/agent.md "Tests", "Review
// queue"): how a test stands, the pass rate, and the realtime events that keep
// the tests, runs and review caches live.

import type { QueryClient } from "@tanstack/react-query";
import type { AgentTest, AgentTestResult, AgentTestRun, AgentTestStatus } from "./api/types";
import { qk, removeFromList, upsertInList } from "./queries";

export const MAX_TESTS = 200;
export const MAX_TEST_MESSAGES = 6;
export const MAX_EXPECTATIONS = 10;
export const EXPECTATION_MAX = 1000;

/** Where a test stands for the list: its latest result, or queued in the active run. */
export type TestState = "passed" | "failed" | "error" | "queued" | "never";

const FINAL: ReadonlySet<AgentTestStatus> = new Set(["passed", "failed", "error"]);

export const isFinal = (s: AgentTestStatus) => FINAL.has(s);

/** A run that has not ended. */
export function activeRun(runs: AgentTestRun[] | undefined): AgentTestRun | null {
  return runs?.find((r) => r.status === "queued" || r.status === "running") ?? null;
}

export function testState(t: AgentTest, run: AgentTestRun | null): TestState {
  if (run && run.test_ids.includes(t.id) && t.last_result?.run_id !== run.id) return "queued";
  const s = t.last_result?.status;
  return s === "passed" || s === "failed" || s === "error" ? s : "never";
}

/** Passed before and fails now. */
export function newlyFailing(r: AgentTestResult | null | undefined): boolean {
  return !!r && (r.status === "failed" || r.status === "error") && r.previous_status === "passed";
}

/** Tests with a result, and how many of them pass. */
export function passRate(tests: AgentTest[]): { passed: number; ran: number; rate: number | null } {
  let passed = 0;
  let ran = 0;
  for (const t of tests) {
    const s = t.last_result?.status;
    if (!s || !isFinal(s)) continue;
    ran++;
    if (s === "passed") passed++;
  }
  return { passed, ran, rate: ran ? passed / ran : null };
}

/** How far a run got. */
export function runProgress(r: AgentTestRun): number {
  return r.total ? (r.passed + r.failed + r.errored) / r.total : 0;
}

/** Tool keys as the agent names them: `<server_slug>__<tool>` (contracts/agent.md). */
export function toolKey(slug: string, name: string): string {
  const k = `${slug.replace(/[^a-zA-Z0-9_-]+/g, "_")}__${name.replace(/[^a-zA-Z0-9_-]+/g, "_")}`.slice(0, 64);
  return k.replace(/^[_-]+|[_-]+$/g, "");
}

/** Applies ai_agent_test*, ai_agent_test_run* and ai_agent_review* events to the cache. */
export function applyAgentQualityEvent(qc: QueryClient, type: string, d: Record<string, unknown>) {
  switch (type) {
    case "ai_agent_test.created":
    case "ai_agent_test.updated": {
      const t = d.test as AgentTest | undefined;
      if (t) upsertInList(qc, qk.agentTests, t);
      else void qc.invalidateQueries({ queryKey: qk.agentTests });
      return;
    }
    case "ai_agent_test.deleted":
      if (typeof d.test_id === "string") removeFromList(qc, qk.agentTests, d.test_id);
      return;
    case "ai_agent_test_run.created":
    case "ai_agent_test_run.updated": {
      const r = d.run as AgentTestRun | undefined;
      if (!r) return void qc.invalidateQueries({ queryKey: qk.agentTestRuns });
      const { results: _drop, ...run } = r;
      void _drop;
      upsertInList(qc, qk.agentTestRuns, run, { prepend: true });
      qc.setQueryData<AgentTestRun>(qk.agentTestRun(run.id), (old) => (old ? { ...old, ...run, results: old.results } : old));
      return;
    }
    case "ai_agent_test_result.updated": {
      const res = d.result as AgentTestResult | undefined;
      if (!res) return;
      if (isFinal(res.status)) {
        qc.setQueryData<AgentTest[]>(qk.agentTests, (old) => old?.map((t) => (t.id === res.test_id ? { ...t, last_result: res } : t)));
      }
      qc.setQueryData<AgentTestRun>(qk.agentTestRun(res.run_id), (old) =>
        old?.results ? { ...old, results: old.results.map((x) => (x.test_id === res.test_id ? res : x)) } : old,
      );
      return;
    }
    case "ai_agent_review.updated":
      if (typeof d.message_id === "string") removeFromList(qc, qk.agentReview, d.message_id);
      return;
  }
}
