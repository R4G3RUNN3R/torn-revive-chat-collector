# ReviveRelay Stage 4 Trust and Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent reviver reputation, evidence-backed reports/disputes, protective suspension and permanent bans, administrator tooling, audit history, and a one-way Google Sheets mirror.

**Architecture:** Derive public reputation from authoritative transaction/evidence tables; never trust client-submitted counters. Reports create immutable evidence snapshots and may trigger protective suspension, but permanent bans require an administrator decision recorded in audit history. Google Sheets receives summaries through an outbox worker and has no write path back into PostgreSQL.

**Tech Stack:** Existing Node/PostgreSQL backend, Fastify routes, worker jobs, Google Apps Script mirror receiver.

**Spec:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

## Global Constraints

- Failed legitimate revive attempts are not misconduct.
- A verified required refund completed on time is not misconduct.
- High-confidence no-attempt/no-refund reports suspend reviver from new jobs pending review.
- Ban/reputation state is tied to Torn ID and survives reinstall.
- Requester-visible reputation is aggregate only; raw evidence/admin notes remain private.
- Google Sheets is one-way and never authoritative.

---

### Task 1: Build reputation aggregation from authoritative records

**Files:**
- Create: `server/src/domain/reputation.js`
- Create: `server/src/db/reputation.js`
- Create: `server/test/domain/reputation.test.js`
- Create: `server/test/db/reputation.test.js`

**Interfaces:**
- `computeReputation(events) -> ReputationSummary`
- `getReviverReputation(reviverId) -> public + private summary`

- [ ] **Step 1: Write pure aggregation tests**

Given transactions/attempts/refunds/disputes, assert counts for accepted, successful, failed attempts, refunds required/completed/overdue, reports, verified disputes, late/no-attempt violations, cash/xanax jobs and success percentage.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement SQL-backed aggregation/materialized summary updater**

Use transaction IDs/evidence rows as source of truth; never increment counters from client requests.

- [ ] **Step 4: Run tests and commit**

```bash
node --test server/test/domain/reputation.test.js server/test/db/reputation.test.js
git add server/src/domain/reputation.js server/src/db/reputation.js server/test/domain/reputation.test.js server/test/db/reputation.test.js
git commit -m "feat(reputation): derive persistent reviver performance"
```

---

### Task 2: Expose requester-safe reputation API

**Files:**
- Create: `server/src/routes/reputation.js`
- Create: `server/test/routes/reputation.test.js`
- Modify: `server/src/app.js`
- Modify: `src/marketplace-ui.js`

**Interfaces:**
- `GET /v1/revivers/:tornId/reputation`
- Public fields: `completed`, `successful`, `failedAttempts`, `successRate`, `completedRefunds`, `verifiedDisputes`, `standing`, `memberSince`.

- [ ] **Step 1: Write response privacy test**

Assert public response excludes raw report text, evidence IDs, API metadata, internal notes, dismissed accusations, admin actor IDs and raw payment/refund records.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement route and wire accepted-job UI**

Requester sees reputation before payment.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/routes/reputation.test.js
git add server/src/routes/reputation.js server/test/routes/reputation.test.js server/src/app.js src/marketplace-ui.js
git commit -m "feat(reputation): show safe reviver history to requesters"
```

---

### Task 3: Create immutable report evidence snapshots

**Files:**
- Create: `server/src/domain/dispute.js`
- Create: `server/src/db/disputes.js`
- Create: `server/src/routes/reports.js`
- Create: `server/test/routes/reports.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- `POST /v1/transactions/:id/report` body `{ comment? }`
- Evidence snapshot includes transaction state/timestamps, verified payment/refund/attempt evidence references, requester/reviver IDs and report reason.

- [ ] **Step 1: Write report eligibility tests**

Only requester can report their transaction; only reportable states can create high-confidence violation report. Failed-attempt state alone cannot report `NO_ATTEMPT`.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement immutable evidence snapshot**

