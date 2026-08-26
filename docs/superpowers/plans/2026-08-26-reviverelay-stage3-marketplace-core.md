# ReviveRelay Stage 3 Marketplace Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the evidence-backed protected revive marketplace: separate transaction-verification credentials, payment verification, revive verification, retry/refund handling, authoritative timers, and requester/reviver transaction UI.

**Architecture:** Extend the existing isolated Fastify/PostgreSQL/worker stack. Browser actions only request server actions or expedited checks; they never supply authoritative evidence or target states. Persistent Torn evidence access is a separate AES-256-GCM encrypted `transaction_verification` credential. Worker handlers obtain narrowly scoped Torn evidence, normalize it, run pure matchers, and commit business transitions plus append-only history in PostgreSQL.

**Tech Stack:** Node.js 20, Fastify 5, PostgreSQL 16, `pg`, `zod`, Node test runner, Tampermonkey userscript, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-26-reviverelay-stage3-marketplace-verification-design.md`

## Global Constraints

- ReviveRelay PostgreSQL remains physically/logically isolated from every other Voidsmith product database.
- Identity-only Torn API keys are verified and discarded; `/v1/auth/bind` must create zero `api_credentials` rows.
- Only a separate `transaction_verification` credential may be persisted, encrypted with the application encryption key outside PostgreSQL.
- Protected paid transactions require enough verified evidence access on both requester and reviver before they begin.
- Browser claims are never proof of payment, revive, refund, deadline compliance, or target state.
- Payment window is exactly 3 minutes from `accepted_at`; revive SLA is exactly 5 minutes from `payment_verified_at`; refund window is exactly 10 minutes from `refund_required_at`.
- Credential/Torn outages create verification holds and retries, not automatic misconduct findings and not deadline rewrites.
- Public-chat privacy boundaries remain unchanged.
- `PAID_TIER_ENABLED=false` remains unchanged through this plan.
- Public DNS/Caddy exposure remains disabled during this plan.
- Completed and verified work is merged to `main`.

---

### Task 1: Add a Reusable Disposable-Database Test Harness and Evolve the Schema

**Files:**
- Create: `server/test-support/database.js`
- Create: `server/src/db/migrations/003_stage3_marketplace.sql`
- Create: `server/test/db/stage3-schema.test.js`
- Create: `server/test/db/transaction-history.test.js`

**Interfaces:**
- Produces: `withDisposableDatabase(prefix, fn)`, Stage 3 schema additions, historical reservation support, evidence child tables, verification holds, and active-job deduplication.

- [x] **Step 1: Write the disposable DB helper**

```js
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { createPool } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');

async function waitForSessions(adminPool, dbName) {
  for (let i = 0; i < 100; i += 1) {
    const result = await adminPool.query('SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = $1', [dbName]);
    if (result.rows[0].count === 0) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for PostgreSQL sessions to close for ${dbName}`);
}

async function withDisposableDatabase(prefix, fn) {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  if (!sourceUrl) throw new Error('TEST_DATABASE_URL is required');
  const dbName = `${prefix}_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
  const targetUrl = new URL(sourceUrl); targetUrl.pathname = `/${dbName}`;
  const adminPool = createPool(adminUrl.toString());
  const pool = createPool(targetUrl.toString());
  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    await migrate(pool, path.resolve(__dirname, '../src/db/migrations'));
    return await fn(pool);
  } finally {
    await pool.end();
    await waitForSessions(adminPool, dbName);
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminPool.end();
  }
}

module.exports = { withDisposableDatabase };
```

- [x] **Step 2: Write RED schema tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');

test('Stage 3 indexes enforce one open transaction, one active credential purpose and one active logical job', async () => {
  await withDisposableDatabase('reviverelay_stage3_schema', async pool => {
    const result = await pool.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('transactions_one_open_per_request','api_credentials_one_active_purpose_per_user','jobs_one_active_dedupe_key')`);
    assert.deepEqual(new Set(result.rows.map(row => row.indexname)), new Set(['transactions_one_open_per_request','api_credentials_one_active_purpose_per_user','jobs_one_active_dedupe_key']));
  });
});
```

- [x] **Step 3: Run RED schema test**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15432/reviverelay_test node --test server/test/db/stage3-schema.test.js`

