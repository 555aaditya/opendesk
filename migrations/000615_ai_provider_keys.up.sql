-- A workspace's own AI provider key (contracts/ai.md, "Provider per workspace"). One row
-- per workspace; no row means the workspace uses the instance's provider and credits.
CREATE TABLE ai_provider_keys (
    workspace_id  uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    kind          text NOT NULL CHECK (kind IN ('openrouter', 'openai', 'anthropic')),
    -- base_url is set for OpenAI-compatible endpoints only (https, public host).
    base_url      text NOT NULL DEFAULT '',
    -- The API key, sealed with d.Box. Only its last 4 characters are ever shown.
    key_enc       bytea NOT NULL,
    key_last4     text NOT NULL,
    -- Default models on this provider ("" = the provider's usual default). Required for
    -- OpenAI-compatible endpoints, which have no usual default.
    model         text NOT NULL DEFAULT '',
    fast_model    text NOT NULL DEFAULT '',
    -- status is what the provider last said about the key; notified_at dedupes the admin
    -- notification when it fails.
    status        text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'rejected', 'no_funds')),
    status_at     timestamptz,
    notified_at   timestamptz,
    created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Which key paid for a call: 'credits' (the instance's provider, charged) or 'own_key'
-- (the workspace's key, recorded with 0 credits).
ALTER TABLE ai_usage ADD COLUMN source text NOT NULL DEFAULT 'credits' CHECK (source IN ('credits', 'own_key'));
