# ReviveRelay Stage 3 Marketplace Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make direct ReviveRelay requests transactional: one reviver accepts, payment is verified, a five-minute revive SLA is enforced, failures/retries/other-reviver outcomes are resolved, and refunds are verified.

**Architecture:** Extend the Stage 1 worker into an evidence-driven state-transition engine. All Torn API responses are normalized through a narrow adapter before domain logic sees them. Worker jobs are idempotent and claimable with `SKIP LOCKED`; client panels poll ReviveRelay rather than independently deciding payment/revive state.

**Tech Stack:** Stage 1 Fastify/PostgreSQL backend, Torn API v2 adapter, Node worker, existing userscript API client/UI.

**Spec:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

**Amendment:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-review-amendment.md`

## Global Constraints

- 3-minute payment window; do not release until 60-second reconciliation completes.
- Payment evidenced at/before original deadline is valid even if Torn exposes it during reconciliation.
- Late payment before final release enters refund-required-late-payment, never silent reassignment.
- Five-minute revive timer starts only at verified payment.
- Genuine failed attempt is not misconduct.
- Retry response window is 2 minutes.
- Other-reviver success requires refund.
- Requester self-exit or natural Hospital expiry gets no refund.
- Refund deadline is 10 minutes.
- Torn outage/lag pauses/retries verification and never creates fraud automatically.

---

### Task 1: Expand Torn adapter with normalized evidence interfaces

**Files:**
- Modify: `server/src/torn/client.js`
- Create: `server/src/torn/evidence.js`
- Create: `server/test/torn/evidence.test.js`

**Interfaces:**
- `listMoneyTransfers(apiKey, { targetId, from, to }) -> Transfer[]`
- `listItemTransfers(apiKey, { targetId, from, to }) -> ItemTransfer[]`
- `listRevives(apiKey, { targetId, from, to, direction }) -> ReviveEvidence[]`
- `getHospitalState(apiKey, tornId) -> { hospitalized, until, observedAt }`

Normalized transfer fields: `evidenceId`, `timestamp`, `senderId`, `recipientId`, `amount` or `itemId/itemName/quantity`.

Normalized revive fields: `evidenceId`, `timestamp`, `reviverId`, `targetId`, `success`.

- [ ] **Step 1: Write parser tests from representative fixture JSON**

Store fixtures under `server/test/fixtures/torn/`; tests assert stable normalized records and typed behavior for API error/rate-limit/unavailable responses.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement only the narrow selections needed by the spec**

No unrelated battle stats/messages/faction/inventory requests. Adapter accepts injected `fetchImpl` for tests.

- [ ] **Step 4: Run tests and commit**

```bash
node --test server/test/torn/evidence.test.js
git add server/src/torn server/test/torn server/test/fixtures/torn
git commit -m "feat(torn): normalize payment and revive evidence"
```

---

### Task 2: Implement payment matching as a pure domain rule

**Files:**
- Create: `server/src/domain/payment.js`
- Create: `server/test/domain/payment.test.js`

**Interfaces:**
- `matchPayment(transaction, evidence[]) -> { kind: 'valid'|'late'|'none', evidence }`

- [ ] **Step 1: Write tests**

Cash match requires requester -> assigned reviver and amount meeting the agreed offer. Xanax requires requester -> assigned reviver and quantity meeting agreed offer. Evidence before acceptance is rejected. Event timestamp `<= paymentDeadline` is valid; event timestamp `> paymentDeadline` is late.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement matcher with evidence-ID idempotency**

A previously consumed evidence ID cannot satisfy a second transaction.

- [ ] **Step 4: Run and commit**

```bash
node --test server/test/domain/payment.test.js
git add server/src/domain/payment.js server/test/domain/payment.test.js
git commit -m "feat(payment): match protected revive payments"
```

---

### Task 3: Implement 3-minute deadline and 60-second reconciliation worker

**Files:**
- Create: `server/src/worker/handlers/payment-verify.js`
- Modify: `server/src/db/transactions.js`
- Create: `server/test/worker/payment-reconciliation.test.js`

**Interfaces:**
- Handler input: `{ transactionId }`
- Persists `PAYMENT_VERIFIED`, `PAYMENT_RECONCILING`, `REFUND_REQUIRED_LATE_PAYMENT`, or releases request after final no-payment check.

- [ ] **Step 1: Write clock-controlled tests**

Cover payment found at 2:59 but API exposes at 3:20 -> valid; no payment at 3:00 -> reconciliation lock remains; no payment by 4:00 -> release; payment event at 3:15 -> late-payment refund path.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement scheduling**

On accept, enqueue payment checks. At deadline transition to `PAYMENT_RECONCILING`; schedule immediate, +30s, +60s checks. Release only after final successful API check shows no qualifying/late payment.

- [ ] **Step 4: Assert no second reviver can accept during reconciliation**

Integration test attempts accept against same request and expects conflict.

- [ ] **Step 5: Run/commit**

```bash
node --test server/test/worker/payment-reconciliation.test.js
git add server/src/worker/handlers/payment-verify.js server/src/db/transactions.js server/test/worker/payment-reconciliation.test.js
git commit -m "feat(payment): reconcile in-flight payments safely"
```

---

### Task 4: Start the five-minute revive SLA only from verified payment

**Files:**
- Modify: `server/src/db/transactions.js`
- Create: `server/test/db/revive-deadline.test.js`

**Interfaces:**
- `markPaymentVerified(transactionId, evidence, verifiedAt) -> transaction`

- [ ] **Step 1: Write test**

Assert `revive_deadline` is null before verification and exactly `payment_verified_at + 5 minutes` afterward, regardless of `accepted_at`.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement transactionally with payment row insert + audit event + revive job enqueue**

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/db/revive-deadline.test.js
git add server/src/db/transactions.js server/test/db/revive-deadline.test.js
git commit -m "feat(sla): start revive clock after verified payment"
```

