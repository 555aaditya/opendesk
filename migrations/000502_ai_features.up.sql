-- AI attribution: activities written by AI features, and replies posted by the widget
-- answer bot.
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_actor_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_actor_type_check
    CHECK (actor_type IN ('user', 'system', 'api', 'automation', 'contact', 'ai'));

ALTER TABLE messages ADD COLUMN ai boolean NOT NULL DEFAULT false;

-- One row per visitor message the widget answer bot handled, so a message is answered
-- at most once even when a job is retried. answered = false records a decline.
CREATE TABLE ai_widget_answers (
    message_id    uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id     uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    answered      boolean NOT NULL,
    reply_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
    article_ids   uuid[] NOT NULL DEFAULT '{}',
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_widget_answers_ticket_idx ON ai_widget_answers (ticket_id, created_at);
