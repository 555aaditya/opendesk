-- The widget AI agent (contracts/agent.md): action cards the visitor confirms, visitor
-- ratings of agent replies, and a record of tool calls and handoffs for the report.
ALTER TABLE messages ADD COLUMN ai_action jsonb;
ALTER TABLE messages ADD COLUMN ai_rating text CHECK (ai_rating IN ('up', 'down'));

-- An MCP tool call with policy "confirm" waits here for the visitor's decision. args
-- holds the tool arguments encrypted with the credentials key.
CREATE TABLE ai_widget_actions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id     uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    message_id    uuid REFERENCES messages(id) ON DELETE CASCADE,
    server_id     uuid NOT NULL,
    tool          text NOT NULL,
    title         text NOT NULL,
    summary       text NOT NULL,
    args          bytea NOT NULL,
    status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'confirmed', 'declined', 'expired', 'failed')),
    expires_at    timestamptz NOT NULL,
    decided_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_widget_actions_ticket_idx ON ai_widget_actions (workspace_id, ticket_id, created_at DESC);

-- Tool calls made by the agent: names and outcomes only, never arguments or results.
CREATE TABLE ai_tool_calls (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id     uuid REFERENCES tickets(id) ON DELETE CASCADE,
    tool          text NOT NULL,
    ok            boolean NOT NULL,
    ms            integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_tool_calls_ws_created_idx ON ai_tool_calls (workspace_id, created_at DESC);

ALTER TABLE ai_widget_answers ADD COLUMN handoff boolean NOT NULL DEFAULT false;
CREATE INDEX ai_widget_answers_ws_created_idx ON ai_widget_answers (workspace_id, created_at DESC);
