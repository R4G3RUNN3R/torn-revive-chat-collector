ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_request_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_open_per_request
  ON transactions(request_id)
  WHERE terminal_at IS NULL;
