-- Passkeys (WebAuthn credentials). A credential id is globally unique; the public key
-- and counters are what each assertion is verified against.
CREATE TABLE passkeys (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id      bytea NOT NULL UNIQUE,
    public_key         bytea NOT NULL,
    attestation_type   text NOT NULL DEFAULT '',
    attestation_format text NOT NULL DEFAULT '',
    aaguid             bytea NOT NULL DEFAULT '\x'::bytea,
    sign_count         bigint NOT NULL DEFAULT 0,
    transports         text[] NOT NULL DEFAULT '{}',
    backup_eligible    boolean NOT NULL DEFAULT false,
    backed_up          boolean NOT NULL DEFAULT false,
    name               text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    last_used_at       timestamptz
);
CREATE INDEX passkeys_user_idx ON passkeys(user_id, created_at DESC);

-- Pending passkey ceremonies. The row id is the passkey_token's jti; a ceremony is
-- finished at most once because finishing deletes its row.
CREATE TABLE passkey_challenges (
    id           uuid PRIMARY KEY,
    purpose      text NOT NULL,
    user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
    session_id   uuid REFERENCES sessions(id) ON DELETE CASCADE,
    session_data jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);
CREATE INDEX passkey_challenges_expires_idx ON passkey_challenges(expires_at);
