# ReviveRelay Stage 1 Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a testable, isolated ReviveRelay backend foundation with PostgreSQL, authenticated Torn identity binding, public candidate ingestion/deduplication, direct-request persistence/concurrency primitives, and production-shaped VPS deployment files.

**Architecture:** Add a self-contained `server/` Node.js package with a Fastify API and a separate worker entrypoint, both talking only to a dedicated ReviveRelay PostgreSQL instance. The userscript remains untouched except for shared public-channel definitions needed by the server. Integration tests use a PostgreSQL service in CI so constraints and locking behavior are tested against the real database engine.

**Tech Stack:** Node.js 20+, Fastify, PostgreSQL 16, `pg`, Zod, Node `crypto`, Node built-in test runner, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

**Amendment:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-review-amendment.md`

## Global Constraints

- Public candidate ingestion is allowlist-only; forbidden or unknown channels are rejected server-side.
- Cash minimum is 500000; Xanax minimum is 1; quantities are integers.
- One active direct request per requester.
- Request acceptance must be atomic.
- Three-minute payment deadline, 60-second reconciliation, five-minute post-verification revive SLA, two-minute retry response, ten-minute refund deadline.
- PostgreSQL has no public host port and is not shared with DungeonMasterOS/Nexis.
- API keys encrypted at rest; session tokens stored only as hashes.
- Google Sheets is not used by Stage 1 as an authority.
- TDD for every behavior change.

---

### Task 1: Create the backend package and configuration boundary

**Files:**
- Create: `server/package.json`
- Create: `server/src/config.js`
- Create: `server/test/config.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `loadConfig(env) -> Config`
- `Config` fields: `NODE_ENV`, `PORT`, `DATABASE_URL`, `API_KEY_ENCRYPTION_KEY`, `SESSION_TOKEN_PEPPER`, `TORN_API_BASE_URL`, `OPERATOR_TORN_ID`, `ADMIN_API_TOKEN`, `SHEETS_MIRROR_URL`, `SHEETS_MIRROR_TOKEN`, `PAID_TIER_ENABLED`.

- [ ] **Step 1: Write the failing config tests**

```js
// server/test/config.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('loadConfig rejects missing database URL', () => {
  assert.throws(() => loadConfig({
    API_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
    SESSION_TOKEN_PEPPER: 'pepper'
  }), /DATABASE_URL/);
});

test('loadConfig accepts a complete development environment', () => {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    PORT: '3100',
    DATABASE_URL: 'postgres://reviverelay:test@localhost/reviverelay_test',
    API_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
    SESSION_TOKEN_PEPPER: 'pepper',
    TORN_API_BASE_URL: 'https://api.torn.com/v2',
    OPERATOR_TORN_ID: '123456',
    ADMIN_API_TOKEN: 'admin-test-token',
    SHEETS_MIRROR_URL: '',
    SHEETS_MIRROR_TOKEN: '',
    PAID_TIER_ENABLED: 'false'
  });
  assert.equal(cfg.PORT, 3100);
  assert.equal(cfg.PAID_TIER_ENABLED, false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test server/test/config.test.js`

Expected: FAIL because `server/src/config.js` does not exist.

- [ ] **Step 3: Add package metadata and minimal validated config**

`server/package.json` must contain:

```json
{
  "name": "reviverelay-server",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test test/**/*.test.js",
    "start": "node src/server.js",
    "worker": "node src/worker.js",
    "migrate": "node src/db/migrate.js"
  },
  "dependencies": {
    "@fastify/rate-limit": "^10.0.0",
    "fastify": "^5.0.0",
    "pg": "^8.13.0",
    "zod": "^3.23.8"
  }
}
```

Implement `loadConfig` with Zod coercion and exact required fields. `API_KEY_ENCRYPTION_KEY` must be 64 hex characters representing 32 bytes; `PAID_TIER_ENABLED` parses only `'true'` as true.

Modify root `package.json` scripts to add:

```json
"test:server": "npm --prefix server test"
```

and make root `test` execute existing client tests followed by server tests after dependencies are installed in CI.

- [ ] **Step 4: Run focused tests**

Run: `node --test server/test/config.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json server/package.json server/src/config.js server/test/config.test.js
git commit -m "feat(server): add backend package configuration"
```

---

### Task 2: Define isolated Docker/VPS deployment files

