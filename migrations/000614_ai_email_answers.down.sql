DROP TABLE IF EXISTS ai_suggested_replies;
ALTER TABLE mailboxes
    DROP COLUMN IF EXISTS ai_answers_outside_hours,
    DROP COLUMN IF EXISTS ai_answers_mode,
    DROP COLUMN IF EXISTS ai_answers;
