CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  torn_id bigint NOT NULL UNIQUE CHECK (torn_id > 0),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
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
  key_access jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX api_credentials_user_active_idx
  ON api_credentials(user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  client_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX sessions_user_active_idx
  ON sessions(user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE revivers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  standing text NOT NULL DEFAULT 'ACTIVE' CHECK (standing IN ('ACTIVE', 'SUSPENDED', 'BANNED')),
  member_since timestamptz NOT NULL DEFAULT now(),
  trial_started_at timestamptz,
  pro_until timestamptz,
  suspended_at timestamptz,
  banned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public_chat_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_key text UNIQUE,
  fallback_basis_hash text NOT NULL,
  channel_canonical_id text NOT NULL,
  channel_name text NOT NULL,
  sender_torn_id bigint CHECK (sender_torn_id IS NULL OR sender_torn_id > 0),
  sender_display_name text NOT NULL,
  message_text text NOT NULL CHECK (length(message_text) > 0),
  source_message_id text,
  message_timestamp timestamptz,
  classifier_version text NOT NULL,
  classifier_score integer NOT NULL CHECK (classifier_score BETWEEN 0 AND 100),
  classifier_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_local_capture_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  seen_count integer NOT NULL DEFAULT 1 CHECK (seen_count > 0)
);

CREATE INDEX public_chat_candidates_fallback_window_idx
  ON public_chat_candidates(fallback_basis_hash, first_seen_at DESC);

CREATE INDEX public_chat_candidates_recent_idx
  ON public_chat_candidates(first_seen_at DESC);

CREATE TABLE revive_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'xanax')),
  offer_amount numeric(24,4) NOT NULL,
  comment text CHECK (comment IS NULL OR length(comment) <= 500),
  state text NOT NULL DEFAULT 'AVAILABLE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  closed_at timestamptz,
  CHECK (
    (payment_method = 'cash' AND offer_amount >= 500000)
    OR (payment_method = 'xanax' AND offer_amount >= 1)
  ),
  CHECK (offer_amount = trunc(offer_amount))
);

CREATE UNIQUE INDEX revive_requests_one_active_per_requester
  ON revive_requests(requester_id)
  WHERE closed_at IS NULL;

CREATE INDEX revive_requests_available_idx
  ON revive_requests(created_at)
  WHERE state = 'AVAILABLE' AND closed_at IS NULL;

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES revive_requests(id) ON DELETE RESTRICT,
  reviver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'ACCEPTED',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  payment_deadline timestamptz NOT NULL,
  payment_reconciliation_deadline timestamptz,
  payment_verified_at timestamptz,
  hospital_until_at_payment timestamptz,
  revive_deadline timestamptz,
  retry_response_deadline timestamptz,
  refund_required_at timestamptz,
  refund_deadline timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transactions_reviver_open_idx
  ON transactions(reviver_id, created_at DESC)
  WHERE terminal_at IS NULL;

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('cash', 'xanax')),
  expected_amount numeric(24,4) NOT NULL CHECK (expected_amount > 0 AND expected_amount = trunc(expected_amount)),
  verified_amount numeric(24,4) NOT NULL CHECK (verified_amount > 0 AND verified_amount = trunc(verified_amount)),
  torn_evidence_id text NOT NULL UNIQUE,
  evidence_timestamp timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  evidence_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE revive_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  reviver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  torn_evidence_id text NOT NULL UNIQUE,
  attempt_timestamp timestamptz NOT NULL,
  success boolean NOT NULL,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, sequence_number)
);

CREATE INDEX revive_attempts_transaction_idx
  ON revive_attempts(transaction_id, attempt_timestamp);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('cash', 'xanax')),
  required_amount numeric(24,4) NOT NULL CHECK (required_amount > 0 AND required_amount = trunc(required_amount)),
  torn_evidence_id text UNIQUE,
  required_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  evidence_timestamp timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'OPEN',
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  comment text CHECK (comment IS NULL OR length(comment) <= 1000),
  outcome text,
  admin_note text,
  reviewed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX disputes_open_idx
  ON disputes(created_at)
  WHERE state = 'OPEN';

CREATE TABLE bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  source_dispute_id uuid REFERENCES disputes(id) ON DELETE SET NULL,
  source_transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_note text
);

CREATE UNIQUE INDEX bans_one_active_per_reviver
  ON bans(reviver_id)
  WHERE revoked_at IS NULL;

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_evidence_id text NOT NULL UNIQUE,
  xanax_quantity integer NOT NULL CHECK (xanax_quantity > 0),
  credited_days integer NOT NULL CHECK (credited_days > 0),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at)
);

CREATE INDEX subscriptions_reviver_idx
  ON subscriptions(reviver_id, expires_at DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL,
  actor_id text,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_entity_idx
  ON audit_events(entity_type, entity_id, created_at DESC);
