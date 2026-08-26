# ReviveRelay Stage 3 Marketplace Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the evidence-backed protected revive marketplace: separate transaction-verification credentials, payment verification, revive verification, retry/refund handling, authoritative timers, and requester/reviver transaction UI.

**Architecture:** Extend the existing isolated Fastify/PostgreSQL/worker stack. The browser may request actions and expedited checks but never supplies authoritative evidence or state transitions. Persistent Torn evidence access is a separate AES-256-GCM encrypted `transaction_verification` credential; worker handlers obtain narrowly scoped Torn evidence, match it idempotently, and commit business transitions plus append-only history in PostgreSQL.

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

### Task 1: Evolve the Stage 1 Schema for Historical Reservations and Evidence

**Files:**
- Create: `server/src/db/migrations/003_stage3_marketplace.sql`
- Test: `server/test/db/stage3-schema.test.js`
- Test: `server/test/db/transaction-history.test.js`

**Interfaces:**
- Consumes: existing `users`, `api_credentials`, `revive_requests`, `transactions`, `payments`, `revive_attempts`, `refunds`, `jobs`, `audit_events`.
- Produces: `api_credentials.purpose`, capability metadata, `transaction_state_history`, `payment_evidence`, `refund_evidence`, verification-hold fields, normalized refund reason, repeat reservation support, and active-job deduplication.

- [ ] **Step 1: Write a PostgreSQL RED schema test**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { withTestDatabase } = require('../support/database');

