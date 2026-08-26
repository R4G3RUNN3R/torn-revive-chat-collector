# ReviveRelay Error Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sanitized automatic ReviveRelay error telemetry with PostgreSQL deduplication, per-version regression tracking, client/server/worker capture, and a one-way Google Sheet triage mirror that preserves human notes.

**Architecture:** Every telemetry producer first converts raw errors into a bounded safe envelope. The server sanitizes again, fingerprints without application version, records one aggregate error group plus per-version counters and short-lived occurrences, and exports aggregate rows to a private Google Sheet. Telemetry is operational only: it cannot mutate transactions, users, bans, credentials, subscriptions, or any other marketplace state.

**Tech Stack:** Node.js 20, Fastify 5, PostgreSQL 16, `pg`, `zod`, Node test runner, Tampermonkey userscript, Google Sheets API via `googleapis` server-side dependency.

**Spec:** `docs/superpowers/specs/2026-08-26-reviverelay-stage3-marketplace-verification-design.md`

## Global Constraints

- Error telemetry must never store or export Torn API keys, ReviveRelay bearer/session tokens, Authorization headers, cookies, DB/encryption/Google credentials, chat messages, requester comments, arbitrary request/response bodies, evidence payload bodies, or unrelated player data.
- Fingerprints exclude application version so the same bug remains one issue across releases.
- Per-version aggregate counters preserve regression visibility.
- Raw sanitized occurrence retention target is 30 days; aggregate groups are retained at least 24 months.
- Valid sessions may associate an internal ReviveRelay user UUID for distinct-user counting, but the Google Sheet never receives Torn IDs or internal user UUIDs.
- Unauthenticated telemetry must not persist durable IP identity.
- Client telemetry delivery failure must never recursively generate telemetry.
- Google Sheets is a one-way human triage mirror only. Sheet edits never mutate ReviveRelay operational state.
- Google service-account credentials remain server secrets outside PostgreSQL and Git.
- ReviveRelay database/network isolation from every other Voidsmith product remains unchanged.
- Completed and verified work is merged to `main`.

---

### Task 1: Add Telemetry Schema and Aggregate Repository

**Files:**
- Create: `server/src/db/migrations/004_error_telemetry.sql`
- Create: `server/src/db/error-telemetry.js`
- Create: `server/test/db/error-telemetry.test.js`

**Interfaces:**
- Produces: `createErrorTelemetryRepository(pool)` with `recordOccurrence(envelope)`, `listGroupsForMirror()`, `markMirrored(groupIds, at)`, and `purgeOccurrences(before)`.

- [ ] **Step 1: Write RED schema/repository tests**

```js
const first = await repo.recordOccurrence({
  fingerprint: 'abc', product: 'reviverelay', component: 'client', severity: 'high',
  summary: 'TypeError: cannot read property', representativeStack: 'at render (client.js:10)',
  version: '0.4.0', buildCommit: 'a1', userId: null, context: { operation: 'render' }, occurredAt: new Date()
});
const second = await repo.recordOccurrence({ ...input, version: '0.4.1', buildCommit: 'b2' });
assert.equal(first.groupId, second.groupId);
const group = await repo.getGroup(first.groupId);
assert.equal(group.occurrenceCount, 2);
```

Also assert version `0.4.0` and `0.4.1` each have their own `error_group_versions` count and that occurrences older than a cutoff can be purged without deleting the aggregate group.

- [ ] **Step 2: Run RED DB tests**

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

CREATE INDEX error_occurrences_received_at ON error_occurrences(received_at);
CREATE INDEX error_occurrences_group_user ON error_occurrences(error_group_id,user_id) WHERE user_id IS NOT NULL;
```

- [ ] **Step 4: Implement repository recording in one DB transaction**

`recordOccurrence` must UPSERT `error_groups`, UPSERT `error_group_versions`, insert the bounded occurrence, and preserve first/last timestamps correctly under concurrent inserts.

- [ ] **Step 5: Implement mirror query** returning aggregate-only fields plus `COUNT(DISTINCT user_id)` from retained occurrences. Never return Torn ID.

- [ ] **Step 6: Run DB tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/db/migrations/004_error_telemetry.sql server/src/db/error-telemetry.js server/test/db/error-telemetry.test.js
git commit -m "feat: add error telemetry storage"
```