---

### Task 5: Implement assigned-reviver attempt matching

**Files:**
- Create: `server/src/domain/revive.js`
- Create: `server/src/worker/handlers/revive-verify.js`
- Create: `server/test/domain/revive.test.js`
- Create: `server/test/worker/revive-verify.test.js`

**Interfaces:**
- `matchAssignedAttempt(transaction, revives[]) -> ReviveEvidence | null`

- [ ] **Step 1: Write matcher tests**

Require exact assigned reviver ID + requester target ID + attempt timestamp >= payment verification. Success and failure both count as genuine attempt.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement idempotent attempt ingestion**

Insert unique `revive_attempts.torn_evidence_id`. Success -> `COMPLETED`; failure -> `FAILED_ATTEMPT_CHOICE`. Never label failure as no-attempt.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/domain/revive.test.js server/test/worker/revive-verify.test.js
git add server/src/domain/revive.js server/src/worker/handlers/revive-verify.js server/test/domain/revive.test.js server/test/worker/revive-verify.test.js
git commit -m "feat(revive): verify assigned revive attempts"
```

---

### Task 6: Detect successful revives by another player

**Files:**
- Modify: `server/src/worker/handlers/revive-verify.js`
- Create: `server/test/worker/other-reviver.test.js`

**Interfaces:** Uses requester credential to inspect incoming revive evidence during protected transaction.

- [ ] **Step 1: Write tests**

A successful revive targeting requester by reviver ID != assigned reviver after payment -> `REFUND_REQUIRED`. Failed third-party attempt alone does not cancel assigned reviver's SLA.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement evidence priority**

When both assigned success and third-party success exist, resolve by earliest successful evidence timestamp. Store evidence snapshot before transition.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/worker/other-reviver.test.js
git add server/src/worker/handlers/revive-verify.js server/test/worker/other-reviver.test.js
git commit -m "feat(revive): handle third-party revive outcomes"
```

---

### Task 7: Resolve requester self-exit and natural Hospital expiry

**Files:**
- Create: `server/src/domain/hospital-exit.js`
- Create: `server/test/domain/hospital-exit.test.js`
- Modify: `server/src/worker/handlers/revive-verify.js`

