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
