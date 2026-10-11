// End-to-end run against a live stack (API, gateway, web). `make e2e` starts
// the helpers and runs this (env in run.sh). Each flow shares the state `t`.

import { close, shot } from "./lib.mjs";

// "billing" needs the API started with billing on (fake-stripe.mjs), so it only
// runs when named: E2E_ONLY=account,billing.
const all = ["account", "inbox", "tickets", "kb", "widget", "ai", "settings", "danger", "billing"];
const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(",") : all.filter((n) => n !== "billing");

const t = {
  problems: [],
  results: [],
  async step(name, fn) {
    const t0 = Date.now();
    try {
      await fn();
      this.results.push({ name, ok: true, ms: Date.now() - t0 });
      console.log(`  ok   ${name} (${Date.now() - t0} ms)`);
    } catch (e) {
      this.results.push({ name, ok: false, error: e.message });
      for (const [who, p] of [["owner", this.owner?.page], ["agent", this.agent?.page], ["visitor", this.visitor]]) if (p) await shot(p, `FAIL-${who}`).catch(() => {});
      console.log(`  FAIL ${name}: ${e.message.split("\n")[0]}`);
      if (process.env.E2E_BAIL !== "0") throw e;
    }
  },
};

let failed = false;
try {
  for (const name of all.filter((n) => only.includes(n) || only.includes("all"))) {
    console.log(`# ${name}`);
    const mod = await import(`./flows/${name}.mjs`);
    await mod.run(t);
  }
} catch (e) {
  failed = true;
  console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  const problems = t.problems.flat();
  if (problems.length) {
    console.log("\n# browser problems");
    for (const p of problems) console.log("  " + p);
  }
  await close();
}
const bad = t.results.filter((r) => !r.ok).length;
console.log(`\n${t.results.length - bad} passed, ${bad} failed`);
process.exit(failed || bad ? 1 : 0);