**Interfaces:**
- `classifyHospitalExit({ hospitalUntilAtPayment, currentState, successfulIncomingRevive }) -> 'none'|'natural'|'self'|'other_reviver'`

- [ ] **Step 1: Write tests**

Natural: current time >= recorded Hospital-until and no incoming successful revive. Self: left before recorded expiry and no incoming successful revive. Both are no-refund closures. Other reviver remains refund-required.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Persist hospital-until snapshot at payment verification and implement classifier**

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/domain/hospital-exit.test.js
git add server/src/domain/hospital-exit.js server/test/domain/hospital-exit.test.js server/src/worker/handlers/revive-verify.js
git commit -m "feat(outcome): classify requester hospital exits"
```

---

### Task 8: Implement no-attempt deadline with final verification pass

**Files:**
- Modify: `server/src/worker/handlers/revive-verify.js`
- Create: `server/test/worker/no-attempt.test.js`

**Interfaces:** On deadline, final Torn check precedes `REPORTABLE_NO_ATTEMPT`.

- [ ] **Step 1: Write tests**

Attempt evidence exposed just after 5:00 but timestamped before deadline prevents reportable state. Torn unavailable at deadline keeps transaction verification-pending and does not punish reviver.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement final evidence pass + retry on service failure**

Only an authoritative successful check returning no attempt allows reportable transition.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/worker/no-attempt.test.js
git add server/src/worker/handlers/revive-verify.js server/test/worker/no-attempt.test.js
git commit -m "feat(sla): verify before marking no-attempt"
```

---

### Task 9: Implement failed-attempt choice and two-minute retry approval

**Files:**
- Create: `server/src/routes/retry.js`
- Create: `server/src/worker/handlers/retry-timeout.js`
- Create: `server/test/routes/retry.test.js`
- Create: `server/test/worker/retry-timeout.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- `POST /v1/transactions/:id/retry-request`
- `POST /v1/transactions/:id/retry-response` body `{ decision: 'accept'|'decline' }`
- requester may call `POST /v1/transactions/:id/refund-request` during retry window.

- [ ] **Step 1: Write authorization/state tests**

Only requester can request retry/refund choice; only assigned reviver can respond. Retry request sets deadline `now + 2 minutes`.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement routes and timeout job**

Accept -> new five-minute attempt deadline and next sequence number. Decline/timeout/requester refund -> `REFUND_REQUIRED`.

- [ ] **Step 4: Test requester withdrawal to refund during retry wait**

- [ ] **Step 5: Run/commit**

```bash
node --test server/test/routes/retry.test.js server/test/worker/retry-timeout.test.js
git add server/src/routes/retry.js server/src/worker/handlers/retry-timeout.js server/test/routes/retry.test.js server/test/worker/retry-timeout.test.js server/src/app.js
git commit -m "feat(retry): bound failed-revive retry decisions"
```

---

### Task 10: Implement refund matching and ten-minute deadline

**Files:**
- Create: `server/src/domain/refund.js`
- Create: `server/src/worker/handlers/refund-verify.js`
- Create: `server/test/domain/refund.test.js`
- Create: `server/test/worker/refund-verify.test.js`

**Interfaces:**
- `matchRefund(transaction, outgoingEvidence[]) -> evidence | null`

- [ ] **Step 1: Write exact refund tests**

Cash refund must return at least the verified cash received to requester; Xanax refund must return at least verified quantity. Evidence must originate assigned reviver after `refund_required_at`. Evidence ID unique.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement `REFUND_REQUIRED` transition timestamps**

Set `refund_deadline = refund_required_at + 10 minutes`; insert `refunds` row; schedule checks.

- [ ] **Step 4: Implement final deadline verification**

Verified -> `REFUNDED`. Authoritative no-refund after deadline -> `REPORTABLE_NO_REFUND`. Torn outage -> retry, no automatic misconduct.

- [ ] **Step 5: Run/commit**

```bash
node --test server/test/domain/refund.test.js server/test/worker/refund-verify.test.js
git add server/src/domain/refund.js server/src/worker/handlers/refund-verify.js server/test/domain/refund.test.js server/test/worker/refund-verify.test.js
git commit -m "feat(refund): verify ten-minute payment returns"
```

---

### Task 11: Add reviver queue and accepted-transaction API views

**Files:**
- Modify: `server/src/routes/reviver-queue.js`
- Create: `server/src/routes/transactions.js`
- Create: `server/test/routes/marketplace.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- `GET /v1/reviver/queue?method=&minOffer=&sort=`
- `GET /v1/transactions/:id`
- `POST /v1/transactions/:id/check-payment`

