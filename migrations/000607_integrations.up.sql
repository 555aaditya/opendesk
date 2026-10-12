-- Integrations: remote MCP servers a workspace connects (contracts/integrations.md).
-- Their tools become Ollie's tools; reads run directly, everything else waits for the
-- user's approval like any other assistant write.
CREATE TABLE integrations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    -- A catalog key (linear, github, ...) or 'custom'.
    provider        text NOT NULL,
    -- Prefix of the tool names Ollie sees, unique in the workspace.
    slug            text NOT NULL,
    name            text NOT NULL,
    url             text NOT NULL,
    auth_type       text NOT NULL CHECK (auth_type IN ('oauth', 'token', 'none')),
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'error')),
    -- AES-GCM (d.Box): {access_token, refresh_token, expires_at} or {token}.
    credentials_enc bytea,
    -- AES-GCM (d.Box): the OAuth client and endpoints this connection uses.
    oauth_enc       bytea,
    -- The server's tools as last listed: [{name, title, description, input_schema, read_only}].
    tools           jsonb NOT NULL DEFAULT '[]',
    disabled_tools  text[] NOT NULL DEFAULT '{}',
    enabled         boolean NOT NULL DEFAULT true,
    last_error      text NOT NULL DEFAULT '',
    synced_at       timestamptz,
    created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, slug)
);
CREATE INDEX integrations_ws_idx ON integrations(workspace_id, created_at);

-- Things in other tools a ticket points at: a Linear issue, a GitHub pull request.
CREATE TABLE ticket_links (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id      uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    integration_id uuid REFERENCES integrations(id) ON DELETE SET NULL,
    provider       text NOT NULL DEFAULT 'custom',
    url            text NOT NULL,
    title          text NOT NULL,
    created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
    -- 'ai' when Ollie made the link on the user's behalf.
    actor_type     text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'ai', 'api')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ticket_id, url)
);
CREATE INDEX ticket_links_ticket_idx ON ticket_links(workspace_id, ticket_id, created_at);
