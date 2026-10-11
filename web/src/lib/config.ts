// Runtime configuration: `window.__OPENDESK__` from /config.js (served by the
// self-hosted binary or generated at deploy), falling back to VITE_* build env.
// One build therefore serves any deployment.

export type RuntimeConfig = {
  apiUrl: string;
  gatewayUrl: string;
  posthogKey: string;
  posthogHost: string;
  turnstileSiteKey: string;
  selfHosted: boolean;
};

declare global {
  interface Window {
    __OPENDESK__?: Partial<Record<keyof RuntimeConfig, string | boolean>>;
  }
}

function pick(key: keyof RuntimeConfig, env: string | undefined): string {
  const v = typeof window !== "undefined" ? window.__OPENDESK__?.[key] : undefined;
  if (typeof v === "string" && v !== "" && !v.startsWith("${")) return v;
  return env ?? "";
}

function trimSlash(s: string) {
  return s.replace(/\/+$/, "");
}

function defaultGateway(): string {
  if (typeof location === "undefined") return "";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/socket`;
}

export function readConfig(): RuntimeConfig {
  const env = import.meta.env;
  const selfHostedRaw = typeof window !== "undefined" ? window.__OPENDESK__?.selfHosted : undefined;
  return {
    apiUrl: trimSlash(pick("apiUrl", env.VITE_API_URL)),
    gatewayUrl: trimSlash(pick("gatewayUrl", env.VITE_GATEWAY_URL)) || defaultGateway(),
    posthogKey: pick("posthogKey", env.VITE_POSTHOG_KEY),
    posthogHost: pick("posthogHost", env.VITE_POSTHOG_HOST) || "https://us.i.posthog.com",
    turnstileSiteKey: pick("turnstileSiteKey", env.VITE_TURNSTILE_SITE_KEY),
    selfHosted: selfHostedRaw === true || selfHostedRaw === "true" || env.VITE_SELF_HOSTED === "1",
  };
}

export const config: RuntimeConfig = readConfig();

// Mock mode is checked inline as `import.meta.env.VITE_MOCK === "1"` at each use,
// so the bundler can drop the mock branches from production builds.