Expected: FAIL because migration `003_stage3_marketplace.sql` does not exist.

- [x] **Step 4: Add `003_stage3_marketplace.sql`**

```sql
ALTER TABLE api_credentials ADD COLUMN purpose text;
UPDATE api_credentials
SET purpose = 'legacy_unclassified',
    revoked_at = COALESCE(revoked_at, now())
WHERE purpose IS NULL;
ALTER TABLE api_credentials ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE api_credentials ADD COLUMN capability jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api_credentials ADD COLUMN last_validated_at timestamptz;
ALTER TABLE api_credentials ADD COLUMN unusable_at timestamptz;
ALTER TABLE api_credentials ADD COLUMN unusable_reason text;
CREATE UNIQUE INDEX api_credentials_one_active_purpose_per_user ON api_credentials(user_id,purpose) WHERE revoked_at IS NULL;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_request_id_key;
ALTER TABLE transactions ADD COLUMN refund_reason text;
ALTER TABLE transactions ADD COLUMN verification_hold_reason text;
ALTER TABLE transactions ADD COLUMN verification_hold_started_at timestamptz;
ALTER TABLE transactions ADD COLUMN verification_hold_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX transactions_one_open_per_request ON transactions(request_id) WHERE closed_at IS NULL;

CREATE TABLE transaction_state_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  event_code text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_torn_evidence_id_key;
ALTER TABLE payments ALTER COLUMN torn_evidence_id DROP NOT NULL;

CREATE TABLE payment_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  torn_evidence_id text NOT NULL UNIQUE,
  evidence_timestamp timestamptz NOT NULL,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refund_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  torn_evidence_id text NOT NULL UNIQUE,
  evidence_timestamp timestamptz NOT NULL,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE jobs ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX jobs_one_active_dedupe_key ON jobs(dedupe_key) WHERE completed_at IS NULL AND dedupe_key IS NOT NULL;
```

- [x] **Step 5: Write history/evidence RED tests** proving two closed transactions may share one request, two open transactions may not, and duplicate Torn evidence IDs fail.

- [x] **Step 6: Run schema/history tests**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15432/reviverelay_test node --test server/test/db/stage3-schema.test.js server/test/db/transaction-history.test.js`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/test-support/database.js server/src/db/migrations/003_stage3_marketplace.sql server/test/db/stage3-schema.test.js server/test/db/transaction-history.test.js
git commit -m "feat: add Stage 3 marketplace schema"
```

### Task 2: Add Transaction-Verification Credential Storage and Capability Validation

**Files:**
- Create: `server/src/db/verification-credentials.js`
- Create: `server/src/security/verification-credential.js`
- Create: `server/src/torn/key-capabilities.js`
- Create: `server/src/torn/log-metadata.js`
- Modify: `server/src/torn/client.js`
- Create: `server/test/db/verification-credentials.test.js`
- Create: `server/test/security/verification-credential.test.js`
- Create: `server/test/torn/key-capabilities.test.js`
- Create: `server/test/torn/log-metadata.test.js`

**Interfaces:**
- Produces: `createVerificationCredentialRepository(pool,{ encryptionKeyHex })`, `validateTransactionCredential({ keyInfo, ownerTornId, logMetadata })`, `requiredCapabilitiesFor(role)`, and a Torn metadata adapter that resolves current log categories/types instead of hardcoding stale IDs.

- [x] **Step 1: Write RED capability tests**