Store JSONB snapshot copied at report time plus optional requester comment (max 1000 chars). Screenshots are out of scope for initial Stage 4; server evidence remains primary.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/routes/reports.test.js
git add server/src/domain/dispute.js server/src/db/disputes.js server/src/routes/reports.js server/test/routes/reports.test.js server/src/app.js
git commit -m "feat(disputes): preserve evidence-backed reports"
```

---

### Task 4: Add immediate protective suspension

**Files:**
- Create: `server/src/domain/standing.js`
- Modify: `server/src/db/disputes.js`
- Modify: `server/src/security/authenticate.js`
- Create: `server/test/domain/standing.test.js`

**Interfaces:**
- Reviver standing: `ACTIVE`, `SUSPENDED`, `BANNED`.

- [ ] **Step 1: Write standing tests**

High-confidence report for verified payment+no-attempt or overdue required refund sets SUSPENDED; ordinary complaint without evidence does not automatically permanently ban.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement suspension transactionally with report creation**

Suspended reviver retains requester-facing history but `Accept` returns 403 `REVIVER_SUSPENDED`.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/domain/standing.test.js
git add server/src/domain/standing.js server/src/db/disputes.js server/src/security/authenticate.js server/test/domain/standing.test.js
git commit -m "feat(trust): suspend revivers on high-confidence reports"
```

---

### Task 5: Add separately authenticated administrator routes

