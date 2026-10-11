-- Email pipeline: envelope recipient on inbound mail, IMAP sync backoff, and the
-- per-sender auto-reply window.

ALTER TABLE inbound_emails ADD COLUMN rcpt_to text NOT NULL DEFAULT '';
CREATE INDEX inbound_emails_ws_status_idx ON inbound_emails(workspace_id, status, received_at);

-- Consecutive failed syncs; next_sync_at backs off exponentially after failures.
ALTER TABLE mailboxes ADD COLUMN sync_failures integer NOT NULL DEFAULT 0;
ALTER TABLE mailboxes ADD COLUMN next_sync_at timestamptz;

-- One auto-reply per sender per window; sent_at is the last one sent.
CREATE TABLE email_auto_replies (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email        citext NOT NULL,
    sent_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, email)
);
