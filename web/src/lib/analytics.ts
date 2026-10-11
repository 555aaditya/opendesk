// PostHog, only when a key is configured. Autocapture and route pageviews;
// session replay masks every input and anything marked data-ph-mask or
// .ph-no-capture (ticket and message bodies). Custom properties never carry
// PII: ids and enums only.

import type { PostHog } from "posthog-js";
import { config } from "./config";

let ph: PostHog | null = null;

export async function initAnalytics() {
  if (!config.posthogKey || ph) return;
  const { default: posthog } = await import("posthog-js");
  posthog.init(config.posthogKey, {
    api_host: config.posthogHost,
    autocapture: true,
    capture_pageview: false,
    capture_pageleave: true,
    capture_exceptions: true,
    person_profiles: "identified_only",
    mask_all_text: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "[data-ph-mask], .ph-no-capture",
      blockSelector: ".ph-no-capture img",
    },
    sanitize_properties: (props) => {
      // URLs can carry tokens (reset, invite, verify, oauth codes): drop the query.
      for (const k of ["$current_url", "$referrer", "$initial_referrer"]) {
        const v = props[k];
        if (typeof v === "string") props[k] = v.split("?")[0];
      }
      return props;
    },
  });
  ph = posthog;
}

export function pageview(path: string) {
  ph?.capture("$pageview", { $current_url: location.origin + path });
}

export function identify(userId: string, workspaceId: string | null) {
  if (!ph) return;
  ph.identify(userId);
  if (workspaceId) ph.group("workspace", workspaceId);
}

export function resetAnalytics() {
  ph?.reset();
}

/** Product events. Properties must be ids, counts or enums, never names, emails or content. */
export function track(event: string, props?: Record<string, string | number | boolean | null>) {
  ph?.capture(event, props);
}
