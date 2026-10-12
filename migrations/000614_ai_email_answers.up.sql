-- Ollie answers email (contracts/agent.md "Email"): opt-in per mailbox, off by default.
-- ai_answers_mode: draft = a suggested reply a teammate sends, edits or discards;
-- send = Ollie replies by email and hands off when unsure.
ALTER TABLE mailboxes
    ADD COLUMN ai_answers boolean NOT NULL DEFAULT false,
    ADD COLUMN ai_answers_mode text NOT NULL DEFAULT 'draft' CHECK (ai_answers_mode IN ('draft', 'send')),
    ADD COLUMN ai_answers_outside_hours boolean NOT NULL DEFAULT false;

-- Ollie's suggested replies on email tickets (draft mode). At most one pending per
-- ticket; a newer one supersedes it.
CREATE TABLE ai_suggested_replies (
    id            uuid PRIMARY KEY,
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id     uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    message_id    uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    body_html     text NOT NULL,
    sources       jsonb NOT NULL DEFAULT '[]',
    tools         text[] NOT NULL DEFAULT '{}',
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'discarded', 'superseded')),
    reply_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
    decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    decided_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_suggested_replies_pending_uq ON ai_suggested_replies (ticket_id) WHERE status = 'pending';
CREATE INDEX ai_suggested_replies_ws_created_idx ON ai_suggested_replies (workspace_id, created_at DESC);