```js
const { validateTransactionCredential } = require('../../src/torn/key-capabilities');

assert.throws(() => validateTransactionCredential({ ownerTornId:123, keyInfo:{ owner:{ id:456 } }, logMetadata:{} }), /owner/i);
const result = validateTransactionCredential({
  ownerTornId:123,
  keyInfo:{ owner:{ id:123 }, selections:['revives','profile','log'], allowedLogCategories:[1,2,3,4,5,6] },
  logMetadata:{
    categories:{ 1:'Money incoming',2:'Money outgoing',3:'Item incoming',4:'Item outgoing',5:'Revive',6:'Hospital' }
  }
});
assert.equal(result.requester, true);
assert.equal(result.reviver, true);
```

- [x] **Step 2: Run RED capability tests**

Run: `node --test server/test/torn/key-capabilities.test.js server/test/torn/log-metadata.test.js`

Expected: FAIL because modules are absent.

- [x] **Step 3: Implement capability mapping without guessed numeric IDs**

`log-metadata.js` fetches Torn's current log category/type metadata through the Torn client, normalizes category IDs to names, and exposes a cacheable immutable mapping. `key-capabilities.js` compares the key's allowed category IDs against the current resolved names. Canonical capability names are:

```js
const CAPABILITIES = Object.freeze([
  'incoming_revives','hospital_status','outgoing_revives',
  'money_incoming','item_incoming','money_outgoing','item_outgoing'
]);
```

Requester requires `incoming_revives` + `hospital_status`; reviver requires the other five.

- [x] **Step 4: Write RED encrypted repository tests** proving `bind()` stores no plaintext, replaces a prior active `transaction_verification` credential atomically, and `getDecryptedActiveForUser()` decrypts only in-process.

- [x] **Step 5: Implement repository using existing `encryptSecret`/`decryptSecret`** from `server/src/security/crypto.js`.

```js
createVerificationCredentialRepository(pool,{ encryptionKeyHex }) => ({
  getStatus(userId),
  bind({ userId, plaintextKey, capability, accessScope, validatedAt }),
  revoke({ userId, reason, now }),
  markUnusable({ userId, reason, now }),
  getDecryptedActiveForUser(userId)
})
```

Store `tag` returned by `encryptSecret` in `api_credentials.auth_tag`; reconstruct `{ ciphertext, iv, tag: auth_tag }` before `decryptSecret`.

- [x] **Step 6: Extend Torn client with explicit key-info/log-metadata/evidence methods** using supplied API key, bounded `from`/`to`, and URL/error redaction.

- [x] **Step 7: Run credential/security/Torn tests**

Run: `node --test server/test/db/verification-credentials.test.js server/test/security/verification-credential.test.js server/test/torn`

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add server/src/db/verification-credentials.js server/src/security/verification-credential.js server/src/torn/key-capabilities.js server/src/torn/log-metadata.js server/src/torn/client.js server/test/db/verification-credentials.test.js server/test/security/verification-credential.test.js server/test/torn
git commit -m "feat: add transaction verification credentials"
```

### Task 3: Expose Credential Binding and Gate Protected Transactions

**Files:**
- Create: `server/src/routes/verification-credential.js`
- Create: `server/src/routes/revivers.js`
- Modify: `server/src/routes/requests.js`
- Modify: `server/src/routes/reviver-queue.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Create: `server/test/routes/verification-credential.test.js`
- Create: `server/test/routes/revivers.test.js`
- Modify: `server/test/routes/requests.test.js`
- Modify: `server/test/routes/reviver-queue.test.js`

**Interfaces:**
- Produces: `GET|POST|DELETE /v1/verification-credential`, `POST /v1/reviver/register`, and server-side requester/reviver capability guards.

- [x] **Step 1: Write RED route tests**

```js
const response = await app.inject({ method:'POST', url:'/v1/verification-credential', headers:auth, payload:{ apiKey:'test-key' } });
assert.equal(response.statusCode, 200);
assert.equal(Object.hasOwn(response.json().credential, 'apiKey'), false);
```

Add tests that protected request creation and queue/accept return `409 VERIFICATION_CREDENTIAL_REQUIRED` when the corresponding capability is absent.

