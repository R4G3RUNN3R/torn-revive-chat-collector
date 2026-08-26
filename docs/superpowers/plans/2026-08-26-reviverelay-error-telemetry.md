# ReviveRelay Error Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sanitized automatic ReviveRelay error telemetry with PostgreSQL deduplication, per-version regression tracking, client/server/worker capture, and a one-way Google Sheet triage mirror that preserves human notes.

**Architecture:** Every telemetry producer first converts raw errors into a bounded safe envelope. The server sanitizes again, fingerprints without application version, records one aggregate error group plus per-version counters and short-lived occurrences, and exports aggregate rows to a private Google Sheet. Telemetry is operational only: it cannot mutate transactions, users, bans, credentials, subscriptions, or marketplace state.

**Tech Stack:** Node.js 20, Fastify 5, PostgreSQL 16, `pg`, `zod`, Node test runner, Tampermonkey userscript, Google Sheets API through the server-side `googleapis` package.

**Spec:** `docs/superpowers/specs/2026-08-26-reviverelay-stage3-marketplace-verification-design.md`

## Global Constraints

- Telemetry must never store/export Torn API keys, ReviveRelay session tokens, Authorization headers, cookies, DB/encryption/Google credentials, chat messages, requester comments, arbitrary request/response bodies, evidence payload bodies, or unrelated player data.
- Fingerprints exclude application version; per-version aggregates preserve regression visibility.
- Raw sanitized occurrence retention target is 30 days; aggregate groups are retained at least 24 months.
- Valid sessions may associate an internal user UUID for distinct-user counting, but the Google Sheet never receives Torn IDs or internal user UUIDs.
- Unauthenticated telemetry stores no durable IP identity.
- Telemetry delivery/reporting failure never recursively reports itself and never changes marketplace behavior.
- Google Sheets is a one-way human triage mirror; edits never mutate ReviveRelay operational state.
- Google credentials remain server secrets outside PostgreSQL and Git.
- Database/network isolation from every other Voidsmith product remains unchanged.
- Completed and verified work is merged to `main`.

---

### Task 1: Add Telemetry Schema and Aggregate Repository

**Files:**
- Create: `server/src/db/migrations/004_error_telemetry.sql`
- Create: `server/src/db/error-telemetry.js`
- Create: `server/test/db/error-telemetry.test.js`

**Interfaces:**
- Produces: `createErrorTelemetryRepository(pool)` with `recordOccurrence(envelope)`, `getGroup(groupId)`, `listGroupsForMirror()`, `markMirrored(groupIds, at)`, and `purgeOccurrences(before)`.

- [ ] **Step 1: Write RED repository tests**

```js
const base = {
  fingerprint:'abc', product:'reviverelay', component:'client', severity:'high',
  summary:'TypeError: cannot read property', representativeStack:'at render (client.js)',
  buildCommit:'a1', userId:null, context:{ operation:'render' }, occurredAt:new Date('2026-08-26T10:00:00Z')
};
const first = await repo.recordOccurrence({ ...base, version:'0.4.0' });
const second = await repo.recordOccurrence({ ...base, version:'0.4.1', buildCommit:'b2', occurredAt:new Date('2026-08-26T10:01:00Z') });
assert.equal(first.groupId, second.groupId);
const group = await repo.getGroup(first.groupId);
assert.equal(group.occurrenceCount, 2);
assert.equal(group.firstVersion, '0.4.0');
assert.equal(group.lastVersion, '0.4.1');
```

Also assert each version has its own `error_group_versions` counter and purging old occurrences does not delete group/version aggregates.

- [ ] **Step 2: Run RED DB test**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15432/reviverelay_test node --test server/test/db/error-telemetry.test.js`

Expected: FAIL because migration/repository are absent.

- [ ] **Step 3: Add migration `004_error_telemetry.sql`**

```sql
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
  PRIMARY KEY (error_group_id,version)
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

