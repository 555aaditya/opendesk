-- opendesk initial schema. Every workspace-owned table carries workspace_id and
-- every read of it is scoped by workspace_id.

CREATE EXTENSION IF NOT EXISTS citext;

-- Identity -------------------------------------------------------------------

CREATE TABLE users (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email             citext NOT NULL UNIQUE,
    name              text NOT NULL DEFAULT '',
    avatar_url        text NOT NULL DEFAULT '',
    password_hash     text,
    email_verified_at timestamptz,
    totp_secret_enc   bytea,
    totp_enabled      boolean NOT NULL DEFAULT false,
    totp_last_step    bigint NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Federated identities are bound by (issuer, subject), never by email alone.
CREATE TABLE identities (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider   text NOT NULL,
    issuer     text NOT NULL,
    subject    text NOT NULL,
    email      citext NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (issuer, subject)
);
CREATE INDEX identities_user_idx ON identities(user_id);

CREATE TABLE sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_hash bytea NOT NULL UNIQUE,
    user_agent   text NOT NULL DEFAULT '',
    ip           text NOT NULL DEFAULT '',
    mfa_verified boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- Single-use, hashed tokens sent by email (verify, reset, magic link, oauth login code).
CREATE TABLE one_time_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
    email      citext NOT NULL DEFAULT '',
    purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'magic_link', 'oauth_login', 'mfa')),
    token_hash bytea NOT NULL UNIQUE,
    data       jsonb NOT NULL DEFAULT '{}',
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Workspaces -----------------------------------------------------------------

CREATE TABLE workspaces (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    slug       text NOT NULL UNIQUE,
    -- Per-workspace counters; incremented with UPDATE ... RETURNING.
    event_seq  bigint NOT NULL DEFAULT 0,
    ticket_seq bigint NOT NULL DEFAULT 0,
    -- Public key the chat widget embeds; not a secret.
    widget_key text NOT NULL UNIQUE,
    -- Signs end-user identity for the widget (HMAC); encrypted at rest.
    widget_secret_enc bytea,
    settings   jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         text NOT NULL CHECK (role IN ('owner', 'admin', 'agent', 'viewer')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX members_user_idx ON members(user_id);

CREATE TABLE invitations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email        citext NOT NULL,
    role         text NOT NULL CHECK (role IN ('admin', 'agent', 'viewer')),
    token_hash   bytea NOT NULL UNIQUE,
    invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    expires_at   timestamptz NOT NULL,
    accepted_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_ws_idx ON invitations(workspace_id);

CREATE TABLE teams (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
);

CREATE TABLE team_members (
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE api_keys (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         text NOT NULL,
    prefix       text NOT NULL,
    key_hash     bytea NOT NULL UNIQUE,
    scopes       text[] NOT NULL DEFAULT '{}',
    created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    last_used_at timestamptz,
    expires_at   timestamptz,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_ws_idx ON api_keys(workspace_id);

-- Customers ------------------------------------------------------------------

CREATE TABLE companies (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         text NOT NULL,
    domain       citext NOT NULL DEFAULT '',
    notes        text NOT NULL DEFAULT '',
    custom       jsonb NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX companies_ws_idx ON companies(workspace_id);
CREATE UNIQUE INDEX companies_ws_domain_uq ON companies(workspace_id, domain) WHERE domain <> '';

CREATE TABLE contacts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email        citext,
    name         text NOT NULL DEFAULT '',
    phone        text NOT NULL DEFAULT '',
    avatar_url   text NOT NULL DEFAULT '',
    company_id   uuid REFERENCES companies(id) ON DELETE SET NULL,
    external_id  text,
    notes        text NOT NULL DEFAULT '',
    custom       jsonb NOT NULL DEFAULT '{}',
    blocked      boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    search       tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(email::text, '') || ' ' || coalesce(phone, ''))
    ) STORED
);
CREATE UNIQUE INDEX contacts_ws_email_uq ON contacts(workspace_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX contacts_ws_external_uq ON contacts(workspace_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX contacts_search_idx ON contacts USING gin(search);

-- Email ----------------------------------------------------------------------

CREATE TABLE mailboxes (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name               text NOT NULL,
    email              citext NOT NULL,
    display_name       text NOT NULL DEFAULT '',
    -- How mail comes in.
    inbound_kind       text NOT NULL CHECK (inbound_kind IN ('forwarding', 'imap', 'google', 'microsoft')),
    -- Local part of the forwarding address, e.g. "acme-x7k2" for acme-x7k2@in.opendesk.sh.
    forwarding_token   text NOT NULL UNIQUE,
    -- How replies go out.
    outbound_kind      text NOT NULL CHECK (outbound_kind IN ('smtp', 'google', 'microsoft', 'system')),
    -- Non-secret connection settings (hosts, ports, usernames, tls mode).
    config             jsonb NOT NULL DEFAULT '{}',
    -- Secrets (passwords, OAuth tokens), AES-GCM encrypted with CREDENTIALS_KEY.
    credentials_enc    bytea,
    team_id            uuid REFERENCES teams(id) ON DELETE SET NULL,
    signature_html     text NOT NULL DEFAULT '',
    auto_reply_enabled boolean NOT NULL DEFAULT false,
    auto_reply_subject text NOT NULL DEFAULT '',
    auto_reply_html    text NOT NULL DEFAULT '',
    status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'disabled')),
    last_error         text NOT NULL DEFAULT '',
    last_synced_at     timestamptz,
    imap_uid_validity  bigint NOT NULL DEFAULT 0,
    imap_last_uid      bigint NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, email)
);

-- Every raw email received, before it becomes a ticket message. Dedupes redelivery.
CREATE TABLE inbound_emails (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    mailbox_id      uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    message_id_hdr  text NOT NULL,
    raw_storage_key text NOT NULL,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'ignored', 'failed')),
    reason          text NOT NULL DEFAULT '',
    received_at     timestamptz NOT NULL DEFAULT now(),
    processed_at    timestamptz,
    UNIQUE (mailbox_id, message_id_hdr)
);