### Task 2: Build the Double-Sanitization and Fingerprinting Layer

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
  component: 'client', version: '0.4.0', severity: 'high', errorName: 'Error',
  message: 'Authorization: Bearer SECRET_TOKEN apiKey=ABC123 cookie=session',
  stack: 'Error: boom\n at fn (https://example/x.js?key=ABC123:1:2)',
  context: { operation: 'request', requestBody: { apiKey: 'ABC123' }, route: '/v1/requests' }
});
assert.doesNotMatch(JSON.stringify(output), /SECRET_TOKEN|ABC123|requestBody|cookie/i);
assert.equal(output.context.route, '/v1/requests');
```

Add cases for 32+ character token-like strings, database URLs, email-like credentials in URLs, `Authorization`, `Cookie`, `apiKey`, `token`, `secret`, `password`, chat/message/comment/evidence/body keys, oversized stack/message/context, circular-looking input converted at the boundary, and unsupported context keys being dropped.

- [ ] **Step 2: Run RED sanitizer tests**

Expected: FAIL.

- [ ] **Step 3: Implement strict allowlist sanitizer**

Allowed context keys are only:

```js
const SAFE_CONTEXT_KEYS = new Set([
  'operation','route','jobType','httpStatus','tornStatus','state','method','retryable','releaseChannel'
]);
```

Limits: message 1000 chars, stack 8000 chars, each context string 250 chars, at most 12 context keys. Redaction runs before truncation and again on serialized output.

- [ ] **Step 4: Write RED fingerprint tests**

```js
const a = fingerprintError({ product:'reviverelay', component:'client', errorCode:'TYPE_ERROR', message:'Cannot read x for user 12345', stack:'at render (/src/ui.js:42:7)', version:'0.4.0' });
const b = fingerprintError({ product:'reviverelay', component:'client', errorCode:'TYPE_ERROR', message:'Cannot read x for user 67890', stack:'at render (/src/ui.js:99:7)', version:'0.4.1' });
assert.equal(a, b);
```

- [ ] **Step 5: Implement version-independent fingerprint normalization**

Normalize numeric IDs, UUIDs, ISO timestamps, line/column numbers, quoted dynamic values, and URLs while retaining stable error type/message template/top three stack function/file signatures. Hash canonical JSON with SHA-256.

- [ ] **Step 6: Run telemetry unit tests**

Expected: PASS.

- [ ] **Step 7: Commit**

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
- Consumes: sanitizer/fingerprint/repository.
- Produces: `POST /v1/telemetry/errors` accepting one occurrence or a bounded batch of at most 20 envelopes.

- [ ] **Step 1: Write RED route tests**

```js
const response = await app.inject({
  method: 'POST', url: '/v1/telemetry/errors',
  payload: { errors: [{ component:'client', version:'0.4.0', severity:'high', errorName:'TypeError', message:'boom', stack:'at render (ui.js:1:1)', context:{ operation:'render' }, occurredAt:'2026-08-26T12:00:00Z' }] }
});
assert.equal(response.statusCode, 202);
assert.equal(repo.calls.length, 1);
```

Also test >20 rejected, oversized fields rejected/sanitized, forged `userId` ignored, valid bearer session associates only `request.reviveRelayUser.id`, unauthenticated request stores no IP identity, and telemetry repository failure returns bounded 503 without recursively invoking telemetry.

- [ ] **Step 2: Run RED route test**

Expected: FAIL.

- [ ] **Step 3: Implement `registerTelemetryRoutes`**

Use `zod` for input shape and Fastify route rate limit, initially `60 requests / 5 minutes / source`. Accept optional session auth without requiring it. The route must derive user association only from a successfully authenticated ReviveRelay session.

- [ ] **Step 4: Sanitize twice**

Route validates raw shape, calls `sanitizeTelemetryEnvelope`, computes `fingerprintError`, then repository persists the sanitized result. No raw payload is logged.

- [ ] **Step 5: Register dependencies in app/server and run route tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/telemetry.js server/src/app.js server/src/server.js server/test/routes/telemetry.test.js
git commit -m "feat: ingest sanitized ReviveRelay errors"
```

### Task 4: Add Client-Side Error Capture and Bounded Telemetry Outbox

