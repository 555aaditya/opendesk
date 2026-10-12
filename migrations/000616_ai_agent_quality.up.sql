-- The agent quality loop (contracts/agent.md "Tests", "Improve answer", "Review queue"):
-- saved test conversations with expectations, their runs with a result per test, and
-- the agent replies an admin dismissed from or improved in the review queue.
CREATE TABLE ai_agent_tests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          text NOT NULL,
    -- [{role: "visitor" | "agent", text}], 1..6, the last one the visitor's.
    messages      jsonb NOT NULL,
    -- [{kind, value?}], as in the API.
    expectations  jsonb NOT NULL,
    -- {name?, email?, verified?, user_id?}, as in the playground; null for an anonymous visitor.
    visitor       jsonb,
    created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_agent_tests_ws_idx ON ai_agent_tests (workspace_id, created_at, id);

-- One run of some or all tests, against the saved settings or unsaved drafts of them.
CREATE TABLE ai_agent_test_runs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
    -- The unsaved settings the run used; null = the saved settings.
    settings      jsonb,
    total         integer NOT NULL DEFAULT 0,
    passed        integer NOT NULL DEFAULT 0,
    failed        integer NOT NULL DEFAULT 0,
    errored       integer NOT NULL DEFAULT 0,
    millicredits  bigint NOT NULL DEFAULT 0,
    error         text,
    created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    finished_at   timestamptz
);
CREATE INDEX ai_agent_test_runs_ws_idx ON ai_agent_test_runs (workspace_id, created_at DESC);
-- At most one run in progress per workspace.
CREATE UNIQUE INDEX ai_agent_test_runs_active_idx ON ai_agent_test_runs (workspace_id) WHERE status IN ('queued', 'running');

-- A test's outcome in a run: the agent's answer and each expectation's verdict.
CREATE TABLE ai_agent_test_results (
    run_id        uuid NOT NULL REFERENCES ai_agent_test_runs(id) ON DELETE CASCADE,
    test_id       uuid NOT NULL REFERENCES ai_agent_tests(id) ON DELETE CASCADE,
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    position      integer NOT NULL,
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'passed', 'failed', 'error')),
    answer_html   text NOT NULL DEFAULT '',
    handoff       boolean NOT NULL DEFAULT false,
    tools         text[] NOT NULL DEFAULT '{}',
    sources       jsonb NOT NULL DEFAULT '[]',
    action        jsonb,
    -- [{kind, value, passed, reason}]
    checks        jsonb NOT NULL DEFAULT '[]',
    error         text,
    millicredits  bigint NOT NULL DEFAULT 0,
    finished_at   timestamptz,
    PRIMARY KEY (run_id, test_id)
);
CREATE INDEX ai_agent_test_results_test_idx ON ai_agent_test_results (workspace_id, test_id, finished_at DESC);

-- Agent replies taken off the review queue: dismissed, or improved with a snippet.
CREATE TABLE ai_agent_reviews (
    message_id    uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    outcome       text NOT NULL CHECK (outcome IN ('dismissed', 'improved')),
    user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_agent_reviews_ws_idx ON ai_agent_reviews (workspace_id, created_at DESC);

-- The review queue finds the visitor question an agent reply answered.
CREATE INDEX ai_widget_answers_reply_idx ON ai_widget_answers (reply_id) WHERE reply_id IS NOT NULL;
