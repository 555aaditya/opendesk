#!/usr/bin/env node
// Writes <outdir>/config.js for the opendesk-app Pages project.
//
// The self-hosted binary serves /config.js itself (internal/webui RuntimeConfig);
// on Cloudflare Pages there is no server, so deploy.yml writes the same file into
// the build output before uploading it. Keys match the Go JSON tags exactly.
//
//   node deploy/cloudflare/pages/app/write-config.mjs web/dist
//
// Env: APP_API_URL, APP_GATEWAY_URL, WEB_POSTHOG_KEY, WEB_POSTHOG_HOST,
// TURNSTILE_SITE_KEY. The URLs default to production.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULTS = {
  apiUrl: "https://api.opendesk.sh",
  gatewayUrl: "wss://gateway.opendesk.sh/socket",
};

function url(name, value, schemes) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL: ${value}`);
  }
  if (!schemes.includes(u.protocol)) {
    throw new Error(`${name} must use ${schemes.join(" or ")}, got ${u.protocol}`);
  }
  return value.replace(/\/+$/, "");
}

export function buildConfig(env = process.env) {
  const cfg = {
    apiUrl: url("APP_API_URL", env.APP_API_URL || DEFAULTS.apiUrl, ["https:", "http:"]),
    gatewayUrl: url("APP_GATEWAY_URL", env.APP_GATEWAY_URL || DEFAULTS.gatewayUrl, ["wss:", "ws:"]),
  };
  // omitempty, as in the Go struct.
  if (env.WEB_POSTHOG_KEY) cfg.posthogKey = env.WEB_POSTHOG_KEY;
  if (env.WEB_POSTHOG_HOST) cfg.posthogHost = url("WEB_POSTHOG_HOST", env.WEB_POSTHOG_HOST, ["https:"]);
  if (env.TURNSTILE_SITE_KEY) cfg.turnstileSiteKey = env.TURNSTILE_SITE_KEY;
  cfg.selfHosted = false;
  return cfg;
}

export function render(cfg) {
  return `window.__OPENDESK__=${JSON.stringify(cfg)};`;
}

export function writeConfig(outdir, env = process.env) {
  if (!outdir) throw new Error("usage: write-config.mjs <outdir>");
  mkdirSync(outdir, { recursive: true });
  const file = join(outdir, "config.js");
  writeFileSync(file, render(buildConfig(env)) + "\n");
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const file = writeConfig(process.argv[2]);
    console.log(`wrote ${file}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