**Files:**
- Create: `server/src/security/admin-auth.js`
- Create: `server/src/routes/admin.js`
- Create: `server/test/routes/admin.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- Header `Authorization: Bearer <ADMIN_API_TOKEN>` on `/v1/admin/*` only.
- `GET /v1/admin/disputes?state=open`
- `GET /v1/admin/disputes/:id`
- `POST /v1/admin/disputes/:id/resolve` body `{ outcome: 'confirmed'|'dismissed', note }`
- `POST /v1/admin/revivers/:id/unban` body `{ note }`

- [ ] **Step 1: Write separate-auth tests**

Normal user session cannot call admin routes. Wrong admin token returns 401. Admin token never accepted as a user session token elsewhere.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement resolution rules**

Confirmed violation -> BANNED and ban row tied to transaction/dispute. Dismissed -> restore ACTIVE unless another suspension/ban remains. Every decision requires non-empty admin note and writes audit event.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/routes/admin.test.js
git add server/src/security/admin-auth.js server/src/routes/admin.js server/test/routes/admin.test.js server/src/app.js
git commit -m "feat(admin): review disputes and enforce bans"
```

---

### Task 6: Make audit events tamper-evident enough for operational review

**Files:**
- Create: `server/src/db/audit.js`
- Create: `server/test/db/audit.test.js`
- Modify: transaction/report/admin repositories to call it.

**Interfaces:**
- `appendAuditEvent({ actorType, actorId, entityType, entityId, action, details })`

- [ ] **Step 1: Write tests**

Critical events must append rather than update/delete: accept, payment verified, revive evidence, refund required/verified, report, suspension, dispute resolution, ban/unban, subscription changes later.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement append-only repository**

Application DB user receives SELECT/INSERT on audit table; no code path exports UPDATE/DELETE helper.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/db/audit.test.js
git add server/src/db/audit.js server/test/db/audit.test.js server/src
git commit -m "feat(audit): record immutable marketplace decisions"
```

---

### Task 7: Convert Google Apps Script into a one-way admin mirror receiver

**Files:**
- Modify: `google-apps-script/Code.gs`
- Create: `google-apps-script/README.md`
- Create: `test/google-mirror-contract.test.js`

**Interfaces:**
- Backend POST mirror payload `{ token, table, rows, generatedAt }`.
- Allowed tables/tabs: `Revivers`, `Transactions`, `Disputes`, `Subscriptions`.

- [ ] **Step 1: Write contract test from source**

Assert receiver has no action that posts state back to ReviveRelay and allowlists exactly the admin tabs. Assert API-key/secret field names are rejected/absent from row schemas.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Replace legacy raw-chat authority behavior**

Apps Script validates mirror token, selects tab from allowlist, replaces/upserts rows by stable ID, and returns counts. It never decides bans, transactions, subscriptions or evidence state.

- [ ] **Step 4: Run/commit**

```bash
node --test test/google-mirror-contract.test.js
git add google-apps-script test/google-mirror-contract.test.js
git commit -m "feat(mirror): make Google Sheets admin-only"
```

---

### Task 8: Add server outbox and mirror worker

**Files:**
- Create: `server/src/db/migrations/003_mirror_outbox.sql`
- Create: `server/src/db/mirror.js`
- Create: `server/src/worker/handlers/sheets-mirror.js`
- Create: `server/test/worker/sheets-mirror.test.js`

**Interfaces:**
- `enqueueMirrorSnapshot(kind)`
- Worker posts only sanitized summary rows.

- [ ] **Step 1: Write tests**

Mirror payload for Revivers contains aggregate stats/standing only; no API credentials, session hashes, raw evidence or internal encryption fields. Sheets failure retries without rolling back authoritative PostgreSQL state.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement outbox + idempotent mirror job**

Use configured Apps Script URL/token. If not configured, mark mirror disabled rather than failing marketplace operations.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/worker/sheets-mirror.test.js
git add server/src/db/migrations/003_mirror_outbox.sql server/src/db/mirror.js server/src/worker/handlers/sheets-mirror.js server/test/worker/sheets-mirror.test.js
git commit -m "feat(mirror): export sanitized admin summaries"
```

---

### Task 9: Add requester Report UI and reviver standing UI

**Files:**
- Modify: `src/marketplace-ui.js`
- Modify: `src/api-client.js`
- Create: `test/dispute-ui.test.js`
- Modify: `torn-revive-chat-collector.user.js`

**Interfaces:** Report action only shown for server reportable states.

- [ ] **Step 1: Write view tests**

No report button after legitimate failed attempt or requester-caused exit. Report button exists for `REPORTABLE_NO_ATTEMPT` and `REPORTABLE_NO_REFUND`.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement report confirmation**

Show server-held evidence summary, optional comment box, submit. Reviver options show current standing and block marketplace controls when suspended/banned.

- [ ] **Step 4: Run/commit**

```bash
node --test test/dispute-ui.test.js
git add src/marketplace-ui.js src/api-client.js test/dispute-ui.test.js torn-revive-chat-collector.user.js
git commit -m "feat(ui): surface reports and reviver standing"
```

---

### Task 10: Stage 4 trust regression suite

**Files:**
- Create: `server/test/e2e/trust-flow.test.js`

- [ ] **Step 1: Test confirmed violation**

No-attempt transaction -> requester report -> automatic suspension -> admin confirms -> BANNED -> new Accept denied after new session/reinstall simulation.

- [ ] **Step 2: Test dismissed report**

Ambiguous/manual report -> admin dismisses -> standing returns ACTIVE if no other restrictions.

- [ ] **Step 3: Test legitimate failure/refund**

Failed revive then timely refund does not create misconduct; reputation records failed attempt + completed refund.

- [ ] **Step 4: Test one-way mirror**

Changing mocked Sheet response/data never mutates PostgreSQL reputation/standing.

- [ ] **Step 5: Run full suite and commit**

```bash
npm test
npm --prefix server test
npm run build
git add server/test/e2e/trust-flow.test.js
git commit -m "test(stage4): verify trust enforcement end to end"
```

## Stage 4 completion gate

- Reputation survives session/install replacement because Torn ID is authoritative.
- Failed attempts and timely refunds do not count as fraud.
- Report submission cannot directly create permanent ban without evidence/admin path.
- High-confidence reports protectively suspend acceptance.
- Admin decisions are separately authenticated/audited.
- Google Sheets is demonstrably one-way and secret-free.
