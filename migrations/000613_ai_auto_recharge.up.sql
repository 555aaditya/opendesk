-- AI credits auto-recharge (contracts/billing.md "Auto-recharge"). One settings row per
-- workspace, created on first use; no row reads as the defaults (off).
CREATE TABLE ai_auto_recharge (
    workspace_id     uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    enabled          boolean NOT NULL DEFAULT false,
    -- Recharge when the remaining credits fall below this many credits.
    threshold        integer NOT NULL DEFAULT 200 CHECK (threshold BETWEEN 1 AND 100000),
    packs            integer NOT NULL DEFAULT 1 CHECK (packs BETWEEN 1 AND 20),
    -- At most this many recharges per calendar month (UTC).
    monthly_limit    integer NOT NULL DEFAULT 5 CHECK (monthly_limit BETWEEN 1 AND 30),
    -- Why the last recharge failed (auto-recharge turned itself off); cleared when it is
    -- turned back on.
    failure_code     text CHECK (failure_code IN ('card_declined', 'authentication_required', 'no_payment_method', 'payment_failed', 'unavailable')),
    failed_at        timestamptz,
    -- Running-low notices already sent (owners and admins), re-armed by every grant and
    -- every new period.
    low_notified_at  timestamptz,
    out_notified_at  timestamptz,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Every recharge attempt. The id is the Stripe idempotency key, so a retried job never
-- charges twice; a pending attempt counts against the monthly limit.
CREATE TABLE ai_auto_recharges (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    payment_intent_id text UNIQUE,
    -- The Stripe customer and saved payment method charged (opaque references), kept so a
    -- retried attempt repeats the exact same request.
    customer_id       text NOT NULL,
    payment_method_id text NOT NULL,
    packs             integer NOT NULL,
    credits           integer NOT NULL,
    amount            bigint NOT NULL,
    currency          text NOT NULL,
    status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
    failure_code      text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_auto_recharges_workspace_created ON ai_auto_recharges (workspace_id, created_at DESC);
