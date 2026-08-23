CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (length(trim(type)) > 0),
  entity_id uuid,
  run_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((locked_at IS NULL AND locked_by IS NULL) OR (locked_at IS NOT NULL AND locked_by IS NOT NULL))
);

CREATE INDEX jobs_due_idx
  ON jobs(run_at, id)
  WHERE completed_at IS NULL;

CREATE INDEX jobs_locked_idx
  ON jobs(locked_at)
  WHERE completed_at IS NULL AND locked_at IS NOT NULL;
