-- Idempotency keys: the stored outcome of an authenticated POST sent with an
-- Idempotency-Key header, replayed on a retry for 24 hours. A row with a NULL status
-- is in progress. The response body is sealed with the credentials key.
CREATE TABLE idempotency_keys (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
    api_key_id   uuid REFERENCES api_keys(id) ON DELETE CASCADE,
    key          text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 255),
    method       text NOT NULL,
    path         text NOT NULL,
    request_hash bytea NOT NULL,
    status       integer,
    content_type text NOT NULL DEFAULT '',
    location     text NOT NULL DEFAULT '',
    body_enc     bytea,
    created_at   timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((user_id IS NULL) <> (api_key_id IS NULL))
);
-- One key per workspace (none for routes outside one) and principal (user or API key).
CREATE UNIQUE INDEX idempotency_keys_scope_idx ON idempotency_keys
    ((COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)), (COALESCE(user_id, api_key_id)), key);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys(created_at);