- [ ] **Step 1: Write route tests**

Queue exposes direct requests and public leads distinctly. Direct requests include offer/comment; public leads are marked `protected:false`. Accepted transaction exposes both identities, server time and deadlines, but no API keys/evidence secrets.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement filters/sorting**

Cash and Xanax filters; newest/oldest/highest offer within same method. No paid priority ordering.

- [ ] **Step 4: Implement check-payment nudge**

Requester action enqueues an immediate payment check but cannot mark itself paid.

- [ ] **Step 5: Run/commit**

```bash
node --test server/test/routes/marketplace.test.js
git add server/src/routes server/test/routes/marketplace.test.js server/src/app.js
git commit -m "feat(api): expose protected marketplace transaction views"
```

---

### Task 12: Add requester and reviver transaction UI

**Files:**
- Create: `src/marketplace-ui.js`
- Create: `test/marketplace-ui.test.js`
- Modify: `src/api-client.js`
- Modify: `torn-revive-chat-collector.user.js`

**Interfaces:**
- UI view model renders queue, accepted identities, reputation placeholder, payment/revive/retry/refund/reportable states.

- [ ] **Step 1: Write pure view-model tests**

Test exact actions enabled per state: Accept only AVAILABLE protected requests; requester `I've Paid` only waiting/reconciling; retry/refund choice only after verified failed attempt; Report only reportable.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement reviver queue view**

Each accepted request shows requester Torn name/ID/profile link, agreed payment and comment. Public candidate leads are visually labeled unprotected and do not expose Accept transaction flow.

- [ ] **Step 4: Implement requester accepted view**

Show reviver name/ID/profile/copy ID, reputation summary slot, agreed payment, 3-minute payment countdown/reconciliation label, then 5-minute revive countdown after verified payment.

- [ ] **Step 5: Implement retry/refund state controls**

All actions call backend; no client-only transition.

- [ ] **Step 6: Run/commit**

```bash
node --test test/marketplace-ui.test.js
git add src/marketplace-ui.js src/api-client.js test/marketplace-ui.test.js torn-revive-chat-collector.user.js
git commit -m "feat(ui): add ReviveRelay transaction marketplace"
```

---

### Task 13: Stage 3 end-to-end state-machine test

**Files:**
- Create: `server/test/e2e/marketplace-flow.test.js`

**Interfaces:** Full API + worker with fake Torn adapter and PostgreSQL.

- [ ] **Step 1: Write successful flow**

Requester creates $750000 request -> reviver accepts -> payment evidence appears -> verify 5-minute deadline starts -> successful assigned revive evidence -> completed.

- [ ] **Step 2: Write exception flows**

Cover failed+retry success; failed+refund; other reviver -> refund; self-exit no refund; natural expiry no refund; no attempt reportable; no refund reportable; late payment refund; reconciliation delayed valid payment.

- [ ] **Step 3: Run all Stage 3 tests**

```bash
npm test
npm --prefix server test
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/test/e2e/marketplace-flow.test.js
git commit -m "test(stage3): cover marketplace lifecycle end to end"
```

## Stage 3 completion gate

- Every money/item/revive outcome is evidence-backed and idempotent.
- No client action can fake payment or revive completion.
- API outages never create automatic fraud states.
- Reconciliation prevents double assignment around late-visible payments.
- Retry cannot hang indefinitely.
- Full successful and exception flow integration tests pass on PostgreSQL 16.