- [x] **Step 2: Run RED route tests**

Run: `node --test server/test/routes/verification-credential.test.js server/test/routes/revivers.test.js server/test/routes/requests.test.js server/test/routes/reviver-queue.test.js`

Expected: FAIL.

- [x] **Step 3: Implement credential routes**: verify key owner/scopes against current metadata, then call repository `bind()`. `GET` returns status/capabilities only; `DELETE` revokes without returning plaintext.

- [x] **Step 4: Implement idempotent reviver registration** requiring valid reviver capability and creating/updating `revivers` with `standing='active'`; do not grant paid entitlement yet.

- [x] **Step 5: Add requester/reviver guards** to protected routes. Accept additionally checks active standing and no active ban.

- [x] **Step 6: Wire dependencies explicitly in `app.js`/`server.js`**.

- [x] **Step 7: Run route tests and commit**

```bash
git add server/src/routes/verification-credential.js server/src/routes/revivers.js server/src/routes/requests.js server/src/routes/reviver-queue.js server/src/app.js server/src/server.js server/test/routes
git commit -m "feat: gate protected revive transactions by evidence access"
```

### Task 4: Add Authoritative State Transitions, History, and Unique Logical Jobs

**Files:**
- Modify: `server/src/domain/transaction-state.js`
- Create: `server/src/domain/transaction-service.js`
- Modify: `server/src/db/transactions.js`
- Modify: `server/src/db/jobs.js`
- Modify: `server/test/domain/transaction-state.test.js`
- Create: `server/test/domain/transaction-service.test.js`
- Modify: `server/test/db/jobs.test.js`
- Create: `server/test/db/transactions-stage3.test.js`

**Interfaces:**
- Produces: `transitionTransaction({ transactionId, event, actor, details, now })`, `setVerificationHold(input)`, `clearVerificationHold(input)`, `enqueueUniqueJob({ type, entityId, dedupeKey, runAt, payload })`.

- [x] **Step 1: Write RED transition assertions**

```js
assert.equal(canTransition('PAYMENT_RECONCILING','payment_expired'),'PAYMENT_EXPIRED');
assert.equal(canTransition('WAITING_FOR_REVIVE','no_attempt'),'REPORTABLE_NO_ATTEMPT');
assert.equal(canTransition('REFUND_RECONCILING','missing_refund'),'REPORTABLE_MISSING_REFUND');
assert.equal(canTransition('WAITING_FOR_REVIVE','third_party_revive'),'REFUND_REQUIRED');
```

- [x] **Step 2: Implement normalized states/events** including `REFUND_RECONCILING`, `PAYMENT_EXPIRED`, `CLOSED_REQUESTER_EXIT`, `CLOSED_NATURAL_EXPIRY`, `REPORTABLE_NO_ATTEMPT`, `REPORTABLE_MISSING_REFUND`. Late payment maps to `REFUND_REQUIRED` with reason `late_payment`; do not keep `REFUND_REQUIRED_LATE_PAYMENT` as a permanent competing state.

- [x] **Step 3: Write RED DB/service tests** proving every transition updates the transaction, mirrors request state/closure where applicable, adds exactly one `transaction_state_history` row, and writes audit detail without secrets.

- [x] **Step 4: Implement `enqueueUniqueJob`** using the `dedupe_key` partial unique index; a second expedited check updates the existing active logical job rather than creating another.

- [x] **Step 5: Implement verification holds** as columns layered over the business state; setting/clearing a hold must not modify `payment_deadline`, `revive_deadline`, or `refund_deadline`.

- [x] **Step 6: Run domain/DB tests and commit**

```bash
git add server/src/domain/transaction-state.js server/src/domain/transaction-service.js server/src/db/transactions.js server/src/db/jobs.js server/test/domain server/test/db
git commit -m "feat: add authoritative Stage 3 transaction transitions"
```

### Task 5: Verify Cash/Xanax Payments

