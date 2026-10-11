-- Helpdesk bookkeeping: merges, SLA breach markers, CSAT requests, round-robin
-- assignment and visitor-owned uploads.

ALTER TABLE tickets
    ADD COLUMN merged_into_id                 uuid REFERENCES tickets(id) ON DELETE SET NULL,
    ADD COLUMN sla_first_response_breached_at timestamptz,
    ADD COLUMN sla_resolution_breached_at     timestamptz,
    ADD COLUMN csat_requested_at              timestamptz;

-- Uploads from the chat widget belong to the visitor's contact until they are sent.
ALTER TABLE attachments
    ADD COLUMN uploaded_by_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;

-- The last agent picked for each assignment pool (the workspace, or one team).
CREATE TABLE round_robin_cursors (
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    pool          text NOT NULL,
    last_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, pool)
);

CREATE INDEX tickets_ws_created_idx ON tickets(workspace_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX tickets_ws_solved_idx ON tickets(workspace_id, solved_at) WHERE solved_at IS NOT NULL;
CREATE INDEX tickets_snoozed_idx ON tickets(snoozed_until) WHERE snoozed_until IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX tickets_autoclose_idx ON tickets(solved_at) WHERE status = 'solved' AND deleted_at IS NULL;
CREATE INDEX tickets_ws_team_idx ON tickets(workspace_id, team_id) WHERE deleted_at IS NULL;
CREATE INDEX messages_ws_ticket_idx ON messages(workspace_id, ticket_id);
CREATE INDEX attachments_unattached_idx ON attachments(created_at) WHERE message_id IS NULL;
CREATE INDEX activities_ws_type_idx ON activities(workspace_id, type, created_at);
CREATE INDEX contacts_ws_created_idx ON contacts(workspace_id, created_at DESC);
CREATE INDEX contacts_ws_company_idx ON contacts(workspace_id, company_id);
CREATE INDEX kb_articles_ws_status_idx ON kb_articles(workspace_id, status, updated_at DESC);
CREATE INDEX widget_sessions_contact_idx ON widget_sessions(contact_id);
