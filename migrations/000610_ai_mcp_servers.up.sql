-- MCP connections: remote MCP servers a workspace connects so the widget agent can use
-- their tools (contracts/agent.md, "MCP connections").
CREATE TABLE ai_mcp_servers (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name           text NOT NULL,
    -- slug names the server in tool names (<slug>__<tool>); fixed at creation.
    slug           text NOT NULL,
    url            text NOT NULL,
    enabled        boolean NOT NULL DEFAULT true,
    auth_kind      text NOT NULL DEFAULT 'none' CHECK (auth_kind IN ('none', 'bearer', 'header', 'oauth')),
    header_name    text,
    -- Bearer token, header value, OAuth client secret and tokens, sealed with d.Box.
    secrets_enc    bytea,
    -- OAuth metadata without secrets: issuer, endpoints, client id, resource, scopes, expiry.
    oauth          jsonb NOT NULL DEFAULT '{}',
    status         text NOT NULL DEFAULT 'connecting'
                   CHECK (status IN ('connected', 'needs_auth', 'error', 'connecting')),
    error          text,
    server_info    jsonb,
    -- tools is the server's last listed tools; tool_settings the admin's choices by tool name.
    tools          jsonb NOT NULL DEFAULT '[]',
    tool_settings  jsonb NOT NULL DEFAULT '{}',
    -- version changes with the URL, auth or credentials, so pooled connections are rebuilt.
    version        integer NOT NULL DEFAULT 1,
    last_synced_at timestamptz,
    created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, slug)
);
CREATE INDEX ai_mcp_servers_workspace_idx ON ai_mcp_servers (workspace_id, created_at, id);

-- A pending OAuth authorization: single use (deleted when redeemed), bound to the server,
-- the admin who started it, the workspace and the starting browser (nonce cookie).
CREATE TABLE ai_mcp_oauth_states (
    state_hash   bytea PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    server_id    uuid NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nonce_hash   bytea NOT NULL,
    -- PKCE verifier and the client and endpoints the authorization was started with, sealed.
    flow_enc     bytea NOT NULL,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_mcp_oauth_states_expires_idx ON ai_mcp_oauth_states (expires_at);