**Files:**
- Create: `server/src/domain/payment-matcher.js`
- Create: `server/src/torn/evidence.js`
- Create: `server/src/db/payments.js`
- Create: `server/src/worker/payment-verify.js`
- Modify: `server/src/worker.js`
- Create: `server/test/domain/payment-matcher.test.js`
- Create: `server/test/db/payments.test.js`
- Create: `server/test/worker/payment-verify.test.js`

**Interfaces:**
- Produces: `matchPaymentEvidence(input)` and `createPaymentVerifyHandler(deps)`.

- [x] **Step 1: Write RED pure matcher tests** for Cash and Xanax, wrong sender, wrong method/item, pre-accept transfer, split transfers, overpayment, late transfer, duplicate evidence ID, and no payment.

```js
const result = matchPaymentEvidence({ method:'xanax', offerAmount:3, requesterTornId:111, acceptedAt:new Date('2026-08-26T10:00:00Z'), paymentDeadline:new Date('2026-08-26T10:03:00Z'), logs:[
  { id:'a', senderId:111, kind:'xanax', amount:1, at:'2026-08-26T10:01:00Z' },
  { id:'b', senderId:111, kind:'xanax', amount:2, at:'2026-08-26T10:02:00Z' }
]});
assert.equal(result.status,'verified');
assert.equal(result.verifiedAmount,3);
```

- [x] **Step 2: Implement pure matcher** returning only `{status:'verified'|'late'|'not_found', verifiedAmount, evidence}` and comparing Torn evidence timestamps, not fetch time.

- [x] **Step 3: Implement payment repository** recording one aggregate payment plus unique `payment_evidence` rows idempotently in one transaction.

- [x] **Step 4: Write RED worker tests**: verified on-time -> `WAITING_FOR_REVIVE` and `revive_deadline = payment_verified_at + 5m`; before deadline with no payment -> reschedule; after reconciliation -> `PAYMENT_EXPIRED`; late evidence -> refund required; Torn timeout/invalid credential -> retry/verification hold, never misconduct.

- [x] **Step 5: Implement Torn evidence normalization** for narrowly scoped incoming money/item logs and assigned reviver credential use. Domain matcher must never know raw Torn response shapes.

- [x] **Step 6: Implement/register `payment.verify` and run tests**

- [x] **Step 7: Commit**

```bash
git add server/src/domain/payment-matcher.js server/src/torn/evidence.js server/src/db/payments.js server/src/worker/payment-verify.js server/src/worker.js server/test/domain/payment-matcher.test.js server/test/db/payments.test.js server/test/worker/payment-verify.test.js
git commit -m "feat: verify revive payments from Torn evidence"
```

### Task 6: Verify Revive Attempts and Hospital Exit Outcomes

**Files:**
- Create: `server/src/domain/revive-matcher.js`
- Create: `server/src/db/revive-attempts.js`
- Create: `server/src/worker/revive-verify.js`
- Modify: `server/src/torn/evidence.js`
- Modify: `server/src/worker.js`
- Create: `server/test/domain/revive-matcher.test.js`
- Create: `server/test/db/revive-attempts.test.js`
- Create: `server/test/worker/revive-verify.test.js`

**Interfaces:**
- Produces: `classifyReviveOutcome(input)`, immutable attempt recording, and `createReviveVerifyHandler(deps)`.

- [x] **Step 1: Write RED matcher tests** for assigned success, assigned genuine failure, third-party success, requester self-exit, natural expiry, no-attempt deadline, and ambiguous evidence.

- [x] **Step 2: Implement pure precedence**: assigned success -> assigned failure -> third-party success -> proven self-exit -> proven natural expiry -> no-attempt after final reconciliation -> ambiguous/retry.

- [x] **Step 3: Implement immutable attempt repository** with unique Torn evidence IDs and monotonically increasing per-transaction sequence numbers.

- [x] **Step 4: Extend Torn adapter** for `user/revives` incoming/outgoing plus narrow hospital/status evidence; keep raw response parsing out of domain code.

