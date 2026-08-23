CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  entity_id uuid,
  run_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_due_queue
  ON jobs (run_at, id)
  WHERE completed_at IS NULL AND locked_at IS NULL;

CREATE INDEX jobs_locked_worker
  ON jobs (locked_by, locked_at)
  WHERE locked_at IS NOT NULL AND completed_at IS NULL;