test('stage3 schema permits historical transactions but only one open assignment per request', async () => {
  await withTestDatabase(async pool => {
    const constraints = await pool.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename IN ('transactions','api_credentials','jobs')
    `);
    const text = constraints.rows.map(row => `${row.indexname} ${row.indexdef}`).join('\n');
    assert.match(text, /transactions_one_open_per_request/);
    assert.match(text, /api_credentials_one_active_purpose_per_user/);
    assert.match(text, /jobs_one_active_dedupe_key/);
  });
});
```

- [ ] **Step 2: Run the RED schema test**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15432/reviverelay_test node --test server/test/db/stage3-schema.test.js`

Expected: FAIL because migration `003_stage3_marketplace.sql` and the three Stage 3 indexes do not exist.

- [ ] **Step 3: Add migration `003_stage3_marketplace.sql`**

The migration must:

```sql
ALTER TABLE api_credentials ADD COLUMN purpose text;
UPDATE api_credentials SET purpose = 'transaction_verification' WHERE purpose IS NULL;
ALTER TABLE api_credentials ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE api_credentials ADD COLUMN capability jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api_credentials ADD COLUMN last_validated_at timestamptz;
ALTER TABLE api_credentials ADD COLUMN unusable_at timestamptz;
ALTER TABLE api_credentials ADD COLUMN unusable_reason text;

CREATE UNIQUE INDEX api_credentials_one_active_purpose_per_user
  ON api_credentials(user_id, purpose)
  WHERE revoked_at IS NULL;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_request_id_key;
ALTER TABLE transactions ADD COLUMN refund_reason text;
ALTER TABLE transactions ADD COLUMN verification_hold_reason text;
ALTER TABLE transactions ADD COLUMN verification_hold_started_at timestamptz;
ALTER TABLE transactions ADD COLUMN verification_hold_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX transactions_one_open_per_request
  ON transactions(request_id)
  WHERE closed_at IS NULL;

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
CREATE UNIQUE INDEX jobs_one_active_dedupe_key
  ON jobs(dedupe_key)
  WHERE completed_at IS NULL AND dedupe_key IS NOT NULL;
```

- [ ] **Step 4: Write RED history/evidence tests** proving two closed transaction rows can share one request, a second open row cannot, and duplicate Torn evidence IDs are rejected.

```js
assert.equal(closedInsert.rowCount, 1);
await assert.rejects(
  pool.query('INSERT INTO payment_evidence (payment_id,torn_evidence_id,evidence_timestamp,amount) VALUES ($1,$2,now(),1)', [paymentId, 'same-log'])
);
```

- [ ] **Step 5: Run schema/history tests until green**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15432/reviverelay_test node --test server/test/db/stage3-schema.test.js server/test/db/transaction-history.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/migrations/003_stage3_marketplace.sql server/test/db/stage3-schema.test.js server/test/db/transaction-history.test.js
git commit -m "feat: add Stage 3 marketplace schema"
```

### Task 2: Add Transaction-Verification Credential Repository and Scope Validation

**Files:**
- Create: `server/src/db/verification-credentials.js`
- Create: `server/src/security/verification-credential.js`
- Create: `server/src/torn/key-capabilities.js`
- Modify: `server/src/torn/client.js`
- Test: `server/test/db/verification-credentials.test.js`
- Test: `server/test/security/verification-credential.test.js`
- Test: `server/test/torn/key-capabilities.test.js`

**Interfaces:**
- Produces: `createVerificationCredentialRepository(pool, cryptoBox)`, `validateTransactionCredential({ keyInfo, ownerTornId })`, `requiredCapabilitiesFor(role)`, and Torn-client methods `getKeyInfo(apiKey)` plus narrow evidence methods used by later tasks.

- [ ] **Step 1: Write RED capability tests**

```js
const { validateTransactionCredential } = require('../../src/torn/key-capabilities');

test('rejects a key owned by a different Torn player', () => {
  assert.throws(() => validateTransactionCredential({
    ownerTornId: 123,
    keyInfo: { owner: { id: 456 }, access: { user: ['revives'] }, logCategories: [] }
  }), /owner/i);
});

test('derives requester and reviver capabilities from validated access', () => {
  const result = validateTransactionCredential({
    ownerTornId: 123,
    keyInfo: {
      owner: { id: 123 },
      access: { user: ['revives','profile','log'] },
      logCategories: ['money_incoming','money_outgoing','item_incoming','item_outgoing','revive','hospital']
    }
  });
  assert.equal(result.requester, true);
  assert.equal(result.reviver, true);
});
```

- [ ] **Step 2: Run RED capability tests**

Run: `node --test server/test/torn/key-capabilities.test.js`

Expected: FAIL because `key-capabilities.js` does not exist.

- [ ] **Step 3: Implement pure capability validation**

Export:

```js
function requiredCapabilitiesFor(role) {
  if (role === 'requester') return ['incoming_revives', 'hospital_status'];
  if (role === 'reviver') return ['outgoing_revives', 'money_incoming', 'item_incoming', 'money_outgoing', 'item_outgoing'];
  throw new Error('Unknown verification role');
}

function validateTransactionCredential({ keyInfo, ownerTornId }) {
  const owner = Number(keyInfo?.owner?.id);
  if (owner !== Number(ownerTornId)) throw new Error('Credential owner mismatch');
  const capabilities = deriveCapabilitiesFromKeyInfo(keyInfo);
  return Object.freeze({
    requester: requiredCapabilitiesFor('requester').every(name => capabilities.has(name)),
    reviver: requiredCapabilitiesFor('reviver').every(name => capabilities.has(name)),
    validated: Array.from(capabilities).sort()
  });
}
```

The derivation must use only current Torn selections/category metadata and must reject unrelated unrestricted access rather than silently blessing it.

- [ ] **Step 4: Write RED encrypted-repository tests**

Assert that `upsertForUser()` stores ciphertext/IV/auth tag, never plaintext, revokes the prior active credential atomically, and `getDecryptedActiveForUser()` returns plaintext only inside the backend process.

- [ ] **Step 5: Implement `verification-credentials.js` and `verification-credential.js`**

Repository public API:

```js
createVerificationCredentialRepository(pool, cryptoBox) => ({
  getStatus(userId),
  bind({ userId, plaintextKey, capability, accessScope, validatedAt }),
  revoke({ userId, reason, now }),
  markUnusable({ userId, reason, now }),
  getDecryptedActiveForUser(userId)
})
```

`cryptoBox` must use the existing application AES-256-GCM encryption utility/key source; plaintext must never be logged or returned by status methods.

- [ ] **Step 6: Extend Torn client tests and methods**

Add narrow v2 methods with explicit `from`/`to` parameters and supplied API key. Keep URL construction centralized and redact `key` from thrown/logged errors.

- [ ] **Step 7: Run credential/security/Torn tests**

Run: `node --test server/test/db/verification-credentials.test.js server/test/security/verification-credential.test.js server/test/torn/key-capabilities.test.js server/test/torn`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/db/verification-credentials.js server/src/security/verification-credential.js server/src/torn/key-capabilities.js server/src/torn/client.js server/test/db/verification-credentials.test.js server/test/security/verification-credential.test.js server/test/torn
git commit -m "feat: add transaction verification credentials"
```

### Task 3: Expose Credential Binding and Enforce Protected-Transaction Eligibility

**Files:**
- Create: `server/src/routes/verification-credential.js`
- Create: `server/src/routes/revivers.js`
- Modify: `server/src/routes/requests.js`
- Modify: `server/src/routes/reviver-queue.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Test: `server/test/routes/verification-credential.test.js`
- Test: `server/test/routes/revivers.test.js`
- Modify: `server/test/routes/requests.test.js`
- Modify: `server/test/routes/reviver-queue.test.js`

**Interfaces:**
- Consumes: verification credential repository/capability validator from Task 2.
- Produces: `GET|POST|DELETE /v1/verification-credential`, `POST /v1/reviver/register`, and server-side requester/reviver capability gates.

- [ ] **Step 1: Write RED route tests**

```js
const response = await app.inject({ method: 'POST', url: '/v1/verification-credential', headers: auth, payload: { apiKey: 'test-key' } });
assert.equal(response.statusCode, 200);
const body = response.json();
assert.deepEqual(body.credential.capabilities, { requester: true, reviver: false });
assert.equal(Object.hasOwn(body.credential, 'apiKey'), false);
```

Add tests that request creation returns `409 VERIFICATION_CREDENTIAL_REQUIRED` without requester capability and queue/accept returns `409 VERIFICATION_CREDENTIAL_REQUIRED` without reviver capability.

- [ ] **Step 2: Run RED route tests**

Run: `node --test server/test/routes/verification-credential.test.js server/test/routes/revivers.test.js server/test/routes/requests.test.js server/test/routes/reviver-queue.test.js`

Expected: FAIL on missing routes/gates.

- [ ] **Step 3: Implement credential routes**

`POST /v1/verification-credential` flow:

```js
const keyInfo = await tornClient.getKeyInfo(request.body.apiKey);
const capability = validateTransactionCredential({ keyInfo, ownerTornId: request.reviveRelayUser.tornId });
const credential = await verificationCredentialRepository.bind({
  userId: request.reviveRelayUser.id,
  plaintextKey: request.body.apiKey,
  capability,
  accessScope: keyInfo.access,
  validatedAt: new Date()
});
return reply.send({ credential });
```

Use `finally`/scope discipline so route code retains no plaintext beyond the request.

- [ ] **Step 4: Implement `POST /v1/reviver/register`**

Require valid reviver capability, then idempotently insert/update the authenticated user's `revivers` row with `standing='active'`. Do not grant Reviver Pro yet.

- [ ] **Step 5: Add eligibility guards**

`POST /v1/requests` requires requester capability. `GET /v1/reviver/queue` and Accept require reviver capability, active standing, and no active ban. Return stable error codes from the spec.

- [ ] **Step 6: Register repositories/routes in `app.js` and `server.js`**

Pass dependencies explicitly; do not use hidden globals.

- [ ] **Step 7: Run route tests**

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/verification-credential.js server/src/routes/revivers.js server/src/routes/requests.js server/src/routes/reviver-queue.js server/src/app.js server/src/server.js server/test/routes
git commit -m "feat: gate protected revive transactions by evidence access"
```

### Task 4: Add Transaction Transition Service, History, and Deduplicated Jobs

**Files:**
- Modify: `server/src/domain/transaction-state.js`
- Create: `server/src/domain/transaction-service.js`
- Modify: `server/src/db/transactions.js`
- Modify: `server/src/db/jobs.js`
- Test: `server/test/domain/transaction-state.test.js`
- Create: `server/test/domain/transaction-service.test.js`
- Modify: `server/test/db/jobs.test.js`
- Modify: `server/test/db/transactions.test.js`

**Interfaces:**
- Produces: `transitionTransaction({ transactionId, event, actor, details, now })`, `setVerificationHold(...)`, `clearVerificationHold(...)`, and `enqueueUniqueJob({ type, entityId, dedupeKey, runAt, payload })`.

- [ ] **Step 1: Write RED transition tests** for all Stage 3 states and events, including `payment_expired`, `payment_verified`, `late_payment`, `revive_success`, `revive_failed`, `retry_requested`, `retry_accepted`, `retry_declined`, `refund_requested`, `refund_verified`, `no_attempt`, `missing_refund`, `requester_exit`, and `natural_expiry`.

```js
assert.equal(canTransition('PAYMENT_RECONCILING', 'payment_expired'), 'PAYMENT_EXPIRED');
assert.equal(canTransition('WAITING_FOR_REVIVE', 'no_attempt'), 'REPORTABLE_NO_ATTEMPT');
assert.equal(canTransition('REFUND_RECONCILING', 'missing_refund'), 'REPORTABLE_MISSING_REFUND');
```

- [ ] **Step 2: Run RED domain tests**

Expected: FAIL on missing states/transitions.

- [ ] **Step 3: Implement normalized state table**

Remove permanent use of `REFUND_REQUIRED_LATE_PAYMENT`; late payment maps to `REFUND_REQUIRED` plus `refund_reason='late_payment'`.

- [ ] **Step 4: Write RED repository/service tests** proving each transition updates `transactions.state`, mirrors the request state where applicable, inserts exactly one `transaction_state_history` row, and enqueues at most one active logical job per dedupe key.

- [ ] **Step 5: Implement transaction service** using one SQL transaction for state, deadlines/evidence pointer changes, history, audit, and job enqueue.

- [ ] **Step 6: Implement `enqueueUniqueJob`**

```js
INSERT INTO jobs (type, entity_id, run_at, payload, dedupe_key)
VALUES ($1,$2,$3,$4::jsonb,$5)
ON CONFLICT (dedupe_key) WHERE completed_at IS NULL AND dedupe_key IS NOT NULL
DO UPDATE SET run_at = LEAST(jobs.run_at, EXCLUDED.run_at), updated_at = now()
RETURNING *;
```

- [ ] **Step 7: Run domain/DB tests**

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/domain/transaction-state.js server/src/domain/transaction-service.js server/src/db/transactions.js server/src/db/jobs.js server/test/domain server/test/db
git commit -m "feat: add authoritative Stage 3 transaction transitions"
```

### Task 5: Implement Payment Evidence Matching and `payment.verify`

**Files:**
- Create: `server/src/domain/payment-matcher.js`
- Create: `server/src/torn/evidence.js`
- Create: `server/src/db/payments.js`
- Create: `server/src/worker/payment-verify.js`
- Modify: `server/src/worker.js`
- Test: `server/test/domain/payment-matcher.test.js`
- Create: `server/test/worker/payment-verify.test.js`
- Create: `server/test/db/payments.test.js`

**Interfaces:**
- Produces: `matchPaymentEvidence({ method, offerAmount, requesterTornId, acceptedAt, paymentDeadline, logs })` and `createPaymentVerifyHandler(deps)`.

- [ ] **Step 1: Write RED pure matcher tests**

```js
test('aggregates split on-time Xanax transfers from the requester', () => {
  const result = matchPaymentEvidence({
    method: 'xanax',
    offerAmount: 3,
    requesterTornId: 111,
    acceptedAt: new Date('2026-08-26T10:00:00Z'),
    paymentDeadline: new Date('2026-08-26T10:03:00Z'),
    logs: [
      { id: 'a', senderId: 111, item: 'Xanax', quantity: 1, at: '2026-08-26T10:01:00Z' },
      { id: 'b', senderId: 111, item: 'Xanax', quantity: 2, at: '2026-08-26T10:02:00Z' }
    ]
  });
  assert.equal(result.status, 'verified');
  assert.equal(result.verifiedAmount, 3);
});
```

Also test wrong sender, wrong item/method, pre-accept transfer, late payment, overpayment, duplicate log ID, and no payment.

- [ ] **Step 2: Run RED matcher tests**

Expected: FAIL because matcher is absent.

- [ ] **Step 3: Implement matcher as a pure function** returning one of:

```js
{ status: 'verified', verifiedAmount, evidence }
{ status: 'late', verifiedAmount, evidence }
{ status: 'not_found', evidence: [] }
```

Evidence comparison uses Torn evidence timestamps, not fetch time.

- [ ] **Step 4: Implement `payments.js`** with idempotent `recordVerifiedPayment()` that stores one aggregate payment and child evidence rows in one transaction.

- [ ] **Step 5: Write RED worker tests** with fake Torn evidence/credential repositories. Verify: immediate on-time payment -> `WAITING_FOR_REVIVE` with `reviveDeadline = paymentVerifiedAt + 5m`; no payment before deadline -> reschedule; no payment after reconciliation -> `PAYMENT_EXPIRED`; late payment -> `REFUND_REQUIRED` with `late_payment`; Torn timeout -> retry without misconduct.

- [ ] **Step 6: Implement `server/src/torn/evidence.js`** to decrypt the assigned reviver credential through the credential repository, request only the relevant narrow log window/category, normalize Torn response fields into matcher-friendly records, and discard plaintext references after the call.

- [ ] **Step 7: Implement `createPaymentVerifyHandler(deps)`**

Handler must use transaction service for all business transitions and return/reschedule through the job runner contract rather than directly mutating job rows.

- [ ] **Step 8: Register handler in `worker.js` and run tests**

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/domain/payment-matcher.js server/src/torn/evidence.js server/src/db/payments.js server/src/worker/payment-verify.js server/src/worker.js server/test/domain/payment-matcher.test.js server/test/worker/payment-verify.test.js server/test/db/payments.test.js
git commit -m "feat: verify revive payments from Torn evidence"
```

### Task 6: Implement Revive Attempt and Exit-Outcome Verification

**Files:**
- Create: `server/src/domain/revive-matcher.js`
- Create: `server/src/db/revive-attempts.js`
- Create: `server/src/worker/revive-verify.js`
- Modify: `server/src/torn/evidence.js`
- Modify: `server/src/worker.js`
- Test: `server/test/domain/revive-matcher.test.js`
- Create: `server/test/worker/revive-verify.test.js`
- Create: `server/test/db/revive-attempts.test.js`

**Interfaces:**
- Produces: `classifyReviveOutcome(input)` and `createReviveVerifyHandler(deps)`.

- [ ] **Step 1: Write RED matcher tests** for assigned success, assigned genuine failure, third-party success, requester self-exit, natural expiry, no attempt before deadline, no attempt after final reconciliation, and ambiguous evidence.

```js
assert.deepEqual(classifyReviveOutcome({
  requesterTornId: 100,
  assignedReviverTornId: 200,
  reviveDeadline,
  revives: [{ id: 'r1', reviverId: 200, targetId: 100, success: false, at: withinWindow }],
  hospital: { exitedAt: null, naturalExpiryAt: later }
}), { kind: 'assigned_failed', evidenceId: 'r1' });
```

- [ ] **Step 2: Run RED matcher tests**

Expected: FAIL.

- [ ] **Step 3: Implement pure `classifyReviveOutcome`** with evidence precedence: assigned success; assigned failed attempt; third-party success; proven self-exit; proven natural expiry; deadline/no-attempt; ambiguous/retry.

- [ ] **Step 4: Implement `revive-attempts.js`** to insert immutable unique Torn attempts and monotonically increasing transaction sequence numbers.

- [ ] **Step 5: Write RED worker tests** proving assigned success closes `COMPLETED`; assigned failure -> `FAILED_ATTEMPT_CHOICE`; third-party success -> `REFUND_REQUIRED` reason `third_party_revive`; self/natural exit close without refund; no attempt becomes `REPORTABLE_NO_ATTEMPT` only after final reconciliation; Torn failures never do.

- [ ] **Step 6: Extend Torn evidence adapter** for `user/revives` incoming/outgoing and narrow hospital/status evidence. Keep exact API response normalization in this adapter, not in domain matchers.

- [ ] **Step 7: Implement/register `revive.verify` handler and run tests**

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/domain/revive-matcher.js server/src/db/revive-attempts.js server/src/worker/revive-verify.js server/src/torn/evidence.js server/src/worker.js server/test/domain/revive-matcher.test.js server/test/worker/revive-verify.test.js server/test/db/revive-attempts.test.js
git commit -m "feat: verify revive outcomes from Torn evidence"
```

### Task 7: Implement Retry/Refund Actions and `refund.verify`

**Files:**
- Create: `server/src/domain/refund-matcher.js`
- Create: `server/src/db/refunds.js`
- Create: `server/src/worker/refund-verify.js`
- Create: `server/src/routes/transactions.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Modify: `server/src/worker.js`
- Test: `server/test/domain/refund-matcher.test.js`
- Create: `server/test/worker/refund-verify.test.js`
- Create: `server/test/routes/transactions.test.js`

**Interfaces:**
- Produces transaction-status/check/retry/refund endpoints from the Stage 3 spec and `createRefundVerifyHandler(deps)`.

- [ ] **Step 1: Write RED refund matcher tests** for exact Cash, exact Xanax, split refunds, under-refund, wrong recipient, on-time evidence surfaced late, and actual-payment overage being fully refunded.

- [ ] **Step 2: Write RED transaction route tests**

Test authenticated ownership/assignment and allowed states for:

```text
GET  /v1/transactions/:id
POST /v1/transactions/:id/check-payment
POST /v1/transactions/:id/retry-request
POST /v1/transactions/:id/retry-response
POST /v1/transactions/:id/request-refund
POST /v1/transactions/:id/check-refund
```

A client-supplied `{ state: 'COMPLETED' }` must never be accepted by any route.

- [ ] **Step 3: Implement pure refund matcher and refund repository** using actual `payments.verified_amount` and the same method.

- [ ] **Step 4: Implement transaction action routes** by translating allowed user actions into `transactionService.transitionTransaction(...)` and deduplicated expedited-check jobs.

- [ ] **Step 5: Write RED worker tests** proving refund verification -> `REFUNDED`; before deadline -> reschedule; after reconciliation with no evidence -> `REPORTABLE_MISSING_REFUND`; Torn outage -> hold/retry.

- [ ] **Step 6: Implement/register refund worker handler** and run tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/domain/refund-matcher.js server/src/db/refunds.js server/src/worker/refund-verify.js server/src/routes/transactions.js server/src/app.js server/src/server.js server/src/worker.js server/test/domain/refund-matcher.test.js server/test/worker/refund-verify.test.js server/test/routes/transactions.test.js
git commit -m "feat: add retry and refund verification workflow"
```

### Task 8: Upgrade the Userscript/API Client for Protected Transactions

**Files:**
- Modify: `src/api-client.js`
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Modify: `test/api-client.test.js`
- Create: `test/verification-credential-ui.test.js`
- Create: `test/reviver-marketplace-ui.test.js`
- Modify: `test/requester-ui.test.js`

**Interfaces:**
- Consumes all Stage 3 API endpoints.
- Produces verification credential settings, requester/reviver transaction controls, authoritative countdown rendering, and no client-authoritative state/evidence path.

- [ ] **Step 1: Add RED API client tests** for credential bind/status/revoke, reviver register/queue/accept, transaction status, expedited checks, retry/refund actions.

- [ ] **Step 2: Implement API client methods** exactly matching the server paths. Preserve the existing opaque ReviveRelay session handling.

- [ ] **Step 3: Add RED source-contract/UI tests** proving plaintext transaction key inputs are cleared immediately, never written to `GM_setValue`, requester cannot submit protected request without credential readiness, reviver cannot Accept without readiness, and UI renders server timestamps/countdowns rather than deriving deadlines from button clicks.

- [ ] **Step 4: Implement Verification Settings UI** showing status/capability/last validation plus Bind/Rebind/Revoke. Never redisplay the plaintext key.

- [ ] **Step 5: Implement requester transaction UI** for assigned reviver/terms, payment deadline/check, revive deadline, failed-attempt retry/refund choice, refund deadline/check, and terminal states.

- [ ] **Step 6: Implement reviver marketplace UI** for registration, queue, Accept, assigned requester, payment status, revive countdown, retry response, and refund obligation.

- [ ] **Step 7: Run client tests/build**

Run: `npm run test:client && npm run build && node --check dist/torn-revive-chat-collector.user.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/api-client.js torn-revive-chat-collector.user.js scripts/build.js test
git commit -m "feat: add protected transaction userscript workflow"
```

### Task 9: Full Marketplace-Core Verification, Internal Deployment, and Merge

**Files:**
- Modify: `README.md`
- Runtime: `/srv/voidsmith/torn-platform/reviverelay/app`

**Interfaces:**
- Produces a fully tested Stage 3 marketplace core on internal VPS only; telemetry/updater are separate plans.

- [ ] **Step 1: Update README** to state Stage 3 core behavior, credential scopes, protected timers, and remaining telemetry/updater/Stage 4/5 limitations.

- [ ] **Step 2: Run full client tests**

Run: `npm run test:client`

Expected: all tests PASS.

- [ ] **Step 3: Run full server tests against disposable PostgreSQL 16**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15432/reviverelay_test npm run test:server`

Expected: all tests PASS.

- [ ] **Step 4: Run build/syntax and deployment isolation tests**

Run: `npm run build && node --check dist/torn-revive-chat-collector.user.js && node --test server/test/deployment-isolation.test.js server/test/deploy`

Expected: PASS.

- [ ] **Step 5: Stage the exact verified tree into `/srv/voidsmith/torn-platform/reviverelay/app`**, run migrations using Compose project `reviverelay`, restart only ReviveRelay API/worker, and verify `GET http://127.0.0.1:18730/health` returns `{ "ok": true }`.

- [ ] **Step 6: Re-run runtime isolation gate** proving Postgres has no host port/outbound network, only ReviveRelay containers are on `reviverelay_db_internal`, and API remains localhost-only.

- [ ] **Step 7: Perform fresh PostgreSQL backup and disposable restore verification** against the migrated schema.

- [ ] **Step 8: Confirm launch gates remain closed**: `PAID_TIER_ENABLED=false`, no ReviveRelay public DNS/Caddy route, no paid subscription enforcement.

- [ ] **Step 9: Commit final docs, merge completed branch into local `main`, rerun full tests on merged `main`, synchronize GitHub `main`, verify tree equality, then remove the completed worktree/branch.**

```bash
git add README.md
git commit -m "docs: document Stage 3 marketplace verification"
```

- [ ] **Step 10: Update the Voidsmith Source of Truth** with only verified implementation/runtime facts and no secret values.
