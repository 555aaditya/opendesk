-- Semantic search storage. pgvector is optional: Neon and the pgvector/pgvector image
-- ship it, stock Postgres may not. Without it the table is not created and search and
-- answer retrieval use Postgres full-text search. The application checks for the table
-- at boot.
DO $$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS vector;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'vector extension unavailable (%); AI search uses full-text search', SQLERRM;
    END;

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        -- The vector column has no fixed dimension, so one table holds every model.
        -- Each row records its model and dimension; queries compare only rows of the
        -- configured model. content is the chunk text used for retrieval context.
        EXECUTE $sql$
            CREATE TABLE IF NOT EXISTS ai_embeddings (
                id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                kind         text NOT NULL CHECK (kind IN ('article', 'ticket')),
                ref_id       uuid NOT NULL,
                chunk        integer NOT NULL,
                content_hash text NOT NULL,
                model        text NOT NULL,
                dims         integer NOT NULL,
                content      text NOT NULL DEFAULT '',
                embedding    vector NOT NULL,
                created_at   timestamptz NOT NULL DEFAULT now(),
                UNIQUE (workspace_id, kind, ref_id, model, chunk)
            )
        $sql$;
        EXECUTE 'CREATE INDEX IF NOT EXISTS ai_embeddings_ws_model_idx ON ai_embeddings (workspace_id, model, kind)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS ai_embeddings_ref_idx ON ai_embeddings (workspace_id, kind, ref_id)';
    END IF;
END
$$;
