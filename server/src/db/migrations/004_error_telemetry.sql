CREATE TABLE error_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  product text NOT NULL,
  component text NOT NULL,
  severity text NOT NULL,
  summary text NOT NULL,
  representative_stack text,
  first_version text,
  last_version text,
  last_build_commit text,
  occurrence_count bigint NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  last_mirrored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE error_group_versions (
  error_group_id uuid NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  version text NOT NULL,
  occurrence_count bigint NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  last_build_commit text,
  PRIMARY KEY (error_group_id, version)
);

CREATE TABLE error_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_group_id uuid NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source text NOT NULL,
  version text,
  build_commit text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX error_occurrences_received_at
  ON error_occurrences (received_at);

CREATE INDEX error_occurrences_group_user
  ON error_occurrences (error_group_id, user_id)
  WHERE user_id IS NOT NULL;
