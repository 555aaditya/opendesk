-- The assistant (Jev): conversations per user and workspace, their turns, and the
-- write actions waiting on (or decided by) the user's approval.
CREATE TABLE assistant_sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_sessions_user_idx ON assistant_sessions (workspace_id, user_id, updated_at DESC, id DESC);

-- One row per conversation turn: role user (text and page context, or tool results)
-- or assistant (text and tool calls), as JSON.
CREATE TABLE assistant_turns (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   uuid NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    seq          integer NOT NULL,
    role         text NOT NULL CHECK (role IN ('user', 'assistant')),
    body         jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, seq)
);

-- A write tool call the model proposed. It runs only after the user approves it, once,
-- with exactly these arguments.
CREATE TABLE assistant_actions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id   uuid NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
    turn_seq     integer NOT NULL,
    call_id      text NOT NULL,
    tool         text NOT NULL,
    args         jsonb NOT NULL,
    preview      jsonb NOT NULL,
    status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'done', 'failed')),
    result       jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    decided_at   timestamptz
);
CREATE INDEX assistant_actions_session_idx ON assistant_actions (session_id, status);