-- Helpdesk -------------------------------------------------------------------

CREATE TABLE sla_policies (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name                   text NOT NULL,
    -- Applies to tickets with this priority; NULL = any.
    priority               text CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    first_response_minutes integer NOT NULL CHECK (first_response_minutes > 0),
    resolution_minutes     integer NOT NULL CHECK (resolution_minutes > 0),
    enabled                boolean NOT NULL DEFAULT true,
    position               integer NOT NULL DEFAULT 0,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    number                   bigint NOT NULL,
    subject                  text NOT NULL DEFAULT '',
    status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'on_hold', 'solved', 'closed')),
    priority                 text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    channel                  text NOT NULL CHECK (channel IN ('email', 'chat', 'api', 'portal')),
    mailbox_id               uuid REFERENCES mailboxes(id) ON DELETE SET NULL,
    contact_id               uuid REFERENCES contacts(id) ON DELETE SET NULL,
    assignee_id              uuid REFERENCES users(id) ON DELETE SET NULL,
    team_id                  uuid REFERENCES teams(id) ON DELETE SET NULL,
    sla_policy_id            uuid REFERENCES sla_policies(id) ON DELETE SET NULL,
    first_response_due_at    timestamptz,
    resolution_due_at        timestamptz,
    first_responded_at       timestamptz,
    solved_at                timestamptz,
    closed_at                timestamptz,
    snoozed_until            timestamptz,
    last_message_at          timestamptz NOT NULL DEFAULT now(),
    last_customer_message_at timestamptz,
    last_message_preview     text NOT NULL DEFAULT '',
    message_count            integer NOT NULL DEFAULT 0,
    spam                     boolean NOT NULL DEFAULT false,
    deleted_at               timestamptz,
    csat_score               smallint CHECK (csat_score BETWEEN 1 AND 5),
    csat_comment             text NOT NULL DEFAULT '',
    csat_token_hash          bytea UNIQUE,
    custom                   jsonb NOT NULL DEFAULT '{}',
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    search                   tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(last_message_preview, ''))
    ) STORED,
    UNIQUE (workspace_id, number)
);
CREATE INDEX tickets_ws_status_idx ON tickets(workspace_id, status, last_message_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX tickets_ws_assignee_idx ON tickets(workspace_id, assignee_id, status) WHERE deleted_at IS NULL;
CREATE INDEX tickets_ws_contact_idx ON tickets(workspace_id, contact_id);
CREATE INDEX tickets_sla_idx ON tickets(first_response_due_at, resolution_due_at) WHERE status IN ('open', 'pending', 'on_hold');
CREATE INDEX tickets_search_idx ON tickets USING gin(search);

CREATE TABLE tags (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
);

CREATE TABLE ticket_tags (
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    tag_id    uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (ticket_id, tag_id)
);
CREATE INDEX ticket_tags_tag_idx ON ticket_tags(tag_id);

CREATE TABLE messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id         uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    -- reply: visible to the customer. note: internal, agents only.
    kind              text NOT NULL CHECK (kind IN ('reply', 'note')),
    direction         text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    author_type       text NOT NULL CHECK (author_type IN ('contact', 'user', 'system', 'api')),
    author_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    author_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
    body_html         text NOT NULL DEFAULT '',
    body_text         text NOT NULL DEFAULT '',
    -- Full original text including quoted history, for inbound email.
    full_html         text NOT NULL DEFAULT '',
    subject           text NOT NULL DEFAULT '',
    from_email        text NOT NULL DEFAULT '',
    from_name         text NOT NULL DEFAULT '',
    to_emails         text[] NOT NULL DEFAULT '{}',
    cc_emails         text[] NOT NULL DEFAULT '{}',
    bcc_emails        text[] NOT NULL DEFAULT '{}',
    -- RFC 5322 Message-ID of this message, with angle brackets.
    email_message_id  text,
    in_reply_to       text NOT NULL DEFAULT '',
    "references"      text[] NOT NULL DEFAULT '{}',
    inbound_email_id  uuid REFERENCES inbound_emails(id) ON DELETE SET NULL,
    delivery_status   text NOT NULL DEFAULT 'none' CHECK (delivery_status IN ('none', 'pending', 'sent', 'failed', 'bounced')),
    delivery_error    text NOT NULL DEFAULT '',
    sent_at           timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    search            tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body_text, ''))) STORED
);
CREATE INDEX messages_ticket_idx ON messages(ticket_id, created_at);
CREATE UNIQUE INDEX messages_ws_msgid_uq ON messages(workspace_id, email_message_id) WHERE email_message_id IS NOT NULL;
CREATE INDEX messages_search_idx ON messages USING gin(search);

