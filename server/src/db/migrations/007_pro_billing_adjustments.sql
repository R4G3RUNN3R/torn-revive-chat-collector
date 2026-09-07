CREATE TABLE pro_billing_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES pro_invoices(id) ON DELETE RESTRICT,
  adjustment_type text NOT NULL
    CHECK (adjustment_type IN ('FULL_REFUND','ENTITLEMENT_CORRECTION','COMPLIMENTARY_GRANT')),
  currency text CHECK (currency IS NULL OR currency IN ('xanax','cash')),
  amount bigint CHECK (amount IS NULL OR amount > 0),
  entitlement_months integer CHECK (entitlement_months IS NULL OR entitlement_months BETWEEN 1 AND 24),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  actor_type text NOT NULL CHECK (actor_type IN ('operator','system')),
  actor_torn_id bigint CHECK (actor_torn_id IS NULL OR actor_torn_id > 0),
  created_at timestamptz NOT NULL,
  previous_state text NOT NULL CHECK (previous_state IN ('NONE','TRIAL','ACTIVE','EXPIRED','REVOKED')),
  previous_valid_until timestamptz,
  new_state text NOT NULL CHECK (new_state IN ('NONE','TRIAL','ACTIVE','EXPIRED','REVOKED')),
  new_valid_until timestamptz,
  CHECK (actor_type <> 'operator' OR actor_torn_id IS NOT NULL),
  CHECK (
    (adjustment_type = 'FULL_REFUND' AND invoice_id IS NOT NULL AND currency IS NOT NULL AND amount IS NOT NULL)
    OR
    (adjustment_type <> 'FULL_REFUND' AND invoice_id IS NULL AND currency IS NULL AND amount IS NULL)
  )
);

CREATE UNIQUE INDEX pro_billing_adjustments_one_full_refund_per_invoice
  ON pro_billing_adjustments(invoice_id)
  WHERE adjustment_type = 'FULL_REFUND';

CREATE INDEX pro_billing_adjustments_user_created
  ON pro_billing_adjustments(user_id, created_at, id);

CREATE OR REPLACE FUNCTION reject_pro_billing_adjustment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Pro billing adjustments are immutable';
END;
$$;

CREATE TRIGGER pro_billing_adjustments_immutable
BEFORE UPDATE OR DELETE ON pro_billing_adjustments
FOR EACH ROW
EXECUTE FUNCTION reject_pro_billing_adjustment_mutation();