CREATE INDEX error_occurrences_received_at ON error_occurrences(received_at);
CREATE INDEX error_occurrences_group_user ON error_occurrences(error_group_id,user_id) WHERE user_id IS NOT NULL;
```

- [ ] **Step 4: Implement `recordOccurrence` in one DB transaction**: UPSERT group, UPSERT per-version row, insert bounded occurrence, preserve earliest/last timestamps under concurrency.

- [ ] **Step 5: Implement aggregate mirror query** with `COUNT(DISTINCT user_id)` from retained occurrences and no Torn/internal IDs in returned rows.

- [ ] **Step 6: Run DB tests and commit**

```bash
git add server/src/db/migrations/004_error_telemetry.sql server/src/db/error-telemetry.js server/test/db/error-telemetry.test.js
git commit -m "feat: add error telemetry storage"
```

### Task 2: Build Double Sanitization and Version-Independent Fingerprinting

**Files:**
- Create: `server/src/telemetry/sanitize.js`
- Create: `server/src/telemetry/fingerprint.js`
- Create: `server/test/telemetry/sanitize.test.js`
- Create: `server/test/telemetry/fingerprint.test.js`

**Interfaces:**
- Produces: `sanitizeTelemetryEnvelope(input)`, `sanitizeMessage(value)`, `sanitizeStack(value)`, `fingerprintError(envelope)`.

- [ ] **Step 1: Write RED sanitizer tests**

```js
const output = sanitizeTelemetryEnvelope({
  component:'client', version:'0.4.0', severity:'high', errorName:'Error',
  message:'Authorization: Bearer SECRET_TOKEN apiKey=ABC123 cookie=session',
  stack:'Error: boom\n at fn (https://example/x.js?key=ABC123:1:2)',
  context:{ operation:'request', requestBody:{ apiKey:'ABC123' }, route:'/v1/requests' }
});
assert.doesNotMatch(JSON.stringify(output), /SECRET_TOKEN|ABC123|requestBody|cookie/i);
assert.equal(output.context.route, '/v1/requests');
```

Test token-like strings, database URLs, credential-bearing URLs, `Authorization`, `Cookie`, `apiKey`, `token`, `secret`, `password`, chat/message/comment/evidence/body keys, oversized fields and unsupported context keys.

- [ ] **Step 2: Run RED sanitizer tests**

Expected: FAIL.

- [ ] **Step 3: Implement strict context allowlist**

```js
const SAFE_CONTEXT_KEYS = new Set([
  'operation','route','jobType','httpStatus','tornStatus','state','method','retryable','releaseChannel'
]);
```

Limits: message 1000 chars, stack 8000, context string 250, max 12 keys. Redact before truncation and again after serialization.

- [ ] **Step 4: Write RED fingerprint test**

```js
const a = fingerprintError({ product:'reviverelay', component:'client', errorCode:'TYPE_ERROR', message:'Cannot read x for user 12345', stack:'at render (/src/ui.js:42:7)', version:'0.4.0' });
const b = fingerprintError({ product:'reviverelay', component:'client', errorCode:'TYPE_ERROR', message:'Cannot read x for user 67890', stack:'at render (/src/ui.js:99:7)', version:'0.4.1' });
assert.equal(a,b);
```

- [ ] **Step 5: Implement normalization + SHA-256** for numeric IDs, UUIDs, timestamps, line/column numbers, dynamic quoted values and URLs while keeping stable error code/type/message template/top-three stack function/file signatures. Do not include version/build in fingerprint input.

- [ ] **Step 6: Run telemetry unit tests and commit**

```bash
git add server/src/telemetry server/test/telemetry
git commit -m "feat: sanitize and fingerprint ReviveRelay errors"
```

### Task 3: Add the Rate-Limited Error Ingestion API

**Files:**
- Create: `server/src/routes/telemetry.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Create: `server/test/routes/telemetry.test.js`

**Interfaces:**
- Produces: `POST /v1/telemetry/errors`, batch size 1-20.

- [ ] **Step 1: Write RED route tests**

```js
const response = await app.inject({
  method:'POST', url:'/v1/telemetry/errors',
  payload:{ errors:[{ component:'client', version:'0.4.0', severity:'high', errorName:'TypeError', message:'boom', stack:'at render (ui.js:1:1)', context:{ operation:'render' }, occurredAt:'2026-08-26T12:00:00Z' }] }
});
assert.equal(response.statusCode,202);
assert.equal(repo.calls.length,1);
```

Test >20 rejected, forged `userId` ignored, valid bearer associates only authenticated internal UUID, unauthenticated stores no IP identity, and repository failure returns bounded 503 without recursive telemetry.

