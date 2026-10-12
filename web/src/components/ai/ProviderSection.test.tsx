import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "@/i18n";
import type { AIProviderKey } from "@/lib/api/types";
import { SavedKey } from "./ProviderSection";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const key = (patch: Partial<AIProviderKey> = {}): AIProviderKey => ({
  kind: "openrouter",
  base_url_host: "",
  last4: "WXYZ",
  model: "anthropic/claude-sonnet-5.5",
  fast_model: "anthropic/claude-haiku-5.5",
  status: "ok",
  status_at: null,
  created_by: { id: "u1", name: "Anna Lee", email: "anna@example.com", avatar_url: null },
  created_at: ago(3 * 86_400_000),
  updated_at: ago(3 * 86_400_000),
  ...patch,
});
const render = (k: AIProviderKey) => renderToStaticMarkup(<SavedKey k={k} onReplace={() => {}} onRemove={() => {}} />);

describe("saved provider key", () => {
  it("shows the provider, the last 4 characters and who added it", () => {
    const html = render(key());
    expect(html).toContain("OpenRouter key ending in WXYZ");
    expect(html).toContain("Working");
    expect(html).toContain("Added by Anna Lee 3 days ago");
    expect(html).not.toContain("role=\"alert\"");
  });

  it("explains a rejected key with when it happened and a fix", () => {
    const html = render(key({ status: "rejected", status_at: ago(2 * 60_000) }));
    expect(html).toContain("Rejected by OpenRouter 2 minutes ago");
    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Replace key");
  });

  it("names an OpenAI-compatible endpoint by its host", () => {
    const html = render(key({ kind: "openai", base_url_host: "llm.example.com", last4: "1234", status: "no_funds", status_at: ago(60 * 60_000) }));
    expect(html).toContain("llm.example.com, key ending in 1234");
    expect(html).toContain("Out of funds at the endpoint 1 hour ago");
  });
});