**Files:**
- Create: `src/telemetry-client.js`
- Modify: `src/api-client.js`
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Create: `test/telemetry-client.test.js`
- Create: `test/telemetry-integration.test.js`

**Interfaces:**
- Produces: `createTelemetryClient({ submit, getStoredQueue, saveStoredQueue, version, buildCommit, now })`, `captureError(error, context)`, `captureUnhandledRejection(event, context)`, `drain()`.

- [ ] **Step 1: Write RED client tests**

```js
const client = createTelemetryClient({ submit: async batch => sent.push(batch), getStoredQueue: () => [], saveStoredQueue: q => saved = q, version:'0.4.0', buildCommit:'abc', now:() => 1000 });
client.captureError(new Error('boom'), { operation:'render' });
await client.drain();
assert.equal(sent[0].errors.length, 1);
assert.equal(sent[0].errors[0].component, 'client');
```

Also test repeated identical errors within 60 seconds coalesce locally, queue max 100, batch max 20, oldest entries dropped with only a local counter, telemetry-submit failure does not capture itself, and secrets are redacted before `GM_setValue`.

- [ ] **Step 2: Run RED client tests**

Expected: FAIL.

- [ ] **Step 3: Implement client sanitizer/outbox**

Client uses a smaller safe-envelope builder and never persists raw thrown objects. Stored queue contains only sanitized envelopes.

- [ ] **Step 4: Extend API client** with `submitTelemetry(errors)` calling unauthenticated-or-authenticated `POST /v1/telemetry/errors`. Mark this call with an internal `telemetryTransport` flag so network errors are not recursively reported.

- [ ] **Step 5: Wire global hooks**

```js
window.addEventListener('error', event => telemetry.captureError(event.error || new Error(event.message), { operation:'window.error' }));
window.addEventListener('unhandledrejection', event => telemetry.captureError(event.reason instanceof Error ? event.reason : new Error(String(event.reason)), { operation:'unhandledrejection' }));
```

Wrap meaningful ReviveRelay operation failures at call sites with safe operation names, not user content.

- [ ] **Step 6: Add module to userscript/build and run client tests/build**

Run: `npm run test:client && npm run build && node --check dist/torn-revive-chat-collector.user.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/telemetry-client.js src/api-client.js torn-revive-chat-collector.user.js scripts/build.js test/telemetry-client.test.js test/telemetry-integration.test.js
git commit -m "feat: capture sanitized userscript errors"
```

### Task 5: Capture API, Worker, Torn, and Operational Failures

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
- Produces: `createTelemetryReporter({ repository, product, version, buildCommit })` with `report(error, context)` that never throws to its caller.

- [ ] **Step 1: Write RED reporter test**

```js
const reporter = createTelemetryReporter({ repository: { recordOccurrence: async e => recorded.push(e) }, product:'reviverelay', version:'0.4.0', buildCommit:'abc' });
await reporter.report(new Error('DATABASE_URL=postgres://user:pass@db/x failed'), { component:'api', operation:'startup' });
assert.equal(recorded.length, 1);
assert.doesNotMatch(JSON.stringify(recorded[0]), /user:pass/);
```

Test repository failure resolves without throwing.

- [ ] **Step 2: Implement reporter** using the same server sanitizer/fingerprint functions.

- [ ] **Step 3: Wire worker runner** so unknown job types and handler exceptions call reporter with `component:'worker'`, safe `jobType`, and no raw job payload.

- [ ] **Step 4: Wire Torn client** so 429, 5xx, malformed response, timeout and invalid credential classifications emit safe `component:'torn'` telemetry with status/operation, never API key/query string.

- [ ] **Step 5: Wire process-level API/worker fatal handlers** at startup catch boundaries. Do not add global handlers that swallow fatal process behavior; report then preserve the existing exit semantics.

