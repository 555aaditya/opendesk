import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { buildConfig, writeConfig } from "./write-config.mjs";

test("defaults to production URLs and leaves optional keys out", () => {
  assert.deepEqual(buildConfig({}), {
    apiUrl: "https://api.opendesk.sh",
    gatewayUrl: "wss://gateway.opendesk.sh/socket",
    selfHosted: false,
  });
});

test("reads every key from the environment", () => {
  const cfg = buildConfig({
    APP_API_URL: "https://api.example.com/",
    APP_GATEWAY_URL: "wss://gw.example.com/socket",
    WEB_POSTHOG_KEY: "phc_x",
    WEB_POSTHOG_HOST: "https://us.i.posthog.com",
    TURNSTILE_SITE_KEY: "0x4AAA",
  });
  assert.deepEqual(cfg, {
    apiUrl: "https://api.example.com",
    gatewayUrl: "wss://gw.example.com/socket",
    posthogKey: "phc_x",
    posthogHost: "https://us.i.posthog.com",
    turnstileSiteKey: "0x4AAA",
    selfHosted: false,
  });
});

test("refuses a gateway URL that is not a websocket", () => {
  assert.throws(() => buildConfig({ APP_GATEWAY_URL: "https://gw.example.com" }), /APP_GATEWAY_URL/);
  assert.throws(() => buildConfig({ APP_API_URL: "not a url" }), /APP_API_URL/);
});

test("writes a config.js that sets window.__OPENDESK__", () => {
  const dir = mkdtempSync(join(tmpdir(), "od-config-"));
  const file = writeConfig(dir, { WEB_POSTHOG_KEY: "phc_</script>" });
  const src = readFileSync(file, "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  assert.equal(ctx.window.__OPENDESK__.apiUrl, "https://api.opendesk.sh");
  assert.equal(ctx.window.__OPENDESK__.posthogKey, "phc_</script>");
  assert.equal(ctx.window.__OPENDESK__.selfHosted, false);
});

test("needs an output directory", () => {
  assert.throws(() => writeConfig(undefined, {}), /usage/);
});
