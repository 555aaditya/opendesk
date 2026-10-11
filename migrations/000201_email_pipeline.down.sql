DROP TABLE IF EXISTS email_auto_replies;
ALTER TABLE mailboxes DROP COLUMN IF EXISTS next_sync_at;
ALTER TABLE mailboxes DROP COLUMN IF EXISTS sync_failures;
DROP INDEX IF EXISTS inbound_emails_ws_status_idx;
ALTER TABLE inbound_emails DROP COLUMN IF EXISTS rcpt_to;
