DO $$
BEGIN
    IF to_regclass('public.ai_embeddings') IS NOT NULL THEN
        DELETE FROM ai_embeddings WHERE kind = 'source';
        ALTER TABLE ai_embeddings DROP CONSTRAINT IF EXISTS ai_embeddings_kind_check;
        ALTER TABLE ai_embeddings ADD CONSTRAINT ai_embeddings_kind_check CHECK (kind IN ('article', 'ticket'));
    END IF;
END
$$;

DROP TABLE IF EXISTS ai_knowledge_exclusions;
DROP TABLE IF EXISTS ai_knowledge_docs;
DROP TABLE IF EXISTS ai_knowledge_sources;
