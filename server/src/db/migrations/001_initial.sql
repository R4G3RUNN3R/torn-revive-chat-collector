CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  torn_id bigint NOT NULL UNIQUE,
  current_name text NOT NULL,
  account_state text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  access_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  client_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE revivers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  standing text NOT NULL DEFAULT 'active'
    CHECK (standing IN ('active', 'suspended', 'banned')),
  member_since timestamptz NOT NULL DEFAULT now(),
  trial_started_at timestamptz,
  pro_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public_chat_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_key text UNIQUE,
  fallback_basis_hash text NOT NULL,
  channel_id text NOT NULL,
  channel_name text NOT NULL,
  channel_type text NOT NULL,
  sender_torn_id bigint,
  sender_name text NOT NULL,
  message_text text NOT NULL,
  source_message_id text,
  message_timestamp timestamptz,
  classifier_version text NOT NULL,
  classifier_score integer NOT NULL,
  classifier_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  seen_count integer NOT NULL DEFAULT 1 CHECK (seen_count >= 1)
);

CREATE INDEX public_chat_candidates_fallback_lookup
  ON public_chat_candidates (fallback_basis_hash, last_seen_at DESC);

CREATE TABLE revive_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_method text NOT NULL,
  offer_amount numeric(20,0) NOT NULL,
  comment text,
  state text NOT NULL DEFAULT 'AVAILABLE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  closed_at timestamptz,
  CHECK (payment_method IN ('cash','xanax')),
  CHECK ((payment_method = 'cash' AND offer_amount >= 500000)
      OR (payment_method = 'xanax' AND offer_amount >= 1)),
  CHECK (offer_amount = trunc(offer_amount))
);

CREATE UNIQUE INDEX revive_requests_one_active_per_requester
  ON revive_requests(requester_id)
  WHERE closed_at IS NULL;

CREATE INDEX revive_requests_queue
  ON revive_requests (state, created_at)
  WHERE closed_at IS NULL;

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES revive_requests(id) ON DELETE RESTRICT,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state text NOT NULL,
  accepted_at timestamptz NOT NULL,
  payment_deadline timestamptz NOT NULL,
  payment_reconcile_until timestamptz,
  payment_verified_at timestamptz,
  revive_deadline timestamptz,
  retry_response_deadline timestamptz,
  refund_required_at timestamptz,
  refund_deadline timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transactions_reviver_state
  ON transactions (reviver_id, state);

CREATE INDEX transactions_requester_state
  ON transactions (requester_id, state);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('cash','xanax')),
  expected_amount numeric(20,0) NOT NULL,
  verified_amount numeric(20,0) NOT NULL,
  torn_evidence_id text NOT NULL UNIQUE,
  evidence_timestamp timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE revive_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  reviver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  torn_evidence_id text NOT NULL UNIQUE,
  attempt_timestamp timestamptz NOT NULL,
  success boolean NOT NULL,
  sequence_number integer NOT NULL CHECK (sequence_number >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, sequence_number)
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('cash','xanax')),
  required_amount numeric(20,0) NOT NULL,
  torn_evidence_id text UNIQUE,
  required_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  comment text,
  outcome text,
  reviewer_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  dispute_id uuid REFERENCES disputes(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX bans_active_reviver
  ON bans (reviver_id)
  WHERE active = true;

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  torn_evidence_id text UNIQUE,
  xanax_quantity integer NOT NULL CHECK (xanax_quantity > 0),
  credited_days integer NOT NULL CHECK (credited_days > 0),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
