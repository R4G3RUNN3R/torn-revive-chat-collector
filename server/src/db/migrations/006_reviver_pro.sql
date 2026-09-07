CREATE TABLE pro_entitlements (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  paid_started_at timestamptz,
  paid_until timestamptz,
  ever_paid boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  revoke_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (trial_started_at IS NULL OR trial_ends_at IS NOT NULL),
  CHECK (paid_started_at IS NULL OR paid_until IS NOT NULL)
);

CREATE TABLE pro_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purchaser_torn_id bigint NOT NULL,
  plan_id text NOT NULL CHECK (plan_id IN ('monthly','six_months','yearly')),
  currency text NOT NULL CHECK (currency IN ('xanax','cash')),
  expected_amount bigint NOT NULL CHECK (expected_amount > 0),
  entitlement_months integer NOT NULL CHECK (entitlement_months IN (1,6,12)),
  state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','PAID','EXPIRED','CANCELLED','REJECTED')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  matched_torn_log_id text UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at = created_at + interval '24 hours')
);

CREATE UNIQUE INDEX pro_invoices_one_open_per_user
  ON pro_invoices(user_id)
  WHERE state = 'PENDING';

CREATE INDEX pro_invoices_pending_window
  ON pro_invoices (state, created_at, expires_at)
  WHERE state = 'PENDING';

CREATE TABLE pro_payment_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL UNIQUE REFERENCES pro_invoices(id) ON DELETE RESTRICT,
  torn_log_id text NOT NULL UNIQUE,
  sender_torn_id bigint NOT NULL,
  currency text NOT NULL CHECK (currency IN ('xanax','cash')),
  amount bigint NOT NULL CHECK (amount > 0),
  evidence_timestamp timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
