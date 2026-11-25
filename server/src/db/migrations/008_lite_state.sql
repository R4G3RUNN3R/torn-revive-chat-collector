SET LOCAL lock_timeout = '5s';

ALTER TABLE sessions
  ADD COLUMN last_seen_at timestamptz;

CREATE INDEX sessions_last_seen_active
  ON sessions (last_seen_at)
  WHERE revoked_at IS NULL;

ALTER TABLE revive_requests
  ADD COLUMN hospital_until timestamptz,
  ADD COLUMN abroad boolean,
  ADD COLUMN status_checked_at timestamptz,
  ADD COLUMN status_refreshed_at timestamptz;
