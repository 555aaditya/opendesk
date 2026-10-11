DROP INDEX IF EXISTS invitations_email_idx;
DROP INDEX IF EXISTS webhook_deliveries_created_idx;
ALTER TABLE webhook_deliveries DROP COLUMN IF EXISTS last_error;
ALTER TABLE webhook_deliveries DROP COLUMN IF EXISTS payload;
DROP INDEX IF EXISTS one_time_tokens_expires_idx;
DROP INDEX IF EXISTS one_time_tokens_user_idx;
DELETE FROM one_time_tokens WHERE purpose = 'oauth_link';
ALTER TABLE one_time_tokens DROP CONSTRAINT one_time_tokens_purpose_check;
ALTER TABLE one_time_tokens ADD CONSTRAINT one_time_tokens_purpose_check
    CHECK (purpose IN ('verify_email', 'reset_password', 'magic_link', 'oauth_login', 'mfa'));
DROP INDEX IF EXISTS sessions_prev_refresh_idx;
ALTER TABLE sessions DROP COLUMN IF EXISTS rotated_at;
ALTER TABLE sessions DROP COLUMN IF EXISTS prev_refresh_hash;
DROP TABLE IF EXISTS totp_recovery_codes;
