DROP TABLE IF EXISTS ai_widget_answers;
ALTER TABLE messages DROP COLUMN IF EXISTS ai;
UPDATE activities SET actor_type = 'system' WHERE actor_type = 'ai';
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_actor_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_actor_type_check
    CHECK (actor_type IN ('user', 'system', 'api', 'automation', 'contact'));