- [x] **Step 5: Implement worker behavior**: success closes `COMPLETED`; genuine failure -> `FAILED_ATTEMPT_CHOICE`; third-party -> refund reason `third_party_revive`; self/natural exit closes no-refund; no attempt becomes reportable only after final reconciliation; outages/ambiguity never create misconduct.

- [x] **Step 6: Run tests and commit**

```bash
git add server/src/domain/revive-matcher.js server/src/db/revive-attempts.js server/src/worker/revive-verify.js server/src/torn/evidence.js server/src/worker.js server/test/domain/revive-matcher.test.js server/test/db/revive-attempts.test.js server/test/worker/revive-verify.test.js
git commit -m "feat: verify revive outcomes from Torn evidence"
```

### Task 7: Add Retry, Refund, and Transaction Action APIs

**Files:**
- Create: `server/src/domain/refund-matcher.js`
- Create: `server/src/db/refunds.js`
- Create: `server/src/worker/refund-verify.js`
- Create: `server/src/routes/transactions.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Modify: `server/src/worker.js`
- Modify: `server/src/db/transactions.js`
- Modify: `server/src/domain/transaction-service.js`
- Modify: `server/src/db/revive-attempts.js`
- Modify: `server/src/worker/revive-verify.js`
- Modify: `server/src/torn/evidence.js`
- Create: `server/test/domain/refund-matcher.test.js`
- Create: `server/test/db/refunds.test.js`
- Create: `server/test/worker/refund-verify.test.js`
- Create: `server/test/routes/transactions.test.js`
- Create: `server/test/db/refund-transition.test.js`
- Modify: `server/test/db/transactions-stage3.test.js`
- Modify: `server/test/torn/evidence.test.js`
- Modify: `server/test/worker/revive-verify.test.js`
- Modify: `server/test/worker/handlers.test.js`

**Interfaces:**
- Produces: transaction read/check/retry/refund routes from the spec and `createRefundVerifyHandler(deps)`.

- [x] **Step 1: Write RED refund tests** for exact/split Cash and Xanax, under-refund, wrong party, on-time evidence surfaced late, and overpayment requiring refund of actual verified value.

- [x] **Step 2: Implement refund matcher/repository** using `payments.verified_amount`, same method, unique `refund_evidence`, and idempotent aggregate updates.

- [x] **Step 3: Write RED route tests** for:

```text
GET  /v1/transactions/:id
POST /v1/transactions/:id/check-payment
POST /v1/transactions/:id/retry-request
POST /v1/transactions/:id/retry-response
POST /v1/transactions/:id/request-refund
POST /v1/transactions/:id/check-refund
```

Assert ownership/assignment and valid-state authorization. A payload containing `{ "state":"COMPLETED" }` must never create a state transition.

- [x] **Step 4: Implement routes** by translating allowed actions into transaction-service events and deduplicated expedited-check jobs only.

- [x] **Step 5: Write/implement refund worker**: verified -> `REFUNDED`; before deadline -> reschedule; after final reconciliation -> `REPORTABLE_MISSING_REFUND`; outage/invalid key -> hold/retry.

**Task 7 implementation notes:**
- The retry-response window is **2 minutes**, stored server-side as `retry_response_deadline`. The existing `revive.verify` worker owns timeout handling through a distinct `revive.retry:<transactionId>` dedupe key so it cannot collide with the original revive-verification job.
- Entering `REFUND_REQUIRED` atomically creates the refund obligation from `payments.verified_amount` and enqueues one deduplicated `refund.verify` job in the same database transaction. A conflicting pre-existing refund contract fails closed.
- Participant transaction views expose Torn identities and public transaction terms/state, but not internal requester/reviver UUIDs.

- [x] **Step 6: Run tests and commit**

```bash
git add server/src/domain/refund-matcher.js server/src/db/refunds.js server/src/worker/refund-verify.js server/src/routes/transactions.js server/src/app.js server/src/server.js server/src/worker.js server/test/domain/refund-matcher.test.js server/test/db/refunds.test.js server/test/worker/refund-verify.test.js server/test/routes/transactions.test.js
git commit -m "feat: add retry and refund verification workflow"
```

### Task 8: Add Protected Transaction Controls to the Userscript

**Files:**
- Modify: `src/api-client.js`
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Modify: `test/api-client.test.js`
- Create: `test/verification-credential-ui.test.js`
- Create: `test/reviver-marketplace-ui.test.js`
- Modify: `test/requester-ui.test.js`

**Interfaces:**
- Produces credential settings, requester/reviver marketplace controls, and authoritative countdown rendering.

- [x] **Step 1: Add RED API-client tests** for credential status/bind/revoke, reviver register/queue/accept, transaction status, payment/refund check, retry/refund actions.

- [x] **Step 2: Implement API-client methods** exactly matching Stage 3 routes while preserving opaque session auth.

- [x] **Step 3: Add RED UI tests** proving plaintext verification key is cleared immediately and never stored with `GM_setValue`; protected Request/Accept are disabled without validated capability; countdowns derive from server timestamps; no client control can submit arbitrary transaction state.

- [x] **Step 4: Implement Verification Settings UI** with capability/last-validation status and Bind/Rebind/Revoke. Plaintext keys are never redisplayed.

- [x] **Step 5: Implement requester UI** for assigned reviver/terms, payment deadline/check, revive deadline, failed-attempt retry/refund choice, refund deadline/check, and terminal result.

- [x] **Step 6: Implement reviver UI** for registration, queue, Accept, assigned requester/terms, payment/revive status, retry response, and refund obligation.

- [x] **Step 7: Run client tests/build**

Run: `npm run test:client && npm run build && node --check dist/torn-revive-chat-collector.user.js`

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/api-client.js torn-revive-chat-collector.user.js scripts/build.js test
git commit -m "feat: add protected transaction userscript workflow"
```

