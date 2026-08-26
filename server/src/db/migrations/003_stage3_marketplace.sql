-- Stage 3 protected marketplace schema.
-- Existing credentials predate the purpose-aware transaction-verification flow.
-- Fail closed: classify and revoke them instead of silently granting Stage 3 capability.
ALTER TABLE api_credentials ADD COLUMN purpose text;
UPDATE api_credentials
SET purpose = 'legacy_unclassified',
    revoked_at = COALESCE(revoked_at, now())
WHERE purpose IS NULL;
ALTER TABLE api_credentials ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE api_credentials ADD COLUMN capability jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api_credentials ADD COLUMN last_validated_at timestamptz;
ALTER TABLE api_credentials ADD COLUMN unusable_at timestamptz;
ALTER TABLE api_credentials ADD COLUMN unusable_reason text;

CREATE UNIQUE INDEX api_credentials_one_active_purpose_per_user
  ON api_credentials (user_id, purpose)
  WHERE revoked_at IS NULL;

-- A revive request may be offered to a later reviver after an unpaid reservation
-- closes. Preserve each reservation as a separate transaction row.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_request_id_key;
ALTER TABLE transactions ADD COLUMN refund_reason text;
ALTER TABLE transactions ADD COLUMN verification_hold_reason text;
ALTER TABLE transactions ADD COLUMN verification_hold_started_at timestamptz;
ALTER TABLE transactions ADD COLUMN verification_hold_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE transactions ADD COLUMN requester_hospital_until timestamptz;
ALTER TABLE transactions ADD COLUMN requester_hospital_observed_at timestamptz;

CREATE UNIQUE INDEX transactions_one_open_per_request
  ON transactions (request_id)
  WHERE closed_at IS NULL;

CREATE TABLE transaction_state_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  event_code text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Stage 1 stored one Torn evidence ID directly on payments. Stage 3 supports
-- split transfers, so the aggregate payment keeps that legacy field nullable
-- while authoritative evidence moves to child rows.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_torn_evidence_id_key;
ALTER TABLE payments ALTER COLUMN torn_evidence_id DROP NOT NULL;

CREATE UNIQUE INDEX payments_one_aggregate_per_transaction
  ON payments (transaction_id);

CREATE TABLE payment_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  torn_evidence_id text NOT NULL UNIQUE,
  evidence_timestamp timestamptz NOT NULL,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refund_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  torn_evidence_id text NOT NULL UNIQUE,
  evidence_timestamp timestamptz NOT NULL,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE jobs ADD COLUMN dedupe_key text;

CREATE UNIQUE INDEX jobs_one_active_dedupe_key
  ON jobs (dedupe_key)
  WHERE completed_at IS NULL AND dedupe_key IS NOT NULL;
