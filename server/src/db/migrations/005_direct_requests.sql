ALTER TABLE revive_requests
  ADD COLUMN origin text NOT NULL DEFAULT 'reviverelay_direct';

ALTER TABLE revive_requests
  ADD CONSTRAINT revive_requests_origin_check
  CHECK (origin IN ('reviverelay_direct'));
