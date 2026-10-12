-- OAuth 2.1 for opendesk's MCP server (contracts/agent.md "opendesk MCP server", OAuth):
-- clients that registered themselves (RFC 7591), authorization requests and their
-- codes, grants (a user connected an AI client to one workspace) and refresh tokens.
-- Codes, client secrets and refresh tokens are stored as SHA-256 hashes only.

CREATE TABLE oauth_clients (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    uri           text NOT NULL DEFAULT '',
    redirect_uris text[] NOT NULL,
    auth_method   text NOT NULL DEFAULT 'none'
                  CHECK (auth_method IN ('none', 'client_secret_post', 'client_secret_basic')),
    secret_hash   bytea,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz,
    CHECK ((auth_method = 'none') = (secret_hash IS NULL))
);
CREATE INDEX oauth_clients_created_idx ON oauth_clients (created_at);

-- A grant: one user connected one client to one workspace with these scopes, for the
-- resource (the MCP server URL). Revoking it ends every token issued under it.
CREATE TABLE oauth_grants (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id     uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    scopes        text[] NOT NULL,
    resource      text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- Set when the code is exchanged, then at most once a minute while it is used.
    last_used_at  timestamptz,
    revoked_at    timestamptz
);
CREATE INDEX oauth_grants_ws_idx ON oauth_grants (workspace_id, created_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX oauth_grants_user_idx ON oauth_grants (user_id) WHERE revoked_at IS NULL;
CREATE INDEX oauth_grants_client_idx ON oauth_grants (client_id);

-- An authorization request from /oauth/authorize, waiting for the user's decision on the
-- consent page (10 minutes). Approving it creates the grant and a code (60 seconds,
-- single use); the token endpoint exchanges the code with the PKCE verifier.
CREATE TABLE oauth_authorizations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    redirect_uri    text NOT NULL,
    -- Whether the request named redirect_uri; the token request must then repeat it.
    redirect_given  boolean NOT NULL DEFAULT true,
    scopes          text[] NOT NULL,
    resource        text NOT NULL,
    state           text NOT NULL DEFAULT '',
    code_challenge  text NOT NULL,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'used')),
    user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
    workspace_id    uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    grant_id        uuid REFERENCES oauth_grants(id) ON DELETE CASCADE,
    code_hash       bytea UNIQUE,
    expires_at      timestamptz NOT NULL,
    decided_at      timestamptz,
    used_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_authorizations_expires_idx ON oauth_authorizations (expires_at);

-- Refresh tokens rotate on every use: used_at marks a rotated token, and presenting a
-- rotated token again revokes its grant.
CREATE TABLE oauth_refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grant_id    uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
    token_hash  bytea NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_refresh_tokens_grant_idx ON oauth_refresh_tokens (grant_id);
