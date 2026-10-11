-- Profile pictures and logos, agent availability, assignment rules, business hours
-- and onboarding. avatar_url holds "img:<image id>" (served from /v1/images) or ''.

CREATE TABLE images (
    id           uuid PRIMARY KEY,
    -- NULL for an agent's own picture, which follows the user across workspaces.
    workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    owner_type   text NOT NULL CHECK (owner_type IN ('user', 'contact', 'company', 'workspace')),
    owner_id     uuid NOT NULL,
    slot         text NOT NULL DEFAULT 'avatar',
    source       text NOT NULL,
    -- Objects live at <storage_key>/256.png and <storage_key>/64.png.
    storage_key  text NOT NULL,
    sha256       text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX images_ws_idx ON images(workspace_id);
CREATE INDEX images_owner_idx ON images(owner_type, owner_id);
CREATE INDEX images_created_idx ON images(created_at);

ALTER TABLE users
    ADD COLUMN avatar_source     text CHECK (avatar_source IN ('upload', 'oauth')),
    ADD COLUMN avatar_remote_url text NOT NULL DEFAULT '',
    ADD COLUMN last_seen_at      timestamptz;

-- Pictures set as URLs before images existed are fetched and processed by the refresh job.
UPDATE users SET avatar_remote_url = avatar_url, avatar_url = '', avatar_source = 'oauth' WHERE avatar_url <> '';

ALTER TABLE contacts
    ADD COLUMN avatar_source     text CHECK (avatar_source IN ('upload', 'gravatar', 'widget')),
    ADD COLUMN avatar_remote_url text NOT NULL DEFAULT '',
    ADD COLUMN avatar_checked_at timestamptz,
    ADD COLUMN avatar_retry_at   timestamptz DEFAULT now(),
    ADD COLUMN avatar_failures   integer NOT NULL DEFAULT 0;
UPDATE contacts SET avatar_remote_url = avatar_url, avatar_url = '', avatar_source = 'upload' WHERE avatar_url <> '';
CREATE INDEX contacts_avatar_due_idx ON contacts(avatar_retry_at) WHERE avatar_retry_at IS NOT NULL;

ALTER TABLE companies
    ADD COLUMN avatar_url        text NOT NULL DEFAULT '',
    ADD COLUMN avatar_source     text CHECK (avatar_source IN ('upload', 'domain')),
    ADD COLUMN avatar_checked_at timestamptz,
    ADD COLUMN avatar_retry_at   timestamptz DEFAULT now(),
    ADD COLUMN avatar_failures   integer NOT NULL DEFAULT 0;
CREATE INDEX companies_avatar_due_idx ON companies(avatar_retry_at) WHERE avatar_retry_at IS NOT NULL;

ALTER TABLE workspaces
    ADD COLUMN avatar_url     text NOT NULL DEFAULT '',
    -- help_center_logo, help_center_favicon, widget_avatar, widget_launcher -> "img:<id>"
    ADD COLUMN brand_images   jsonb NOT NULL DEFAULT '{}',
    ADD COLUMN widget_seen_at timestamptz;
UPDATE workspaces w SET widget_seen_at = (SELECT min(created_at) FROM widget_sessions s WHERE s.workspace_id = w.id);

ALTER TABLE members
    ADD COLUMN availability          text NOT NULL DEFAULT 'online' CHECK (availability IN ('online', 'away', 'offline')),
    ADD COLUMN max_open_tickets      integer CHECK (max_open_tickets BETWEEN 1 AND 1000),
    ADD COLUMN onboarding_dismissed_at timestamptz;

-- Auto-assignment per mailbox or team; the workspace default is settings.auto_assign.
CREATE TABLE assignment_rules (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    mailbox_id   uuid REFERENCES mailboxes(id) ON DELETE CASCADE,
    team_id      uuid REFERENCES teams(id) ON DELETE CASCADE,
    mode         text NOT NULL CHECK (mode IN ('none', 'round_robin', 'load_balanced')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK ((mailbox_id IS NULL) <> (team_id IS NULL))
);
CREATE UNIQUE INDEX assignment_rules_mailbox_uq ON assignment_rules(workspace_id, mailbox_id) WHERE mailbox_id IS NOT NULL;
CREATE UNIQUE INDEX assignment_rules_team_uq ON assignment_rules(workspace_id, team_id) WHERE team_id IS NOT NULL;

ALTER TABLE sla_policies ADD COLUMN business_hours boolean NOT NULL DEFAULT false;

CREATE INDEX tickets_ws_assignee_open_idx ON tickets(workspace_id, assignee_id)
    WHERE deleted_at IS NULL AND status IN ('open', 'pending');