CREATE TABLE attachments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    message_id   uuid REFERENCES messages(id) ON DELETE CASCADE,
    filename     text NOT NULL,
    content_type text NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   bigint NOT NULL,
    storage_key  text NOT NULL,
    content_id   text NOT NULL DEFAULT '',
    inline       boolean NOT NULL DEFAULT false,
    uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_message_idx ON attachments(message_id);

-- Timeline entries that are not messages: status changes, assignment, merges.
CREATE TABLE activities (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id        uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    actor_type       text NOT NULL CHECK (actor_type IN ('user', 'system', 'api', 'automation', 'contact')),
    actor_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    type             text NOT NULL,
    data             jsonb NOT NULL DEFAULT '{}',
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_ticket_idx ON activities(ticket_id, created_at);

CREATE TABLE saved_replies (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title        text NOT NULL,
    shortcut     text NOT NULL DEFAULT '',
    body_html    text NOT NULL,
    created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_replies_ws_idx ON saved_replies(workspace_id);

-- Saved ticket filters. user_id NULL = shared with the workspace.
CREATE TABLE views (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
    name         text NOT NULL,
    filters      jsonb NOT NULL DEFAULT '{}',
    position     integer NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX views_ws_idx ON views(workspace_id);

CREATE TABLE automations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         text NOT NULL,
    trigger      text NOT NULL CHECK (trigger IN ('ticket_created', 'customer_replied', 'agent_replied', 'ticket_updated')),
    -- [{field, op, value}] all must match.
    conditions   jsonb NOT NULL DEFAULT '[]',
    -- [{type, value}] applied in order.
    actions      jsonb NOT NULL DEFAULT '[]',
    enabled      boolean NOT NULL DEFAULT true,
    position     integer NOT NULL DEFAULT 0,
    run_count    bigint NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automations_ws_idx ON automations(workspace_id, trigger) WHERE enabled;

-- Knowledge base ---------------------------------------------------------------

CREATE TABLE kb_collections (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         text NOT NULL,
    slug         text NOT NULL,
    description  text NOT NULL DEFAULT '',
    position     integer NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, slug)
);

CREATE TABLE kb_articles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    collection_id uuid REFERENCES kb_collections(id) ON DELETE SET NULL,
    title         text NOT NULL,
    slug          text NOT NULL,
    excerpt       text NOT NULL DEFAULT '',
    body_html     text NOT NULL DEFAULT '',
    status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    author_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    position      integer NOT NULL DEFAULT 0,
    views         bigint NOT NULL DEFAULT 0,
    published_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    search        tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(excerpt, '')), 'B') ||
        setweight(to_tsvector('simple', regexp_replace(coalesce(body_html, ''), '<[^>]+>', ' ', 'g')), 'C')
    ) STORED,
    UNIQUE (workspace_id, slug)
);
CREATE INDEX kb_articles_search_idx ON kb_articles USING gin(search);