**Files:**
- Create: `deploy/docker-compose.yml`
- Create: `deploy/.env.example`
- Create: `deploy/reviverelay.nginx.conf.example`
- Create: `deploy/README.md`
- Create: `server/test/deployment-isolation.test.js`

**Interfaces:**
- Produces Docker services: `reviverelay-api`, `reviverelay-worker`, `reviverelay-db`.
- Produces private network: `reviverelay_internal`.
- Host project root: `/srv/voidsmith/reviverelay`.

- [ ] **Step 1: Write failing static isolation tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const compose = fs.readFileSync('deploy/docker-compose.yml', 'utf8');

test('database has no published host port', () => {
  const dbBlock = compose.split('reviverelay-db:')[1].split('\n  reviverelay-')[0];
  assert.ok(!/\n\s+ports:/.test(dbBlock));
});

test('compose names only ReviveRelay database resources', () => {
  assert.match(compose, /reviverelay_internal/);
  assert.doesNotMatch(compose, /dungeonmaster|nexis/i);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test server/test/deployment-isolation.test.js`

Expected: FAIL because deployment files do not exist.

- [ ] **Step 3: Create production-shaped compose**

The compose file must:

- use `postgres:16-alpine` for `reviverelay-db`;
- mount `${REVIVERELAY_DATA_DIR:-/srv/voidsmith/reviverelay/data/postgres}:/var/lib/postgresql/data`;
- define no `ports:` entry for the DB;
- put DB/API/worker on `reviverelay_internal` with `internal: true`;
- expose API only on loopback, e.g. `127.0.0.1:${REVIVERELAY_API_PORT:-3100}:3100`, for the host reverse proxy;
- give API/worker their own `DATABASE_URL` referencing `reviverelay-db`;
- never reference another Voidsmith DB service/network.

`deploy/.env.example` contains variable names and dummy values only, including a comment that real secrets live in `/srv/voidsmith/reviverelay/config/.env` with mode `0600`.

`deploy/README.md` includes exact directory creation commands:

```bash
sudo mkdir -p /srv/voidsmith/reviverelay/{app,config,data/postgres,backups,logs}
sudo chown -R "$USER":"$USER" /srv/voidsmith/reviverelay
chmod 700 /srv/voidsmith/reviverelay/config
```

and explicit checks proving no other database credentials/networks are referenced.

- [ ] **Step 4: Run test and syntax/config checks**

Run: `node --test server/test/deployment-isolation.test.js`

Expected: PASS.

On a machine with Docker: `docker compose --env-file deploy/.env.example -f deploy/docker-compose.yml config`

Expected: valid compose output.

- [ ] **Step 5: Commit**

```bash
git add deploy server/test/deployment-isolation.test.js
git commit -m "feat(deploy): isolate ReviveRelay VPS services"
```

---

### Task 3: Add PostgreSQL connection and migration runner

**Files:**
- Create: `server/src/db/pool.js`
- Create: `server/src/db/migrate.js`
- Create: `server/src/db/migrations/001_initial.sql`
- Create: `server/test/db/migrations.test.js`
- Modify: `.github/workflows/test.yml`

**Interfaces:**
- Produces: `createPool(connectionString) -> pg.Pool`
- Produces CLI: `npm --prefix server run migrate`

- [ ] **Step 1: Write failing migration integration test**

Test requires `TEST_DATABASE_URL`. It runs the migration runner, then queries `information_schema.tables` and asserts at least these tables exist:

```js
const expected = [
  'users', 'api_credentials', 'sessions', 'revivers',
  'public_chat_candidates', 'revive_requests', 'transactions',
  'payments', 'revive_attempts', 'refunds', 'disputes',
  'bans', 'subscriptions', 'audit_events'
];
```

Also assert the partial unique index enforcing one open request per requester exists.

- [ ] **Step 2: Add PostgreSQL 16 service to CI and verify RED**

Modify `.github/workflows/test.yml` job:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_USER: reviverelay
      POSTGRES_PASSWORD: test
      POSTGRES_DB: reviverelay_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U reviverelay"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

Set `TEST_DATABASE_URL=postgres://reviverelay:test@127.0.0.1:5432/reviverelay_test` for server integration tests.

Expected initial CI/local test failure because migration files are absent.

- [ ] **Step 3: Implement migration runner**

Migration runner behavior:

```js
async function migrate(pool, dir) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  // read sorted *.sql; for each unapplied file BEGIN -> SQL -> insert filename -> COMMIT
}
```

`001_initial.sql` creates UUID extension and all Stage 1 schema with foreign keys, check constraints, timestamps, and indexes. Required checks include:

```sql
CHECK (payment_method IN ('cash','xanax')),
CHECK ((payment_method = 'cash' AND offer_amount >= 500000)
    OR (payment_method = 'xanax' AND offer_amount >= 1)),
CHECK (offer_amount = trunc(offer_amount))
```

Create:

```sql
CREATE UNIQUE INDEX revive_requests_one_active_per_requester
ON revive_requests(requester_id)
WHERE closed_at IS NULL;
```

`public_chat_candidates` contains both `canonical_key` (nullable unique when source identity exists) and `fallback_basis_hash` for rolling-window matching.

- [ ] **Step 4: Run migration test twice**

Run:

```bash
TEST_DATABASE_URL=postgres://reviverelay:test@127.0.0.1:5432/reviverelay_test node --test server/test/db/migrations.test.js
```

Expected: PASS both migration application and idempotent second run.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/test.yml server/src/db server/test/db
git commit -m "feat(db): add ReviveRelay schema and migrations"
```

---

### Task 4: Encrypt Torn API credentials and issue opaque sessions

**Files:**
- Create: `server/src/security/crypto.js`
- Create: `server/src/security/sessions.js`
- Create: `server/test/security/crypto.test.js`
- Create: `server/test/security/sessions.test.js`

**Interfaces:**
- `encryptSecret(plaintext, keyHex) -> { ciphertext, iv, tag }`
- `decryptSecret(record, keyHex) -> plaintext`
- `newSessionToken() -> string`
- `hashSessionToken(token, pepper) -> hex string`

- [ ] **Step 1: Write failing crypto/session tests**

```js
test('AES-GCM round-trips an API key and rejects wrong key', () => {
  const key = '11'.repeat(32);
  const encrypted = encryptSecret('abc123', key);
  assert.equal(decryptSecret(encrypted, key), 'abc123');
  assert.throws(() => decryptSecret(encrypted, '22'.repeat(32)));
});

test('session token hash is deterministic but token itself is random', () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.notEqual(a, b);
  assert.equal(hashSessionToken(a, 'p'), hashSessionToken(a, 'p'));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test server/test/security/*.test.js`

Expected: missing module failures.

- [ ] **Step 3: Implement AES-256-GCM and token hashing**

Use only Node built-ins:

```js
const { randomBytes, createCipheriv, createDecipheriv, createHash } = require('node:crypto');
```

Never expose decrypted values from loggable objects. Store session token hashes, not plaintext tokens.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/security server/test/security
git commit -m "feat(security): encrypt Torn keys and hash sessions"
```

---

### Task 5: Build Torn API adapter and identity binding

**Files:**
- Create: `server/src/torn/client.js`
- Create: `server/src/routes/auth.js`
- Create: `server/src/db/users.js`
- Create: `server/src/app.js`
- Create: `server/src/server.js`
- Create: `server/test/torn/client.test.js`
- Create: `server/test/routes/auth.test.js`

**Interfaces:**
- `createTornClient({ baseUrl, fetchImpl })`
- `torn.getKeyInfo(apiKey) -> { tornId: number, name: string, access: object }`
- `POST /v1/auth/bind` body `{ apiKey, clientVersion }`
- response `{ token, user: { tornId, name }, keyAccess }`

- [ ] **Step 1: Write Torn client parsing test with a fake fetch**

Fake Torn response must include a stable Torn user ID/name and access metadata. Assert malformed/error responses produce typed errors (`TORN_INVALID_KEY`, `TORN_UNAVAILABLE`).

- [ ] **Step 2: Write route test and verify RED**

Use Fastify `app.inject()` with a stub Torn client and test DB repository. Assert raw API key never appears in response/log payload and only the encrypted credential is persisted.

- [ ] **Step 3: Implement Torn client and bind route**

Route flow:

1. validate body with Zod;
2. call `getKeyInfo`;
3. upsert `users` by Torn ID/name;
4. encrypt API key into `api_credentials`;
5. generate opaque session token;
6. store token hash in `sessions`;
7. emit `audit_events` row `identity.bound` without secret material;
8. return plaintext session token once.

- [ ] **Step 4: Run focused route/client tests**

Run: `node --test server/test/torn/client.test.js server/test/routes/auth.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/torn server/src/routes/auth.js server/src/db/users.js server/src/app.js server/src/server.js server/test/torn server/test/routes
git commit -m "feat(auth): bind Torn identities to ReviveRelay sessions"
```

---

### Task 6: Add session authentication and role authorization

**Files:**
- Create: `server/src/security/authenticate.js`
- Create: `server/src/db/sessions.js`
- Create: `server/test/security/authenticate.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- `authenticateRequest(request) -> { userId, tornId, roles, sessionId }`
- Fastify decorator: `request.reviveRelayUser`

- [ ] **Step 1: Write tests for valid, revoked, expired and banned sessions**

Assert missing/invalid Bearer tokens return 401 and a banned reviver cannot receive a `reviver` capability even if their session is valid.

- [ ] **Step 2: Verify RED**

Run focused test.

- [ ] **Step 3: Implement constant-time token-hash lookup and auth hook**

Authorization uses server-held user/reviver/ban state. Client-supplied roles are ignored.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add server/src/security/authenticate.js server/src/db/sessions.js server/src/app.js server/test/security/authenticate.test.js
git commit -m "feat(auth): enforce ReviveRelay session authorization"
```

---

### Task 7: Create shared public-channel allowlist and enforce it at ingestion

**Files:**
- Create: `src/public-channels.js`
- Create: `test/public-channels.test.js`
- Create: `server/src/routes/candidates.js`
- Create: `server/test/routes/candidates-privacy.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- `canonicalPublicChannel(idOrName) -> { id, name, type } | null`
- `isPublicChannel(idOrName) -> boolean`
- `POST /v1/candidates`

- [ ] **Step 1: Write allowlist tests**

Must accept representative `public_global`, `public_trade`, `public_hospital`, `public_jail`, `public_new_player`, `public_travel_mexico` and reject `faction-*`, `company-*`, `private-*`, `competition-*`, blank and unknown IDs.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement UMD-compatible shared allowlist**

Use explicit public patterns only. Do not treat every `public_*` value automatically as safe unless its family is in the allowlist; unknown public values require code review/addition.

- [ ] **Step 4: Add server route privacy test**

A modified client posting:

```json
{"channelId":"faction-123","senderId":"1","senderName":"X","text":"rev me","classifierVersion":"2","score":99}
```

must receive 422 `CHANNEL_NOT_ALLOWED` and insert zero candidate rows.

- [ ] **Step 5: Implement route validation and run both test suites**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/public-channels.js test/public-channels.test.js server/src/routes/candidates.js server/test/routes/candidates-privacy.test.js server/src/app.js
git commit -m "feat(privacy): enforce public-only candidate ingestion"
```

---

### Task 8: Implement global candidate deduplication including 120-second fallback

**Files:**
- Create: `server/src/domain/candidate-identity.js`
- Create: `server/src/db/candidates.js`
- Create: `server/test/domain/candidate-identity.test.js`
- Create: `server/test/db/candidates-dedupe.test.js`
- Modify: `server/src/routes/candidates.js`

**Interfaces:**
- `buildCanonicalCandidateKey(candidate) -> string | null`
- `buildFallbackBasisHash(candidate) -> string`
- `upsertCandidate(pool, candidate, receivedAt) -> { candidate, duplicate }`

- [ ] **Step 1: Write canonical identity tests**

Assert source-message ID wins, timestamp identity ignores local capture time, and no-ID/no-timestamp returns `canonicalKey=null` plus a stable fallback-basis hash.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement SHA-256 identity helpers**

Use `node:crypto.createHash('sha256')`; normalized identity fields are channel + sender ID/name + source ID or Torn timestamp + text. Never use client `capturedAt` for cross-user canonical identity.

- [ ] **Step 4: Write PostgreSQL fallback-window integration tests**

Test three observations with identical channel/sender/text:

- t=0 seconds -> new row;
- t=45 seconds -> same row, `seen_count=2`;
- t=181 seconds -> new occurrence row.

Also fire two concurrent inserts at t=0 and assert one row, using a PostgreSQL transaction-scoped advisory lock keyed from the fallback hash.

- [ ] **Step 5: Implement repository locking/upsert**

Primary key path uses `INSERT ... ON CONFLICT (canonical_key) DO UPDATE`.

Fallback path:

```sql
SELECT pg_advisory_xact_lock(hashtextextended($1, 0));
SELECT id FROM public_chat_candidates
WHERE fallback_basis_hash = $1
  AND last_seen_at >= $2::timestamptz - interval '120 seconds'
ORDER BY last_seen_at DESC
LIMIT 1
FOR UPDATE;
```

Update existing or insert a new occurrence accordingly.

- [ ] **Step 6: Run unit + integration tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/domain/candidate-identity.js server/src/db/candidates.js server/test/domain server/test/db server/src/routes/candidates.js
git commit -m "feat(pool): deduplicate pooled revive candidates"
```

---

### Task 9: Implement direct-request validation and one-active-request guarantee

**Files:**
- Create: `server/src/domain/request.js`
- Create: `server/src/db/requests.js`
- Create: `server/src/routes/requests.js`
- Create: `server/test/domain/request.test.js`
- Create: `server/test/db/requests.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- `validateOffer({ paymentMethod, offerAmount, comment }) -> normalized offer`
- `POST /v1/requests`
- `GET /v1/requests/active`
- `POST /v1/requests/:id/cancel`

- [ ] **Step 1: Write offer-validation tests**

Cover Cash 499999 rejected, Cash 500000 accepted, Xanax 0 rejected, Xanax 1 accepted, fractions rejected, unknown payment method rejected, optional comment length capped (choose 500 characters and encode it in schema/test).

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement pure validator**

Return integer `offerAmount`; trim optional comment; server is authoritative.

- [ ] **Step 4: Write database concurrency test for one active request**

Fire two creates for the same requester concurrently. Assert exactly one succeeds and the second returns/references the existing active request rather than creating another row.

- [ ] **Step 5: Implement repository/routes**

Create state `AVAILABLE`; cancellation allowed only before verified payment/transaction commitment. Route must not trust requester Torn ID from body; take it from session.

- [ ] **Step 6: Run focused tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/domain/request.js server/src/db/requests.js server/src/routes/requests.js server/test/domain/request.test.js server/test/db/requests.test.js server/src/app.js
git commit -m "feat(requests): create protected direct revive requests"
```

---

### Task 10: Implement transaction state primitives and atomic Accept

**Files:**
- Create: `server/src/domain/transaction-state.js`
- Create: `server/src/db/transactions.js`
- Create: `server/src/routes/reviver-queue.js`
- Create: `server/test/domain/transaction-state.test.js`
- Create: `server/test/db/accept-race.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- States defined in one exported frozen object.
- `canTransition(from, event) -> to | null`
- `acceptRequest({ requestId, reviverId, now }) -> transaction`
- `GET /v1/reviver/queue`
- `POST /v1/requests/:id/accept`

- [ ] **Step 1: Write state tests for Stage 1 transitions**

At minimum:

```text
AVAILABLE --accept--> WAITING_FOR_PAYMENT
WAITING_FOR_PAYMENT --deadline--> PAYMENT_RECONCILING
PAYMENT_RECONCILING --valid_payment--> WAITING_FOR_REVIVE
PAYMENT_RECONCILING --no_payment--> AVAILABLE/released
PAYMENT_RECONCILING --late_payment--> REFUND_REQUIRED_LATE_PAYMENT
WAITING_FOR_REVIVE --success--> COMPLETED
WAITING_FOR_REVIVE --failed--> FAILED_ATTEMPT_CHOICE
FAILED_ATTEMPT_CHOICE --retry--> RETRY_OFFERED
RETRY_OFFERED --accepted--> WAITING_FOR_REVIVE
RETRY_OFFERED --declined_or_timeout--> REFUND_REQUIRED
REFUND_REQUIRED --refunded--> REFUNDED
```

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement pure transition table**

No route may directly set an arbitrary state string; all mutations go through domain events.

- [ ] **Step 4: Write real PostgreSQL Accept race test**

Two revivers concurrently accept the same `AVAILABLE` request. Assert one 200/success, one conflict, one transaction row, and one assigned reviver.

- [ ] **Step 5: Implement `acceptRequest` using transaction + row lock**

Use `SELECT ... FOR UPDATE`, verify request is available, insert transaction, set request state/assignment, set `payment_deadline = accepted_at + interval '3 minutes'`.

Stage 1 queue can be available only to test/admin-seeded revivers; Reviver Pro entitlement enforcement is finalized in Stage 5.

- [ ] **Step 6: Run focused tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/domain/transaction-state.js server/src/db/transactions.js server/src/routes/reviver-queue.js server/test/domain/transaction-state.test.js server/test/db/accept-race.test.js server/src/app.js
git commit -m "feat(marketplace): add atomic request acceptance primitives"
```

---

### Task 11: Add worker/job foundation without implementing Torn transaction verification yet

**Files:**
- Create: `server/src/db/jobs.js`
- Create: `server/src/worker/runner.js`
- Create: `server/src/worker.js`
- Create: `server/test/db/jobs.test.js`

**Interfaces:**
- `enqueueJob({ type, entityId, runAt, payload })`
- `claimDueJobs({ limit, workerId })`
- Job types initially registered: `payment.verify`, `revive.verify`, `refund.verify`, `subscription.scan`, `sheets.mirror`.

- [ ] **Step 1: Write concurrent job-claim integration test**

Insert 10 due jobs; run two claimers using `FOR UPDATE SKIP LOCKED`; assert every job is claimed at most once and total claimed is 10.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement jobs table migration `002_jobs.sql` and repository**

Columns include `id`, `type`, `entity_id`, `run_at`, `attempts`, `locked_at`, `locked_by`, `last_error`, `completed_at`, `payload jsonb`, timestamps.

- [ ] **Step 4: Implement worker loop**

Worker sleeps 1 second when no jobs exist and dispatches registered handlers. Unknown type is recorded as failed and not silently discarded. Graceful SIGTERM stops claiming and finishes current job.

- [ ] **Step 5: Run test**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/jobs.js server/src/db/migrations/002_jobs.sql server/src/worker server/src/worker.js server/test/db/jobs.test.js
git commit -m "feat(worker): add transactional verification job queue"
```

---

### Task 12: Add backup/restore scripts and end-to-end Stage 1 verification

**Files:**
- Create: `deploy/backup.sh`
- Create: `deploy/restore.sh`
- Create: `server/test/stage1-smoke.test.js`
- Modify: `deploy/README.md`
- Modify: `.github/workflows/test.yml`

**Interfaces:**
- Backup output: `/srv/voidsmith/reviverelay/backups/reviverelay-YYYYmmdd-HHMMSS.sql.gz`
- Restore accepts exactly one backup path and targets only `reviverelay-db`/`reviverelay`.

- [ ] **Step 1: Write static backup isolation test**

Assert scripts contain `reviverelay` and do not contain DungeonMasterOS/Nexis identifiers; restore refuses an empty path.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement scripts**

Use `docker compose exec -T reviverelay-db pg_dump ... | gzip` and matching `gunzip | psql`. Add `set -eu` and require execution from `/srv/voidsmith/reviverelay` or explicit compose path.

- [ ] **Step 4: Add API smoke test**

Smoke test boots Fastify against test PostgreSQL and verifies:

1. `/health` returns `{ ok: true }`;
2. a forbidden candidate is rejected;
3. a valid public candidate inserts;
4. one direct request can be created;
5. a second active request for same requester does not duplicate;
6. accept race remains single-winner.

- [ ] **Step 5: Run the complete Stage 1 suite**

Run:

```bash
npm test
npm --prefix server test
npm run build
node --check torn-revive-chat-collector.user.js
node --check src/core.js
node --check src/chat-dom.js
```

Expected: all PASS.

- [ ] **Step 6: Review deployment isolation manually**

Verify `deploy/docker-compose.yml` exposes no DB port and contains no external application DB network/credential references.

- [ ] **Step 7: Commit**

```bash
git add deploy server/test/stage1-smoke.test.js .github/workflows/test.yml
git commit -m "test(stage1): verify backend foundation and isolated backups"
```

## Stage 1 completion gate

Before merging Stage 1:

- migrations pass on PostgreSQL 16 from a clean DB;
- existing userscript tests remain green;
- forbidden-channel server tests are green;
- concurrent candidate fallback dedupe and Accept race tests are green;
- API key encryption/session tests are green;
- Docker compose confirms DB is internal-only;
- no ReviveRelay config contains DungeonMasterOS/Nexis DB references;
- PR receives code review and all P1/P2 correctness issues are resolved.
