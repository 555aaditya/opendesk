DROP INDEX IF EXISTS tickets_ws_assignee_open_idx;
ALTER TABLE sla_policies DROP COLUMN IF EXISTS business_hours;
DROP TABLE IF EXISTS assignment_rules;
ALTER TABLE members DROP COLUMN IF EXISTS availability, DROP COLUMN IF EXISTS max_open_tickets, DROP COLUMN IF EXISTS onboarding_dismissed_at;
ALTER TABLE workspaces DROP COLUMN IF EXISTS avatar_url, DROP COLUMN IF EXISTS brand_images, DROP COLUMN IF EXISTS widget_seen_at;
ALTER TABLE companies DROP COLUMN IF EXISTS avatar_url, DROP COLUMN IF EXISTS avatar_source, DROP COLUMN IF EXISTS avatar_checked_at,
    DROP COLUMN IF EXISTS avatar_retry_at, DROP COLUMN IF EXISTS avatar_failures;
UPDATE contacts SET avatar_url = '' WHERE avatar_url LIKE 'img:%';
ALTER TABLE contacts DROP COLUMN IF EXISTS avatar_source, DROP COLUMN IF EXISTS avatar_remote_url, DROP COLUMN IF EXISTS avatar_checked_at,
    DROP COLUMN IF EXISTS avatar_retry_at, DROP COLUMN IF EXISTS avatar_failures;
UPDATE users SET avatar_url = avatar_remote_url WHERE avatar_url LIKE 'img:%' OR avatar_url = '';
ALTER TABLE users DROP COLUMN IF EXISTS avatar_source, DROP COLUMN IF EXISTS avatar_remote_url, DROP COLUMN IF EXISTS last_seen_at;
DROP TABLE IF EXISTS images;
