-- Core area: TOTP recovery codes, refresh token rotation tracking, OAuth link tokens,
-- and stored webhook payloads.

-- Recovery codes are stored as keyed hashes and consumed once.
CREATE TABLE totp_recovery_codes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  bytea NOT NULL UNIQUE,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX totp_recovery_codes_user_idx ON totp_recovery_codes(user_id);

-- The previous refresh hash identifies a replayed (already rotated) refresh token.
ALTER TABLE sessions ADD COLUMN prev_refresh_hash bytea;
ALTER TABLE sessions ADD COLUMN rotated_at timestamptz;
CREATE INDEX sessions_prev_refresh_idx ON sessions(prev_refresh_hash) WHERE prev_refresh_hash IS NOT NULL;

ALTER TABLE one_time_tokens DROP CONSTRAINT one_time_tokens_purpose_check;
ALTER TABLE one_time_tokens ADD CONSTRAINT one_time_tokens_purpose_check
    CHECK (purpose IN ('verify_email', 'reset_password', 'magic_link', 'oauth_login', 'oauth_link', 'mfa'));
CREATE INDEX one_time_tokens_user_idx ON one_time_tokens(user_id, purpose);
CREATE INDEX one_time_tokens_expires_idx ON one_time_tokens(expires_at);

-- The signed body is fixed when the delivery is created, so retries outlive event retention.
ALTER TABLE webhook_deliveries ADD COLUMN payload jsonb NOT NULL DEFAULT '{}';
ALTER TABLE webhook_deliveries ADD COLUMN last_error text NOT NULL DEFAULT '';
CREATE INDEX webhook_deliveries_created_idx ON webhook_deliveries(created_at);

CREATE INDEX invitations_email_idx ON invitations(email) WHERE accepted_at IS NULL;