- [ ] **Step 2: Implement route** with zod shape + Fastify route limit `60 requests / 5 minutes / source`, optional auth, server sanitizer, fingerprint, repository. Never log raw payload.

- [ ] **Step 3: Register dependencies and run tests**

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/telemetry.js server/src/app.js server/src/server.js server/test/routes/telemetry.test.js
git commit -m "feat: ingest sanitized ReviveRelay errors"
```

### Task 4: Add Client Error Capture and Bounded Outbox

**Files:**
- Create: `src/telemetry-client.js`
- Modify: `src/api-client.js`
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Create: `test/telemetry-client.test.js`
- Create: `test/telemetry-integration.test.js`

**Interfaces:**
- Produces: `createTelemetryClient({ submit, getStoredQueue, saveStoredQueue, version, buildCommit, now })`, `captureError(error, context)`, `drain()`.

- [ ] **Step 1: Write RED client tests**

```js
const sent = [];
let saved = [];
const client = createTelemetryClient({ submit:async batch=>sent.push(batch), getStoredQueue:()=>saved, saveStoredQueue:q=>{ saved=q; }, version:'0.4.0', buildCommit:'abc', now:()=>1000 });
client.captureError(new Error('boom'), { operation:'render' });
await client.drain();
assert.equal(sent[0].errors.length,1);
assert.equal(sent[0].errors[0].component,'client');
```

Test 60-second local coalescing, queue max 100, batch max 20, oldest drop counter, no recursion on submit failure, and redaction before `GM_setValue`.

- [ ] **Step 2: Implement sanitized outbox** storing safe envelopes only.

- [ ] **Step 3: Add API client `submitTelemetry(errors)`**; its transport errors are explicitly excluded from telemetry capture.

- [ ] **Step 4: Wire global hooks**

```js
window.addEventListener('error', event => telemetry.captureError(event.error || new Error(event.message), { operation:'window.error' }));
window.addEventListener('unhandledrejection', event => telemetry.captureError(event.reason instanceof Error ? event.reason : new Error(String(event.reason)), { operation:'unhandledrejection' }));
```

- [ ] **Step 5: Wrap meaningful ReviveRelay operation failures** with safe operation names only, never user/chat/evidence content.

- [ ] **Step 6: Run client tests/build and commit**

Run: `npm run test:client && npm run build && node --check dist/torn-revive-chat-collector.user.js`

```bash
git add src/telemetry-client.js src/api-client.js torn-revive-chat-collector.user.js scripts/build.js test/telemetry-client.test.js test/telemetry-integration.test.js
git commit -m "feat: capture sanitized userscript errors"
```

### Task 5: Capture API, Worker, Torn, and Fatal Operational Failures

**Files:**
- Create: `server/src/telemetry/reporter.js`
- Modify: `server/src/worker/runner.js`
- Modify: `server/src/torn/client.js`
- Modify: `server/src/server.js`
- Modify: `server/src/worker.js`
- Create: `server/test/telemetry/reporter.test.js`
- Modify: `server/test/worker/runner.test.js`
- Modify: `server/test/torn/client.test.js`

**Interfaces:**
- Produces: `createTelemetryReporter({ repository, product, version, buildCommit })` with non-throwing `report(error, context)`.

- [ ] **Step 1: Write RED reporter test**

```js
const reporter = createTelemetryReporter({ repository:{ recordOccurrence:async e=>recorded.push(e) }, product:'reviverelay', version:'0.4.0', buildCommit:'abc' });
await reporter.report(new Error('DATABASE_URL=postgres://user:pass@db/x failed'), { component:'api', operation:'startup' });
assert.equal(recorded.length,1);
assert.doesNotMatch(JSON.stringify(recorded[0]), /user:pass/);
```

Repository failure must resolve without throwing.

- [ ] **Step 2: Implement reporter** using server sanitizer/fingerprint.

- [ ] **Step 3: Wire worker runner** for unknown job types/handler failures with safe job type, no raw payload.

- [ ] **Step 4: Wire Torn client** for 429/5xx/malformed/timeout/invalid-key classes with safe status/operation and no key/query string.

- [ ] **Step 5: Wire API/worker startup catch boundaries** to report then preserve current exit semantics.

- [ ] **Step 6: Run tests and commit**

```bash
git add server/src/telemetry/reporter.js server/src/worker/runner.js server/src/torn/client.js server/src/server.js server/src/worker.js server/test/telemetry/reporter.test.js server/test/worker/runner.test.js server/test/torn/client.test.js
git commit -m "feat: report server and worker failures safely"
```

### Task 6: Mirror Aggregate Errors to the Private Google Sheet

**Files:**
- Modify: `server/package.json`
- Create: `server/src/integrations/google-sheets.js`
- Create: `server/src/worker/sheets-mirror.js`
- Modify: `server/src/worker.js`
- Modify: `server/src/config.js`
- Modify: `deploy/docker-compose.yml`
- Create: `server/test/integrations/google-sheets.test.js`
- Create: `server/test/worker/sheets-mirror.test.js`
- Modify: `server/test/config.test.js`

**Interfaces:**
- Produces: `createGoogleSheetsClient({ credentialsPath, spreadsheetId, sheetName })`, `createSheetsMirrorHandler({ telemetryRepository, sheetsClient, clock })`.

- [ ] **Step 1: Add `googleapis` without introducing a lockfile into the current no-lockfile repository**

Run: `npm --prefix server install googleapis --save --package-lock=false`

Verify only `server/package.json` is tracked as dependency metadata change.

- [ ] **Step 2: Write RED Sheet adapter tests** with fake Google adapter. Headers are exactly:

```js
['Product','Fingerprint','Severity','Component','First Version','Last Version','Summary','Occurrences','Affected Authenticated Users','First Seen','Last Seen','Last Build Commit','Last Sync','Status','Owner','Notes','GitHub Issue','Fixed In']
```

Existing fingerprint updates A:M only; N:R remain untouched.

- [ ] **Step 3: Implement adapter** using `REVIVERELAY_GOOGLE_SERVICE_ACCOUNT_FILE`, `REVIVERELAY_ERROR_SHEET_ID`, tab default `ReviveRelay Issues`.

- [ ] **Step 4: Write/implement `sheets.mirror` handler**: one row/fingerprint, new row Status `New`, mark successful groups mirrored, Google outage reschedules only this job.

- [ ] **Step 5: Mount service-account file read-only into the worker container only** under existing ReviveRelay secret namespace. PostgreSQL and unrelated containers never receive the file/path.

- [ ] **Step 6: Run integration/config/worker tests and commit**

```bash
git add server/package.json server/src/integrations/google-sheets.js server/src/worker/sheets-mirror.js server/src/worker.js server/src/config.js deploy/docker-compose.yml server/test/integrations/google-sheets.test.js server/test/worker/sheets-mirror.test.js server/test/config.test.js
git commit -m "feat: mirror ReviveRelay errors to Google Sheets"
```

### Task 7: Retention, Internal Verification, and Merge

**Files:**
- Create: `server/src/worker/telemetry-retention.js`
- Modify: `server/src/db/jobs.js`
- Modify: `server/src/worker.js`
- Modify: `README.md`
- Create: `server/test/worker/telemetry-retention.test.js`

**Interfaces:**
- Produces 30-day occurrence cleanup plus verified one-way error triage on internal deployment.

- [ ] **Step 1: Write RED retention test**: old occurrences removed; group/version aggregates preserved.

- [ ] **Step 2: Add `telemetry.retention` job type/handler**, scheduled once daily through the deduplicated job queue.

- [ ] **Step 3: Run full tests/build**

Run: `npm test && npm run build && node --check dist/torn-revive-chat-collector.user.js`

Expected: PASS with disposable PostgreSQL configured for DB tests.

- [ ] **Step 4: Run isolation gates** proving Google credentials are worker-only ReviveRelay secrets and DB/network isolation is unchanged.

- [ ] **Step 5: Deploy internally**, migrate, restart only ReviveRelay API/worker, inject one synthetic sanitized test error, verify one PostgreSQL group, run mirror, verify one aggregate Sheet row with no Torn/internal IDs/secrets.

- [ ] **Step 6: Put human Status/Notes into the test row, mirror again, and prove those cells remain unchanged.**

- [ ] **Step 7: Update README, commit, merge completed telemetry branch to local `main`, rerun full tests, synchronize GitHub `main`, verify tree equality, remove the completed worktree/branch, and update the Voidsmith Source of Truth with verified facts only.**
