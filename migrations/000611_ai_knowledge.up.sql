-- Knowledge sources for the AI (contracts/agent.md "Knowledge sources"): crawled
-- websites, uploaded files and Q&A snippets, split into documents the agent, drafts and
-- copilot retrieve from (FTS here, embeddings in ai_embeddings kind 'source').
CREATE TABLE ai_knowledge_sources (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('website', 'file', 'snippet')),
    name            text NOT NULL,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'ready', 'error')),
    error           text,
    enabled         boolean NOT NULL DEFAULT true,
    -- {website: {...}} | {file: {...}} | {snippet: {...}}, as in the API.
    config          jsonb NOT NULL DEFAULT '{}',
    -- Bumped by every change of config, so a running sync knows it is stale.
    version         integer NOT NULL DEFAULT 1,
    storage_key     text,
    doc_count       integer NOT NULL DEFAULT 0,
    char_count      bigint NOT NULL DEFAULT 0,
    sync_started_at timestamptz,
    last_synced_at  timestamptz,
    created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_knowledge_sources_ws_idx ON ai_knowledge_sources (workspace_id, created_at, id);
CREATE INDEX ai_knowledge_sources_status_idx ON ai_knowledge_sources (status, kind);

-- One document per website page, file part or snippet. key identifies it within its
-- source (the page URL, "part-<n>", "snippet") so a re-sync updates it in place.
CREATE TABLE ai_knowledge_docs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_id    uuid NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
    key          text NOT NULL,
    url          text,
    title        text NOT NULL DEFAULT '',
    content      text NOT NULL DEFAULT '',
    chars        integer NOT NULL DEFAULT 0,
    content_hash text NOT NULL,
    search       tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', left(coalesce(content, ''), 200000)), 'B')
    ) STORED,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id, key)
);
CREATE INDEX ai_knowledge_docs_ws_idx ON ai_knowledge_docs (workspace_id, source_id);
CREATE INDEX ai_knowledge_docs_search_idx ON ai_knowledge_docs USING gin (search);

-- Pages removed through the API, skipped by later crawls of the same source.
CREATE TABLE ai_knowledge_exclusions (
    source_id    uuid NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key          text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, key)
);

-- ai_embeddings exists only with pgvector (000501); extend its kinds when it does.
DO $$
BEGIN
    IF to_regclass('public.ai_embeddings') IS NOT NULL THEN
        ALTER TABLE ai_embeddings DROP CONSTRAINT IF EXISTS ai_embeddings_kind_check;
        ALTER TABLE ai_embeddings ADD CONSTRAINT ai_embeddings_kind_check CHECK (kind IN ('article', 'ticket', 'source'));
    END IF;
END
$$;