-- Chat widget ------------------------------------------------------------------

-- An end-user browser session in the widget. The token is the visitor's credential.
CREATE TABLE widget_sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    token_hash   bytea NOT NULL UNIQUE,
    verified     boolean NOT NULL DEFAULT false,
    user_agent   text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- Platform ---------------------------------------------------------------------

CREATE TABLE webhooks (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    url          text NOT NULL,
    description  text NOT NULL DEFAULT '',
    secret_enc   bytea NOT NULL,
    -- Event types, or '*' for all.
    events       text[] NOT NULL DEFAULT '{*}',
    enabled      boolean NOT NULL DEFAULT true,
    created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhooks_ws_idx ON webhooks(workspace_id) WHERE enabled;

CREATE TABLE webhook_deliveries (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    webhook_id    uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_id      uuid NOT NULL,
    event_type    text NOT NULL,
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
    attempts      integer NOT NULL DEFAULT 0,
    response_code integer,
    response_body text NOT NULL DEFAULT '',
    duration_ms   integer,
    created_at    timestamptz NOT NULL DEFAULT now(),
    delivered_at  timestamptz
);
CREATE INDEX webhook_deliveries_hook_idx ON webhook_deliveries(webhook_id, created_at DESC);

-- Transactional outbox and the replay log for realtime clients and webhooks.
-- seq is contiguous per workspace, so a client can detect a gap.
CREATE TABLE events (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    seq          bigint NOT NULL,
    id           uuid NOT NULL UNIQUE,
    type         text NOT NULL,
    visibility   text NOT NULL CHECK (visibility IN ('agents', 'public')),
    topics       text[] NOT NULL,
    data         jsonb NOT NULL,
    published_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, seq)
);
CREATE INDEX events_unpublished_idx ON events(created_at) WHERE published_at IS NULL;
CREATE INDEX events_created_idx ON events(created_at);

CREATE TABLE audit_logs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    actor_api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
    action           text NOT NULL,
    entity_type      text NOT NULL,
    entity_id        uuid,
    data             jsonb NOT NULL DEFAULT '{}',
    ip               text NOT NULL DEFAULT '',
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_ws_idx ON audit_logs(workspace_id, created_at DESC);

CREATE TABLE notifications (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type         text NOT NULL,
    ticket_id    uuid REFERENCES tickets(id) ON DELETE CASCADE,
    data         jsonb NOT NULL DEFAULT '{}',
    read_at      timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, workspace_id, created_at DESC);