### Task 9: Verify, Deploy Internally, Merge to `main`

**Files:**
- Modify: `README.md`
- Runtime: `/srv/voidsmith/torn-platform/reviverelay/app`

**Interfaces:**
- Produces fully tested Stage 3 marketplace core internally; telemetry/updater remain separate plans.

- [x] **Step 1: Update README** with credential/evidence model, 3/5/10-minute timers, retry/refund behavior, and remaining Stage 4/5 limitations.

- [x] **Step 2: Run full client tests and build**

Run: `npm run test:client && npm run build && node --check dist/torn-revive-chat-collector.user.js`

Expected: PASS.

- [x] **Step 3: Run full server suite against disposable PostgreSQL 16**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15432/reviverelay_test npm run test:server`

Expected: PASS.

- [x] **Step 4: Run deployment isolation tests**

Run: `node --test server/test/deployment-isolation.test.js server/test/deploy`

Expected: PASS.

- [x] **Step 5: Stage the exact verified tree** to `/srv/voidsmith/torn-platform/reviverelay/app`, run migrations under Compose project `reviverelay`, restart only ReviveRelay API/worker, and verify `GET http://127.0.0.1:18730/health` returns `{ "ok": true }`.

- [x] **Step 6: Re-run runtime isolation** proving PostgreSQL has no host-published port/outbound network, only ReviveRelay containers join `reviverelay_db_internal`, and API remains localhost-only.

- [x] **Step 7: Perform fresh database backup + disposable restore verification** against the migrated schema.

- [x] **Step 8: Confirm launch gates stay closed**: `PAID_TIER_ENABLED=false`, no public ReviveRelay DNS/Caddy route, no Stage 5 subscription gating.

- [ ] **Step 9: Commit final docs, merge the completed feature branch to local `main`, rerun full tests on merged `main`, synchronize GitHub `main`, verify tree equality, then remove the completed worktree/branch.**

- [ ] **Step 10: Update the Voidsmith Source of Truth** with verified Stage 3 core facts only; never store secret values.
