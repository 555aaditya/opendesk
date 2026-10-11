-- Plans, Stripe subscriptions and AI credits. On a self-hosted instance (no Stripe) these
-- rows exist but are not enforced.
CREATE TABLE subscriptions (
    workspace_id           uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    plan                   text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
    -- Stripe subscription status, or 'none' on the free plan.
    status                 text NOT NULL DEFAULT 'none'
                           CHECK (status IN ('none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused')),
    interval               text NOT NULL DEFAULT 'month' CHECK (interval IN ('month', 'year')),
    seats                  integer NOT NULL DEFAULT 1,
    stripe_customer_id     text UNIQUE,
    stripe_subscription_id text UNIQUE,
    current_period_end     timestamptz,
    cancel_at_period_end   boolean NOT NULL DEFAULT false,
    updated_at             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO subscriptions (workspace_id) SELECT id FROM workspaces;

-- Credit balance per workspace. The monthly allowance resets each period; purchased
-- credits never expire and are spent after the allowance.
CREATE TABLE ai_credits (
    workspace_id       uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    period_start       timestamptz NOT NULL DEFAULT date_trunc('month', now()),
    included_used      integer NOT NULL DEFAULT 0,
    purchased_balance  integer NOT NULL DEFAULT 0,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_credits (workspace_id) SELECT id FROM workspaces;

-- Every AI call, for usage reports and auditing spend.
CREATE TABLE ai_usage (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
    feature       text NOT NULL,
    credits       integer NOT NULL,
    model         text NOT NULL DEFAULT '',
    input_tokens  integer NOT NULL DEFAULT 0,
    output_tokens integer NOT NULL DEFAULT 0,
    ticket_id     uuid,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_workspace_created ON ai_usage (workspace_id, created_at DESC);

-- Credit purchases and grants, keyed by the Stripe object that paid for them (idempotent).
CREATE TABLE ai_credit_grants (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    credits      integer NOT NULL,
    source       text NOT NULL,
    external_id  text UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Stripe webhook events already applied (idempotency).
CREATE TABLE stripe_events (
    id          text PRIMARY KEY,
    type        text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);