- [ ] **Step 6: Run server telemetry/worker/Torn tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/telemetry/reporter.js server/src/worker/runner.js server/src/torn/client.js server/src/server.js server/src/worker.js server/test/telemetry/reporter.test.js server/test/worker/runner.test.js server/test/torn/client.test.js
git commit -m "feat: report server and worker failures safely"
```

### Task 6: Add the Google Sheet Triage Mirror

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
- Produces: `createGoogleSheetsClient({ credentialsPath, spreadsheetId, sheetName })` and `createSheetsMirrorHandler({ telemetryRepository, sheetsClient, clock })`.

- [ ] **Step 1: Add `googleapis` dependency**

Run: `npm --prefix server install googleapis --save`

Expected: `server/package.json` and lockfile/dependency metadata updated according to the repository package-management policy.

- [ ] **Step 2: Write RED Sheets client tests with a fake Google API adapter**

Assert headers are exactly:

```js
['Product','Fingerprint','Severity','Component','First Version','Last Version','Summary','Occurrences','Affected Authenticated Users','First Seen','Last Seen','Last Build Commit','Last Sync','Status','Owner','Notes','GitHub Issue','Fixed In']
```

and that updating an existing fingerprint replaces columns A:M only while preserving N:R.

- [ ] **Step 3: Implement Sheets adapter**

Authenticate from `REVIVERELAY_GOOGLE_SERVICE_ACCOUNT_FILE`, spreadsheet ID from `REVIVERELAY_ERROR_SHEET_ID`, tab name default `ReviveRelay Issues`. Never accept credentials from PostgreSQL or API requests.

- [ ] **Step 4: Write RED mirror-handler tests** proving one row per fingerprint, new rows get `Status='New'`, existing manual columns survive, successful rows call `markMirrored`, Google outage reschedules without affecting marketplace jobs.

- [ ] **Step 5: Implement `sheets.mirror` handler** and enqueue one deduplicated mirror job every 15 minutes. The handler mirrors aggregate groups only, never raw occurrences.

- [ ] **Step 6: Add secret-file mount/config** under the existing ReviveRelay secret namespace. Compose must mount the service-account JSON read-only into API/worker only if required; PostgreSQL never receives it.

- [ ] **Step 7: Run integration/config/worker tests**

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/package.json server/src/integrations/google-sheets.js server/src/worker/sheets-mirror.js server/src/worker.js server/src/config.js deploy/docker-compose.yml server/test/integrations/google-sheets.test.js server/test/worker/sheets-mirror.test.js server/test/config.test.js
git commit -m "feat: mirror ReviveRelay errors to Google Sheets"
```

### Task 7: Add Retention, Runtime Verification, and Merge

**Files:**
- Create: `server/src/worker/telemetry-retention.js`
- Modify: `server/src/db/jobs.js`
- Modify: `server/src/worker.js`
- Modify: `README.md`
- Create: `server/test/worker/telemetry-retention.test.js`

**Interfaces:**
- Produces automatic 30-day occurrence purge and verified one-way triage mirror in internal deployment.

- [ ] **Step 1: Add RED retention test** proving `purgeOccurrences(new Date(now - 30 days))` removes old occurrence rows while preserving groups/version aggregates.

- [ ] **Step 2: Implement daily deduplicated `telemetry.retention` job type/handler** and add it to the worker registry.

- [ ] **Step 3: Run full tests and build**

Run: `npm test && npm run build && node --check dist/torn-revive-chat-collector.user.js`

Expected: PASS with disposable PostgreSQL configured for DB tests.

- [ ] **Step 4: Run static/runtime isolation gates** proving Google credentials are mounted only into ReviveRelay application containers, PostgreSQL remains network/credential isolated, and no other Voidsmith project receives the Sheet credentials.

- [ ] **Step 5: Deploy internally**, migrate, restart only ReviveRelay API/worker, inject one synthetic sanitized test error, verify one PostgreSQL error group is created, run mirror job, and verify the private Sheet receives one aggregate row with no secret/Torn-ID fields.

- [ ] **Step 6: Verify manual Sheet columns survive a second sync** by setting Status/Notes in the test row and rerunning the mirror.

- [ ] **Step 7: Update README**, commit, merge completed telemetry branch to `main`, rerun full tests on merged `main`, synchronize GitHub `main`, verify tree equality, remove completed worktree/branch, and update the Voidsmith Source of Truth with verified facts only.

```bash
git add server/src/worker/telemetry-retention.js server/src/db/jobs.js server/src/worker.js README.md server/test/worker/telemetry-retention.test.js
git commit -m "feat: operationalize ReviveRelay error telemetry"
```
