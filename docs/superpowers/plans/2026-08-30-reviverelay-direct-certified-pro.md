# ReviveRelay Direct Certified Requests + Reviver Pro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ReviveRelay chat listening with one-click server-certified revive requests and add server-authorized Reviver Pro trials/subscriptions paid in Xanax or Torn cash.

**Architecture:** Keep the browser-proven ReviveRelay startup/session foundation, but rebuild the production client as direct-only: saved requester preset plus a Torn-sidebar `ReviveRelay → Revive Me!` action sends authenticated requests directly to the existing marketplace. The server derives request certification, Pro entitlements, plan prices, invoices, payment evidence, and reviver authorization; the client never grants itself certification or Pro. Pro billing uses a dedicated receiving Torn account and the existing worker system to match incoming Cash/Xanax logs to 24-hour invoices.

**Tech Stack:** Tampermonkey userscript JavaScript, Node.js 20+, Fastify 5, PostgreSQL/pg, Zod, Torn API v2, Docker Compose, Caddy, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-30-reviverelay-direct-certified-requests-design.md`

## Global Constraints

- Production ReviveRelay performs **zero Torn chat listening**: no chat DOM scanning, chat-text classification, minimized-chat probes, WebSocket interception, public-chat candidate upload, or shared public-chat feed.
- Expanded Torn sidebar label is exactly `ReviveRelay → Revive Me!`.
- Free requester access includes identity bind, preset, certified request create/read/cancel, and the sidebar action.
- Reviver-side queue/acceptance requires server-authorized `REVIVER_PRO` state `TRIAL` or `ACTIVE`.
- Reviver transaction evidence remains separately gated by the existing restricted reviver verification credential.
- Request certification is server-derived from authenticated direct origin; clients cannot submit trusted `certified` or `origin` values.
- One-time requester identity verification still uses the minimal Torn API bind flow and does not persist that key.
- Request creation no longer requires a requester transaction-verification credential.
- One Reviver Pro trial per verified Torn identity; trial lasts exactly 7 days, must be explicitly activated, and is unavailable after that Torn identity has ever activated paid Pro.
- Launch plans are server-owned definitions: monthly = `10 Xanax` or `$10,000,000`, 6 months = `55 Xanax` or `$55,000,000`, yearly = `100 Xanax` or `$100,000,000`.
- Commercial conversion is fixed at `1 Xanax = $1,000,000 Torn cash`; no live-market pricing is used.
- Pro invoices expire exactly 24 hours after server creation.
- Pro payment evidence must match sender Torn ID, invoice currency, exact amount, invoice time window, and an unused Torn log ID.
- `PAID_TIER_ENABLED` remains `false` through implementation/deployment until the paid-tier acceptance gate and designated receiving-account secret are ready. This flag gates paid invoice creation/payment scanning only; the explicit 7-day trial remains available for the diagnostic browser gate.
- No receiving-account API key may appear in client code, responses, audit details, or telemetry.
- Existing ReviveRelay PostgreSQL remains isolated from all other Voidsmith products.
- automatic production-channel promotion is forbidden until the user confirms the real Torn/Tampermonkey acceptance gates.
- Current Control-B artifact is `0.4.6`, SHA-256 `f6fb5a8d2400fdaf225ba11c6988961e12b8b6b0c9cd8f6ab70dc2909aeb6564`, build commit `b98127727936f851e0cf0be2d46397311e751e06`.
- New direct-only diagnostic line is version `0.5.0`.

---

## File Structure and Responsibilities

### Browser baseline / build

- `test/fixtures/client/reviverelay-0.4.6-control-b.user.txt` — immutable rollback/control fixture copied from the browser-gate artifact.
- `test/fixtures/client/reviverelay-0.4.6-control-b.json` — artifact SHA/build metadata.
- `scripts/client-modules.js` — one canonical direct-only module inventory consumed by build and release verification.
- `scripts/build.js` — bundles only direct-product modules for 0.5.0.
- `scripts/release-client.js` — verifies the same canonical module inventory and generated provenance.

### New client modules

- `src/request-preset.js` — validates/normalizes local requester preset values and derives sidebar readiness.
- `src/sidebar-action.js` — locates/reconciles one ReviveRelay action in Torn left navigation and manages its visual/accessibility states without reading chat.
- `src/pro-client.js` — authenticated calls for Pro status/trial/catalog/invoices; deliberately separate from locked browser-proven `src/api-client.js`.

### Existing client files modified

- `torn-revive-chat-collector.user.js` — direct-only runtime and UI; removes chat discovery/candidate/shared-feed execution.
- `package.json` — `0.5.0`.
- `test/*` — retire chat-runtime expectations and add direct requester/Pro/privacy/build tests.

### Server request/certification

- `server/src/db/migrations/005_direct_requests.sql` — adds server-owned request origin.
- `server/src/db/requests.js` — persists/projects `origin`.
- `server/src/db/transactions.js` — projects direct origin and derived `certified` to queue/transaction views.
- `server/src/routes/requests.js` — removes requester credential precondition while retaining session auth/validation/rate limits.
- `server/src/app.js` — disables legacy candidate routes in direct-only server composition.

### Server Pro entitlement

- `server/src/db/migrations/006_reviver_pro.sql` — Pro entitlement/invoice/payment-evidence schema.
- `server/src/domain/pro-plans.js` — immutable launch catalog and calendar-duration function.
- `server/src/db/pro-entitlements.js` — trial/paid entitlement state and atomic extension logic.
- `server/src/security/pro-access.js` — active Pro check and Fastify guard helper.
- `server/src/routes/pro.js` — Pro status, trial, catalog, invoice create/read/check endpoints.
- `server/src/routes/me.js` — projects entitlement status to the authenticated user.
- `server/src/routes/revivers.js` — requires Pro before reviver registration.
- `server/src/routes/reviver-queue.js` — requires Pro before queue/read/accept, then separately requires reviver evidence capability where needed.

### Server Pro billing

- `server/src/db/pro-invoices.js` — invoice persistence, pending lookup, idempotent evidence consumption, paid transition.
- `server/src/torn/pro-billing-evidence.js` — reads only receiving-account incoming money/item logs and normalizes payment evidence.
- `server/src/worker/subscription-scan.js` — matches pending invoices and activates entitlements, then reschedules itself.
- `server/src/db/jobs.js` — keeps `subscription.scan` as the recurring billing worker type.
- `server/src/worker.js` — wires the real `subscription.scan` handler only when paid tier is enabled/configured.
- `server/src/config.js` — validates paid-tier receiver ID/key only when `PAID_TIER_ENABLED=true`.
- `deploy/.env.example` — documents receiver configuration names with no secret values.

### New tests

- `test/control-b-046.test.js`
- `test/direct-only-build.test.js`
- `test/request-preset.test.js`
- `test/sidebar-action.test.js`
- `test/direct-request-ui.test.js`
- `test/pro-ui.test.js`
- `server/test/db/direct-requests.test.js`
- `server/test/db/pro-entitlements.test.js`
- `server/test/db/pro-invoices.test.js`
- `server/test/domain/pro-plans.test.js`
- `server/test/routes/pro.test.js`
- `server/test/routes/pro-gating.test.js`
- `server/test/torn/pro-billing-evidence.test.js`
- `server/test/worker/subscription-scan.test.js`
- `server/test/config-pro.test.js`

---

### Task 1: Freeze Control B and establish the 0.5.0 direct-only release boundary

**Files:**
- Create: `test/fixtures/client/reviverelay-0.4.6-control-b.user.txt`
- Create: `test/fixtures/client/reviverelay-0.4.6-control-b.json`
- Create: `test/control-b-046.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: published Control-B file `/srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.6-control-b.user.js`.
- Produces: immutable browser baseline and package version `0.5.0` for all later tasks.

- [ ] **Step 1: Write the failing baseline test before copying the fixture**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const fixture = path.resolve(__dirname, 'fixtures/client/reviverelay-0.4.6-control-b.user.txt');
const manifest = require('./fixtures/client/reviverelay-0.4.6-control-b.json');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('0.4.6 Control B remains the immutable browser rollback baseline', () => {
  assert.equal(sha256(fixture), 'f6fb5a8d2400fdaf225ba11c6988961e12b8b6b0c9cd8f6ab70dc2909aeb6564');
  assert.equal(manifest.buildCommit, 'b98127727936f851e0cf0be2d46397311e751e06');
  assert.equal(manifest.version, '0.4.6');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test test/control-b-046.test.js
```

Expected: FAIL because fixture/manifest do not yet exist.

- [ ] **Step 3: Copy the exact published Control-B artifact and create its manifest**

```bash
cp /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.6-control-b.user.js \
  test/fixtures/client/reviverelay-0.4.6-control-b.user.txt
cat > test/fixtures/client/reviverelay-0.4.6-control-b.json <<'JSON'
{
  "version": "0.4.6",
  "buildCommit": "b98127727936f851e0cf0be2d46397311e751e06",
  "sha256": "f6fb5a8d2400fdaf225ba11c6988961e12b8b6b0c9cd8f6ab70dc2909aeb6564"
}
JSON
```

- [ ] **Step 4: Bump only the source package version to 0.5.0 and rerun the baseline test**

Set:

```json
"version": "0.5.0"
```

Run:

```bash
node --test test/control-b-046.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json test/control-b-046.test.js test/fixtures/client/reviverelay-0.4.6-control-b.user.txt test/fixtures/client/reviverelay-0.4.6-control-b.json
git commit -m "test: freeze ReviveRelay 0.4.6 control baseline"
```

---

### Task 2: Make direct requests server-certified and remove requester transaction-key gating

**Files:**
- Create: `server/src/db/migrations/005_direct_requests.sql`
- Create: `server/test/db/direct-requests.test.js`
- Modify: `server/src/db/requests.js`
- Modify: `server/src/db/transactions.js`
- Modify: `server/src/routes/requests.js`
- Modify: `server/src/app.js`
- Modify: `server/test/routes/requests.test.js`
- Modify: `server/test/routes/reviver-queue.test.js`

**Interfaces:**
- Consumes: authenticated `request.reviveRelayUser.userId` and existing `validateOffer()`.
- Produces: request shape `{ ..., origin: 'reviverelay_direct', certified: true }`; `/v1/requests` no longer needs requester verification credential; legacy `/v1/candidates*` routes are absent from direct-only composition.

- [ ] **Step 1: Write failing migration/repository tests**

Add tests that migrate a disposable DB and assert:

```js
assert.equal(created.request.origin, 'reviverelay_direct');
const active = await repo.getActiveRequest(requesterId);
assert.equal(active.origin, 'reviverelay_direct');
```

Also query `information_schema.columns` and require `revive_requests.origin` with default `reviverelay_direct`.

- [ ] **Step 2: Write failing route tests for the new authorization boundary**

In `server/test/routes/requests.test.js`, replace the old requester-credential requirement with:

```js
test('POST /v1/requests requires session auth but not requester transaction credential', async t => {
  let created = null;
  const app = await buildTestApp({
    requestRepository: {
      async createRequest(input) { created = input; return { created: true, request: { id: VALID_REQUEST_ID, state: 'AVAILABLE', origin: 'reviverelay_direct' } }; },
      async getActiveRequest() { return null; },
      async cancelRequest() { return { cancelled: false, reason: 'NOT_FOUND' }; }
    },
    verificationCredentialRepository: { async getStatus() { throw new Error('must not be called for request creation'); } }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: 'Bearer requester-token' },
    payload: { paymentMethod: 'cash', offerAmount: 500000, comment: 'Please revive' }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(created.requesterId, REQUESTER_USER_ID);
  assert.equal(created.origin, undefined);
});
```

Add a second test that sends `{ certified: false, origin: 'public_chat' }` and expects 422 strict validation or those fields to be ignored while the persisted origin remains server-owned.

- [ ] **Step 3: Verify RED**

Run:

```bash
npm --prefix server test -- --test-name-pattern='direct|requester transaction credential|origin|certified'
```

Expected: FAIL because current route still calls `requireRequesterCredential` and no origin exists.

- [ ] **Step 4: Add migration 005**

```sql
ALTER TABLE revive_requests
  ADD COLUMN origin text NOT NULL DEFAULT 'reviverelay_direct';

ALTER TABLE revive_requests
  ADD CONSTRAINT revive_requests_origin_check
  CHECK (origin IN ('reviverelay_direct'));
```

Do not drop the old `public_chat_candidates` table yet; historical data can remain inert while the direct-only application stops registering candidate routes.

- [ ] **Step 5: Update repository projections**

`server/src/db/requests.js` row mapping includes:

```js
origin: row.origin || 'reviverelay_direct'
```

All new request inserts explicitly set `origin='reviverelay_direct'` in SQL rather than accepting an input origin.

`server/src/db/transactions.js` queue projection becomes:

```js
function rowToQueueRequest(row) {
  return {
    id: row.id,
    requesterTornId: row.requester_torn_id == null ? null : Number(row.requester_torn_id),
    requesterName: row.requester_name,
    paymentMethod: row.payment_method,
    offerAmount: Number(row.offer_amount),
    comment: row.comment,
    state: row.state,
    origin: row.origin,
    certified: row.origin === 'reviverelay_direct',
    createdAt: row.created_at
  };
}
```

and `listAvailableRequests()` selects `r.origin`.

- [ ] **Step 6: Remove requester credential gating only from request creation**

`registerRequestRoutes()` keeps session auth and rate limit:

```js
app.post('/v1/requests', {
  preHandler: app.authenticate,
  config: { rateLimit: RATE_LIMITS.REQUEST_WRITE }
}, handler);
```

Remove `requireRequesterCredential` from that route. Do not change transaction verification handlers in this task.

- [ ] **Step 7: Disable candidate endpoints in direct-only app composition**

Remove `registerCandidateRoutes` import/registration from `server/src/app.js`; keep repository code/database table only as dormant rollback/history material.

Add a test:

```js
const response = await app.inject({ method: 'POST', url: '/v1/candidates', payload: {} });
assert.equal(response.statusCode, 404);
```

- [ ] **Step 8: Run focused and full server tests**

```bash
npm --prefix server test
```

Expected: all server tests pass after stale candidate/requester-credential assertions are updated to the direct-only contract.

- [ ] **Step 9: Commit**

```bash
git add server/src/db/migrations/005_direct_requests.sql server/src/db/requests.js server/src/db/transactions.js server/src/routes/requests.js server/src/app.js server/test
git commit -m "feat: make revive requests direct and server certified"
```

---

### Task 3: Add Reviver Pro plan definitions and entitlement persistence

**Files:**
- Create: `server/src/db/migrations/006_reviver_pro.sql`
- Create: `server/src/domain/pro-plans.js`
- Create: `server/src/db/pro-entitlements.js`
- Create: `server/test/domain/pro-plans.test.js`
- Create: `server/test/db/pro-entitlements.test.js`

**Interfaces:**
- Produces `PRO_PLANS`, `getProPlan(planId)`, `amountForCurrency(plan, currency)`, `extendCalendarDuration(base, months)`.
- Produces repository methods `getStatus(userId, now)`, `startTrial({userId, now})`, `hasEverPaid(userId)`, `activatePaid({userId, invoiceId, months, paidAt})`, `revoke({userId, reason, now})`.

- [ ] **Step 1: Write failing plan-catalog tests**

```js
const { PRO_PLANS, getProPlan, amountForCurrency, extendCalendarDuration } = require('../../src/domain/pro-plans');

test('launch Pro plan catalog is server-owned and exact', () => {
  assert.deepEqual(PRO_PLANS.monthly, { id:'monthly', months:1, xanax:10, cash:10000000 });
  assert.deepEqual(PRO_PLANS.six_months, { id:'six_months', months:6, xanax:55, cash:55000000 });
  assert.deepEqual(PRO_PLANS.yearly, { id:'yearly', months:12, xanax:100, cash:100000000 });
});

test('calendar extension uses UTC calendar months', () => {
  assert.equal(extendCalendarDuration(new Date('2026-08-30T12:00:00Z'), 1).toISOString(), '2026-09-30T12:00:00.000Z');
});
```

- [ ] **Step 2: Verify plan tests RED, then implement the immutable catalog**

Run:

```bash
node --test server/test/domain/pro-plans.test.js
```

Expected: module-not-found RED.

Implement `server/src/domain/pro-plans.js` with frozen objects and strict errors for unknown plan/currency.

- [ ] **Step 3: Write failing entitlement repository tests**

Use disposable PostgreSQL and assert:

```js
assert.deepEqual(await repo.getStatus(userId, now), {
  state: 'NONE',
  trialEligible: true,
  trialStartedAt: null,
  validUntil: null
});

const trial = await repo.startTrial({ userId, now });
assert.equal(trial.state, 'TRIAL');
assert.equal(trial.validUntil.toISOString(), '2026-09-06T12:00:00.000Z');
await assert.rejects(() => repo.startTrial({ userId, now }), /TRIAL_ALREADY_USED/);
```

Then record a paid activation and assert future trial activation returns `TRIAL_NOT_ELIGIBLE`.

- [ ] **Step 4: Verify entitlement tests RED**

```bash
node --test server/test/db/pro-entitlements.test.js
```

Expected: migration/repository missing.

- [ ] **Step 5: Add schema**

`006_reviver_pro.sql` creates:

```sql
CREATE TABLE pro_entitlements (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  paid_started_at timestamptz,
  paid_until timestamptz,
  ever_paid boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  revoke_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (trial_started_at IS NULL OR trial_ends_at IS NOT NULL),
  CHECK (paid_started_at IS NULL OR paid_until IS NOT NULL)
);
```

Do not reuse `subscriptions.credited_days`; leave the old table untouched as legacy history.

- [ ] **Step 6: Implement atomic status/trial/paid extension logic**

Status precedence at `now`:

```js
if (row.revoked_at) state = 'EXPIRED';
else if (row.paid_until && row.paid_until > now) state = 'ACTIVE';
else if (row.trial_ends_at && row.trial_ends_at > now) state = 'TRIAL';
else if (row.trial_started_at || row.ever_paid) state = 'EXPIRED';
else state = 'NONE';
```

`activatePaid()` must lock the entitlement row and choose base date:

```js
const base = maxDate(paidAt, row.paid_until, row.trial_ends_at);
const validUntil = extendCalendarDuration(base, months);
```

Set `ever_paid=true` atomically.

- [ ] **Step 7: Run focused tests and full DB test group**

```bash
node --test server/test/domain/pro-plans.test.js server/test/db/pro-entitlements.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/db/migrations/006_reviver_pro.sql server/src/domain/pro-plans.js server/src/db/pro-entitlements.js server/test/domain/pro-plans.test.js server/test/db/pro-entitlements.test.js
git commit -m "feat: add Reviver Pro entitlement foundation"
```

---

### Task 4: Expose Pro status/trial and enforce Pro before reviver operations

**Files:**
- Create: `server/src/security/pro-access.js`
- Create: `server/src/routes/pro.js`
- Create: `server/test/routes/pro.test.js`
- Create: `server/test/routes/pro-gating.test.js`
- Modify: `server/src/routes/me.js`
- Modify: `server/src/routes/revivers.js`
- Modify: `server/src/routes/reviver-queue.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`

**Interfaces:**
- Produces `hasActivePro(status)`, `requireActivePro(entitlementRepository)` Fastify pre-handler.
- Routes: `GET /v1/pro/status`, `POST /v1/pro/trial`, `GET /v1/pro/plans`.
- `/v1/me` adds `pro` object.

- [ ] **Step 1: Write failing Pro status/trial tests**

```js
test('verified free user can explicitly start one seven-day Pro trial', async t => {
  const response = await app.inject({ method:'POST', url:'/v1/pro/trial', headers:auth });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().pro.state, 'TRIAL');
});

test('paid-before user cannot start a saved trial later', async t => {
  const response = await paidBeforeApp.inject({ method:'POST', url:'/v1/pro/trial', headers:auth });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, 'TRIAL_NOT_ELIGIBLE');
});
```

- [ ] **Step 2: Write failing Pro-gating tests**

For each state `NONE`, `EXPIRED`, assert:

```js
assert.equal((await app.inject({ method:'GET', url:'/v1/reviver/queue', headers:auth })).statusCode, 403);
assert.equal((await app.inject({ method:'POST', url:`/v1/requests/${VALID_REQUEST_ID}/accept`, headers:auth })).statusCode, 403);
assert.equal((await app.inject({ method:'POST', url:'/v1/reviver/register', headers:auth })).statusCode, 403);
```

For `TRIAL` and `ACTIVE`, authorization reaches the next existing role/credential check.

- [ ] **Step 3: Verify RED**

```bash
node --test server/test/routes/pro.test.js server/test/routes/pro-gating.test.js
```

Expected: missing route/guard failures.

- [ ] **Step 4: Implement Pro access guard**

```js
function hasActivePro(status) {
  return status && (status.state === 'TRIAL' || status.state === 'ACTIVE');
}

function requireActivePro(entitlementRepository) {
  return async function proGuard(request, reply) {
    const status = await entitlementRepository.getStatus(request.reviveRelayUser.userId, new Date());
    if (!hasActivePro(status)) return reply.code(403).send({ error: 'REVIVER_PRO_REQUIRED' });
    request.reviveRelayPro = status;
  };
}
```

- [ ] **Step 5: Register status/trial/catalog routes**

`GET /v1/pro/plans` returns only safe plan fields:

```js
{ plans: [
  { id:'monthly', label:'Monthly', months:1, xanax:10, cash:10000000 },
  { id:'six_months', label:'6 Months', months:6, xanax:55, cash:55000000 },
  { id:'yearly', label:'Yearly', months:12, xanax:100, cash:100000000 }
] }
```

`POST /v1/pro/trial` delegates to repository using authenticated user ID only.

- [ ] **Step 6: Project Pro state from `/v1/me`**

Return:

```js
pro: {
  state: status.state,
  trialEligible: status.trialEligible,
  trialStartedAt: status.trialStartedAt,
  validUntil: status.validUntil
}
```

No invoice/payment evidence is included in `/v1/me`.

- [ ] **Step 7: Insert Pro guard before reviver role/credential guards**

Order for queue/accept/register:

```js
preHandler: [app.authenticate, requirePro, requireReviver, requireReviverCredential]
```

where applicable. This ensures Free users cannot infer deeper protected-state details.

- [ ] **Step 8: Run tests and commit**

```bash
npm --prefix server test
git add server/src/security/pro-access.js server/src/routes/pro.js server/src/routes/me.js server/src/routes/revivers.js server/src/routes/reviver-queue.js server/src/app.js server/src/server.js server/test/routes
git commit -m "feat: enforce Reviver Pro access server side"
```

---

### Task 5: Add server-owned Pro invoices and auditable billing records

**Files:**
- Modify: `server/src/db/migrations/006_reviver_pro.sql`
- Create: `server/src/db/pro-invoices.js`
- Create: `server/test/db/pro-invoices.test.js`
- Modify: `server/src/routes/pro.js`
- Modify: `server/test/routes/pro.test.js`
- Modify: `server/src/security/rate-limits.js`

**Interfaces:**
- Produces `createInvoice({userId,tornId,planId,currency,now})`, `getInvoiceForUser({invoiceId,userId})`, `listPending(now)`, `markPaidWithEvidence(...)`, `expireDue(now)`, `cancelOpenForUser(userId,now)`.
- Routes: `POST /v1/pro/invoices`, `GET /v1/pro/invoices/:id`; safe invoice projection includes `paymentTarget: { tornId: config.PRO_RECEIVER_TORN_ID }` only when paid billing is enabled.

- [ ] **Step 1: Extend migration tests/schema expectations**

Require tables:

```sql
CREATE TABLE pro_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purchaser_torn_id bigint NOT NULL,
  plan_id text NOT NULL CHECK (plan_id IN ('monthly','six_months','yearly')),
  currency text NOT NULL CHECK (currency IN ('xanax','cash')),
  expected_amount bigint NOT NULL CHECK (expected_amount > 0),
  entitlement_months integer NOT NULL CHECK (entitlement_months IN (1,6,12)),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','PAID','EXPIRED','CANCELLED','REJECTED')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  matched_torn_log_id text UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at = created_at + interval '24 hours')
);

CREATE UNIQUE INDEX pro_invoices_one_open_per_user
  ON pro_invoices(user_id)
  WHERE state = 'PENDING';
```

Create `pro_payment_evidence` with unique `torn_log_id`, invoice FK, sender ID, currency, amount, evidence timestamp, recorded timestamp.

- [ ] **Step 2: Write repository RED tests**

Assert server catalog controls price:

```js
const invoice = await repo.createInvoice({ userId, tornId: 123, planId:'monthly', currency:'cash', now });
assert.equal(invoice.expectedAmount, 10000000);
assert.equal(invoice.entitlementMonths, 1);
assert.equal(invoice.expiresAt.toISOString(), '2026-08-31T12:00:00.000Z');
```

Assert creating another open invoice cancels/supersedes the first safely and only one remains pending.

- [ ] **Step 3: Verify RED, implement repository, rerun GREEN**

```bash
node --test server/test/db/pro-invoices.test.js
```

`createInvoice()` must call `getProPlan()` and `amountForCurrency()` itself. It must not accept expected amount or months from HTTP input.

- [ ] **Step 4: Add strict invoice route schema**

```js
const createInvoiceSchema = z.object({
  planId: z.enum(['monthly','six_months','yearly']),
  currency: z.enum(['xanax','cash'])
}).strict();
```

`POST /v1/pro/invoices` requires auth and `PAID_TIER_ENABLED=true`; otherwise return `503 { error:'PAID_TIER_DISABLED' }`. A successful response includes only the safe receiving Torn ID as `paymentTarget.tornId`, never the receiving API key.

- [ ] **Step 5: Add billing rate limits**

```js
PRO_INVOICE_WRITE: Object.freeze({ max: 10, timeWindow: '10 minutes' }),
PRO_INVOICE_READ: Object.freeze({ max: 60, timeWindow: '1 minute' })
```

- [ ] **Step 6: Test malicious client price injection**

Send:

```js
payload: { planId:'monthly', currency:'cash', expectedAmount:1, entitlementMonths:120 }
```

Expected: 422 because schema is strict. A valid monthly request still produces `$10,000,000` from server definitions.

- [ ] **Step 7: Run full server suite and commit**

```bash
npm --prefix server test
git add server/src/db/migrations/006_reviver_pro.sql server/src/db/pro-invoices.js server/src/routes/pro.js server/src/security/rate-limits.js server/test
git commit -m "feat: add Reviver Pro billing invoices"
```

---

### Task 6: Verify Xanax/Cash Pro payments from the designated receiving account

**Files:**
- Create: `server/src/torn/pro-billing-evidence.js`
- Create: `server/src/worker/subscription-scan.js`
- Create: `server/test/torn/pro-billing-evidence.test.js`
- Create: `server/test/worker/subscription-scan.test.js`
- Create: `server/test/config-pro.test.js`
- Modify: `server/src/config.js`
- Modify: `server/src/worker.js`
- Modify: `deploy/.env.example`

**Interfaces:**
- Produces `validateProReceiverCredential({keyInfo,ownerTornId,logMetadata})`, `normalizeProPaymentLogs(logs,{currency})`, and `createProBillingEvidenceService({tornClient,logMetadataResolver,receiverApiKey,receiverTornId})`.
- Produces `createSubscriptionScanHandler({invoiceRepository,entitlementRepository,evidenceService,jobRepository,clock})`.

- [ ] **Step 1: Write config RED tests**

```js
test('paid tier requires receiver id and API key', () => {
  assert.throws(() => loadConfig({ ...BASE_ENV, PAID_TIER_ENABLED:'true' }), /PRO_RECEIVER/);
});

test('paid tier disabled does not require receiver secret', () => {
  const config = loadConfig({ ...BASE_ENV, PAID_TIER_ENABLED:'false' });
  assert.equal(config.PAID_TIER_ENABLED, false);
});
```

- [ ] **Step 2: Implement conditional config**

Add:

```js
PRO_RECEIVER_TORN_ID: z.coerce.number().int().positive().optional(),
PRO_RECEIVER_API_KEY: z.string().min(1).max(128).optional()
```

and a schema refinement that requires both only when `PAID_TIER_ENABLED` is true.

`deploy/.env.example` contains names only:

```text
PAID_TIER_ENABLED=false
PRO_RECEIVER_TORN_ID=
PRO_RECEIVER_API_KEY=
```

- [ ] **Step 3: Write receiver-key validation and evidence normalization RED tests**

Validate the configured receiving key before it can power billing. Tests require the key owner to equal `PRO_RECEIVER_TORN_ID`, reject faction/company/private namespace access, and require restricted incoming money + incoming item log capability. A minimal valid fixture passes.

Use representative Torn logs and assert only canonical incoming evidence survives:

```js
assert.deepEqual(normalizeProPaymentLogs(cashLogs, { currency:'cash' }), [
  { tornLogId:'cash-1', senderTornId:123, currency:'cash', amount:10000000, at:new Date('2026-08-30T12:01:00Z') }
]);
assert.deepEqual(normalizeProPaymentLogs(itemLogs, { currency:'xanax' }), [
  { tornLogId:'item-1', senderTornId:123, currency:'xanax', amount:10, at:new Date('2026-08-30T12:02:00Z') }
]);
```

- [ ] **Step 4: Implement receiving-account credential validation and evidence service**

`validateProReceiverCredential()` accepts Torn key-info/log-metadata data and fails closed unless owner ID matches the configured receiving Torn ID, no faction/company/private namespace access is present, and only the user/torn/key selections required for identity + incoming log evidence are present. It must reject an unrestricted/full-access key rather than accepting broader access for convenience.

Reuse current Torn log category metadata resolution. The API key is closed over in server/worker memory and never returned from the service. At worker startup, validate the receiving key once before scheduling `subscription.scan`; invalid/broad credentials prevent billing worker startup and are reported through sanitized server telemetry without the key value.

For money use category `Money incoming`; for Xanax use `Items incoming` and canonical item ID `206`.

- [ ] **Step 5: Write worker RED tests for exact matching/idempotency**

Test matrix:

```text
matching sender + amount + currency + time => PAID and entitlement extended once
wrong sender => stays PENDING
wrong amount => stays PENDING
wrong currency => stays PENDING
log before createdAt => ignored
log after expiresAt => ignored
reused Torn log ID => cannot satisfy second invoice
same scan twice => one entitlement extension only
expired invoice => EXPIRED, no entitlement
```

- [ ] **Step 6: Implement `subscription.scan`**

The handler:

1. expires due pending invoices;
2. reads remaining pending invoices;
3. computes earliest `createdAt` and latest `expiresAt` bounded by `now`;
4. fetches incoming cash and item logs from receiving account;
5. indexes normalized evidence by sender/currency/amount;
6. for each pending invoice selects the earliest unused matching log inside its window;
7. calls one DB transaction that records unique evidence, marks invoice paid, and activates/extends entitlement;
8. reschedules `subscription.scan:reviver-pro` for `now + 60 seconds` while paid tier is enabled.

- [ ] **Step 7: Wire the worker only when configured**

Replace the `subscription.scan` unimplemented handler with the real handler when `config.PAID_TIER_ENABLED` is true. When false, do not enqueue the billing scan at startup.

- [ ] **Step 8: Run focused/full tests and secret scan**

```bash
node --test server/test/config-pro.test.js server/test/torn/pro-billing-evidence.test.js server/test/worker/subscription-scan.test.js
npm --prefix server test
grep -R "PRO_RECEIVER_API_KEY=.*[^=]" -n . --exclude-dir=.git --exclude='runtime.env' || true
```

Expected: tests pass; no committed secret value found.

- [ ] **Step 9: Commit**

```bash
git add server/src/config.js server/src/torn/pro-billing-evidence.js server/src/worker/subscription-scan.js server/src/worker.js deploy/.env.example server/test
git commit -m "feat: verify Reviver Pro payments from Torn logs"
```

---

### Task 7: Add auditable operator controls for exceptional Pro entitlement management

**Files:**
- Create: `server/src/security/admin-auth.js`
- Create: `server/src/routes/admin-pro.js`
- Create: `server/test/routes/admin-pro.test.js`
- Modify: `server/src/db/users.js`
- Modify: `server/src/db/pro-entitlements.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`

**Interfaces:**
- Produces `createAdminAuthenticate({adminToken})` using constant-time token comparison.
- Adds `identityRepository.findByTornId(tornId)`.
- Adds entitlement methods `grantManual({userId,months,reason,operatorTornId,now})`, `correctExpiry({userId,validUntil,reason,operatorTornId,now})`, and existing `revoke(...)` audit integration.
- Routes: `GET /v1/admin/pro/users/:tornId`, `POST /v1/admin/pro/grant`, `POST /v1/admin/pro/revoke`, `POST /v1/admin/pro/correct`.

- [ ] **Step 1: Write failing admin-auth tests**

```js
test('admin route rejects missing/wrong token and accepts exact configured token', async t => {
  assert.equal((await app.inject({ method:'GET', url:'/v1/admin/pro/users/123' })).statusCode, 401);
  assert.equal((await app.inject({ method:'GET', url:'/v1/admin/pro/users/123', headers:{'x-reviverelay-admin-token':'wrong'} })).statusCode, 401);
  assert.equal((await app.inject({ method:'GET', url:'/v1/admin/pro/users/123', headers:{'x-reviverelay-admin-token':'test-admin-token'} })).statusCode, 200);
});
```

Add a test that response payloads never echo the configured admin token.

- [ ] **Step 2: Verify RED**

```bash
node --test server/test/routes/admin-pro.test.js
```

Expected: module/route missing.

- [ ] **Step 3: Implement constant-time admin token guard**

`server/src/security/admin-auth.js` uses `crypto.timingSafeEqual` after length normalization and returns `401 {error:'ADMIN_AUTH_REQUIRED'}` on failure. Admin routes are registered only when `config.ADMIN_API_TOKEN` is configured.

- [ ] **Step 4: Add Torn-ID lookup and bounded entitlement operations**

`findByTornId()` returns only `{userId,tornId,name}`.

Manual grant accepts only integer `months` from 1 through 12. It extends from the latest of `now`, paid expiry, and trial expiry. `correctExpiry` accepts an ISO timestamp no more than 24 months in the future. Revoke requires a non-empty reason.

Every operation writes an `audit_events` row with:

```js
{
  operatorTornId: Number(config.OPERATOR_TORN_ID || 0) || null,
  reason,
  previousState,
  previousValidUntil,
  newState,
  newValidUntil
}
```

No secret/token is included.

- [ ] **Step 5: Add strict route schemas**

```js
const grantSchema = z.object({ tornId:z.number().int().positive(), months:z.number().int().min(1).max(12), reason:z.string().trim().min(3).max(500) }).strict();
const revokeSchema = z.object({ tornId:z.number().int().positive(), reason:z.string().trim().min(3).max(500) }).strict();
const correctSchema = z.object({ tornId:z.number().int().positive(), validUntil:z.string().datetime(), reason:z.string().trim().min(3).max(500) }).strict();
```

- [ ] **Step 6: Test audit behavior and fail-closed registration**

Prove:

```text
ADMIN_API_TOKEN absent => admin routes are not registered (404)
wrong token => 401
unknown Torn ID => 404
bounded grant => state ACTIVE and audit event
revoke => state EXPIRED/revoked and audit event
correction beyond 24 months => 422
```

- [ ] **Step 7: Run server suite and commit**

```bash
npm --prefix server test
git add server/src/security/admin-auth.js server/src/routes/admin-pro.js server/src/db/users.js server/src/db/pro-entitlements.js server/src/app.js server/src/server.js server/test/routes/admin-pro.test.js
git commit -m "feat: add audited Reviver Pro operator controls"
```

---

### Task 8: Add requester preset and Torn sidebar action as pure client modules

**Files:**
- Create: `src/request-preset.js`
- Create: `src/sidebar-action.js`
- Create: `src/pro-client.js`
- Create: `test/request-preset.test.js`
- Create: `test/sidebar-action.test.js`
- Create: `test/pro-client.test.js`

**Interfaces:**
- `validatePreset(input) -> {ok:boolean,preset?:{paymentMethod,offerAmount,comment},error?:string}`.
- `deriveSidebarState({sessionToken,preset,submitting,activeRequest,lastError}) -> 'READY'|'SETUP_REQUIRED'|'SUBMITTING'|'ACTIVE'|'ERROR'`.
- `createSidebarController({document,window,label,onActivate,getState}) -> {reconcile,destroy,setState}`.
- `createProClient({baseUrl,getToken,request,clientVersion,releaseChannel}) -> {getStatus,startTrial,getPlans,createInvoice,getInvoice}`.

- [ ] **Step 1: Write preset RED tests**

```js
test('cash preset enforces existing minimum and bounded optional message', () => {
  assert.deepEqual(validatePreset({ paymentMethod:'cash', offerAmount:500000, comment:' Please revive ' }), {
    ok:true,
    preset:{ paymentMethod:'cash', offerAmount:500000, comment:'Please revive' }
  });
  assert.equal(validatePreset({ paymentMethod:'cash', offerAmount:499999 }).ok, false);
});

test('xanax preset requires positive whole quantity', () => {
  assert.equal(validatePreset({ paymentMethod:'xanax', offerAmount:1 }).ok, true);
  assert.equal(validatePreset({ paymentMethod:'xanax', offerAmount:1.5 }).ok, false);
});
```

- [ ] **Step 2: Implement minimal preset module and verify GREEN**

Match server rules: cash min 500000, Xanax min 1, safe integer, comment max 500.

- [ ] **Step 3: Write sidebar RED tests using a minimal fake DOM**

Prove:

```js
controller.reconcile();
controller.reconcile();
assert.equal(document.querySelectorAll('[data-reviverelay-sidebar-action]').length, 1);
assert.equal(action.getAttribute('aria-label'), 'ReviveRelay → Revive Me!');
```

Then remove/rebuild the simulated Torn nav and call `reconcile()` again; exactly one action must reappear.

- [ ] **Step 4: Implement bounded sidebar controller**

The controller must search only Torn navigation/sidebar containers, never chat roots. It creates one namespaced element:

```html
<button data-reviverelay-sidebar-action="1" aria-label="ReviveRelay → Revive Me!">
  <span data-rr-sidebar-icon>✚</span>
  <span data-rr-sidebar-label>ReviveRelay → Revive Me!</span>
</button>
```

Use styling that inherits/sidebar-compatible classes where safe, plus namespaced fallback CSS. The observer watches only sidebar/nav subtree changes and calls debounced reconciliation; it does not inspect message content.

- [ ] **Step 5: Write and run Pro-client RED tests**

Assert exact routes/auth headers:

```js
await client.getStatus();
await client.startTrial();
await client.getPlans();
await client.createInvoice({ planId:'monthly', currency:'xanax' });
await client.getInvoice(invoiceId);
```

No method accepts price, months, `pro:true`, `certified:true`, or Torn ID.

Run:

```bash
node --test test/pro-client.test.js
```

Expected: module-not-found RED.

- [ ] **Step 6: Implement Pro client using the proven GM transport adapter contract**

The module receives an already-created request transport. It sends ReviveRelay bearer/version/channel headers and only the strict route payloads above. It never contains the receiving-account credential.

- [ ] **Step 7: Run all pure-module tests**

```bash
node --test test/request-preset.test.js test/sidebar-action.test.js test/pro-client.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/request-preset.js src/sidebar-action.js src/pro-client.js test/request-preset.test.js test/sidebar-action.test.js test/pro-client.test.js
git commit -m "feat: add direct requester and Pro client modules"
```

---

### Task 9: Add Pro API client and rebuild the main userscript as direct-only

**Files:**
- Create: `test/pro-ui.test.js`
- Create: `test/direct-request-ui.test.js`
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `test/panel-ui.test.js`
- Modify: `test/requester-ui.test.js`
- Modify: `test/reviver-marketplace-ui.test.js`
- Modify: `test/live-capture.test.js`
- Modify: `test/autosync.test.js`
- Modify: `test/client-privacy.test.js`

**Interfaces:**
- Consumes `ReviveRelayProClient.createProClient(...)` from Task 8.
- Main runtime uses existing locked `ReviveRelayApiClient` for request/transaction methods and `ReviveRelayProClient` only for Pro endpoints.

- [ ] **Step 1: Write direct-runtime RED tests before rewriting main**

Require source/build to contain:

```text
ReviveRelay → Revive Me!
Revive Me preset
CERTIFIED REQUEST
Start 7-day Reviver Pro trial
10 Xanax
$10,000,000
55 Xanax
$55,000,000
100 Xanax
$100,000,000
```

Require absence from the main runtime source of:

```text
Shared public chat requests
Live Capture
Rescan public chats
candidateOutbox
discoverChats(
attachObserver(
handlePublicMessage(
/v1/candidates
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/pro-ui.test.js test/direct-request-ui.test.js test/client-privacy.test.js
```

Expected: FAIL against current chat-oriented main script.

- [ ] **Step 3: Replace chat runtime with direct-only state**

The new main state keeps only:

```js
{
  api,
  proApi,
  telemetry,
  updateManager,
  sessionToken,
  identity,
  preset,
  activeRequest,
  activeTransaction,
  verificationCredential,
  reviverQueue,
  proStatus,
  proPlans,
  currentInvoice,
  submittingRequest,
  sidebarController,
  minimized,
  panelPosition,
  panelTab
}
```

There is no chat observer, seen-node set, candidate queue, candidate feed, Live Capture, or chat statistics.

- [ ] **Step 4: Implement saved preset/settings UI**

Persist only:

```js
reviverelay_request_preset = { paymentMethod, offerAmount, comment }
```

Never persist API keys or receiving-account data.

- [ ] **Step 5: Implement one-click sidebar request**

Pseudo-flow in production code:

```js
async function requestReviveFromSidebar() {
  const validation = RequestPreset.validatePreset(state.preset);
  if (!state.sessionToken || !validation.ok || state.submittingRequest || state.activeRequest) {
    openSettingsOrRequestTab();
    return;
  }
  state.submittingRequest = true;
  refreshSidebar();
  try {
    const result = await state.api.createRequest(validation.preset);
    state.activeRequest = result.request || null;
    setStatus('Certified revive request created.');
  } catch (error) {
    reportClientError(error, 'request.sidebar.create');
    setStatus(`Request failed: ${error.code || 'REQUEST_FAILED'}`, true);
  } finally {
    state.submittingRequest = false;
    refreshSidebar();
    renderRequestState();
  }
}
```

The button must not call Torn API or post chat.

- [ ] **Step 6: Implement Free/Pro UI separation**

Free Settings/Request shows preset and trial/upgrade card. Reviver tab:

- Free: Pro paywall/status, no queue request performed.
- Trial/Active: queue refresh allowed.
- Eligible-but-not-registered Pro with reviver credential: registration action.

Certified queue cards show `★`, `CERTIFIED REQUEST`, requester name/ID, comment, offer, age, Accept.

- [ ] **Step 7: Implement invoice UI without trusting client prices**

Render prices from `GET /v1/pro/plans`, then submit only plan ID/currency. Pending invoice shows receiver Torn ID/name only if the server explicitly includes safe receiver display data; never show/store receiver API key.

Poll the invoice endpoint at a modest interval (for example 15 seconds) while the panel is open/visible; server worker remains authoritative.

- [ ] **Step 8: Add Pro-only queue notifications backed by the server queue**

Add `@grant GM_notification`. While Pro state is `TRIAL` or `ACTIVE`, poll `/v1/reviver/queue` every 10 seconds through the existing authenticated API client. Keep a bounded local set of at most 200 seen request IDs; when a new certified request appears, issue one notification containing requester name and offer but no private credentials or raw server payload.

Notification behavior is disabled for Free/Expired states and stops immediately when Pro status becomes inactive. Clicking a notification opens/focuses the Reviver tab; it does not auto-accept.

Tests prove one notification per new request ID, no notification replay after reload for stored IDs, and zero queue polling/notifications for Free users.

- [ ] **Step 9: Retire stale chat-oriented client tests**

Delete or rewrite tests whose purpose is solely chat collection (`live-capture`, candidate/autosync runtime assertions). Keep pure legacy module tests only if those modules remain in repository history, but do not require them in the production bundle.

- [ ] **Step 10: Run complete client suite and build syntax checks**

```bash
npm run test:client
node --check dist/reviverelay-manual.user.js
node --check dist/reviverelay-auto.user.js
```

Expected: all green and no forbidden chat module markers in built artifacts.

- [ ] **Step 11: Commit the direct-only main runtime once fully green**

```bash
git add scripts src test torn-revive-chat-collector.user.js
git commit -m "feat: replace chat collector with direct ReviveRelay runtime"
```

---

### Task 10: Build a direct-only client bundle with no chat modules

**Files:**
- Create: `scripts/client-modules.js`
- Create: `test/direct-only-build.test.js`
- Modify: `scripts/build.js`
- Modify: `scripts/release-client.js`
- Modify: `test/release-build.test.js`
- Modify: `test/release-client.test.js`
- Modify: `test/release-dependency-verification.test.js`

**Interfaces:**
- Produces `DIRECT_SUPPORT_MODULES` consumed identically by build/release verification.
- Final direct-only bundle excludes `src/chat-dom.js`, `src/public-channels.js`, `src/client-chat-policy.js`, `src/revive-classifier.js`, `src/candidate-pipeline.js`.

- [ ] **Step 1: Write direct-only bundle RED test**

```js
const FORBIDDEN = [
  'src/chat-dom.js',
  'src/public-channels.js',
  'src/client-chat-policy.js',
  'src/revive-classifier.js',
  'src/candidate-pipeline.js'
];

test('0.5.0 production bundle contains no chat collection modules', () => {
  const built = fs.readFileSync('dist/reviverelay-manual.user.js', 'utf8');
  for (const module of FORBIDDEN) {
    assert.doesNotMatch(built, new RegExp(`ReviveRelay bundled module: ${module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  assert.doesNotMatch(built, /MutationObserver[^]*chat|\/v1\/candidates|Shared public chat requests|WebSocket\s*=/);
});
```

- [ ] **Step 2: Verify RED against current 0.4.6 build**

```bash
npm run build
node --test test/direct-only-build.test.js
```

Expected: FAIL because current build embeds chat modules.

- [ ] **Step 3: Create one canonical module inventory**

Initial direct list:

```js
const DIRECT_SUPPORT_MODULES = Object.freeze([
  'src/core.js',
  'src/api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  'src/sidebar-action.js',
  'src/pro-client.js'
]);
module.exports = { DIRECT_SUPPORT_MODULES };
```

All direct modules already exist from Tasks 8-9, so switching the inventory must finish GREEN in this task.

- [ ] **Step 4: Modify build and release verification to consume the same list**

Both scripts import:

```js
const { DIRECT_SUPPORT_MODULES } = require('./client-modules');
```

Remove duplicate hardcoded support lists.

- [ ] **Step 5: Update release tests to verify direct inventory, not the historic ten-module list**

Keep Control-B fixture/hash tests separate so the old proof remains immutable.

- [ ] **Step 6: Run the complete client suite and release checks**

```bash
npm run test:client
npm run build
node --check dist/reviverelay-manual.user.js
node --check dist/reviverelay-auto.user.js
```

Expected: PASS and direct-only bundle test confirms the five legacy chat modules are absent from both artifacts.

- [ ] **Step 7: Commit**

```bash
git add scripts test/release-build.test.js test/release-client.test.js test/release-dependency-verification.test.js test/direct-only-build.test.js
git commit -m "build: ship ReviveRelay direct-only module bundle"
```

---

### Task 11: Complete Pro invoice/status UI and end-to-end authorization tests

**Files:**
- Modify: `test/pro-ui.test.js`
- Modify: `server/test/routes/pro.test.js`
- Modify: `server/test/routes/pro-gating.test.js`
- Modify: `server/test/stage1-smoke.test.js`
- Create: `server/test/direct-pro-smoke.test.js`

**Interfaces:**
- Produces one end-to-end server smoke flow from identity/session -> free request -> Pro trial -> queue/accept gating -> invoice/payment activation using fake Torn evidence.

- [ ] **Step 1: Write one comprehensive server smoke test**

Sequence:

```text
bind requester identity
create direct request without requester transaction key
assert origin=reviverelay_direct/certified=true in queue projection
free reviver queue -> REVIVER_PRO_REQUIRED
start reviver trial
bind/register required reviver verification credential fixture
queue now accessible
accept request
create monthly cash invoice for another user -> expected $10m
feed matching receiver log through subscription scan
assert invoice PAID and Pro ACTIVE with one-month extension
rerun scan -> expiry unchanged
```

- [ ] **Step 2: Verify RED where integration wiring is incomplete**

```bash
node --test server/test/direct-pro-smoke.test.js
```

- [ ] **Step 3: Implement only missing wiring discovered by the smoke test**

Do not relax authorization assertions to make the smoke test pass. The server remains the authority for Pro/certification/price.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: client and server suites pass.

- [ ] **Step 5: Commit**

```bash
git add test server/test server/src
git commit -m "test: cover direct ReviveRelay Pro marketplace end to end"
```

---

### Task 12: Release/privacy verification for 0.5.0 diagnostic build

**Files:**
- Modify: `deploy/publish-client-release.sh` only if current script cannot publish a named diagnostic without touching current channel.
- Create: `docs/reviverelay-0.5.0-acceptance.md`

**Interfaces:**
- Produces immutable diagnostic `reviverelay-0.5.0-direct-pro.user.js` without changing automatic production channel.

- [ ] **Step 1: Run fresh verification-before-release commands**

```bash
npm test
npm run build
node --check dist/reviverelay-manual.user.js
node --check dist/reviverelay-auto.user.js
git diff --check
```

- [ ] **Step 2: Run privacy negative scans on the built artifact**

```bash
! grep -E 'Shared public chat requests|Live Capture|Rescan public chats|/v1/candidates|TornReviveChatDom|TornReviveClassifier|WebSocket' dist/reviverelay-manual.user.js
! grep -E 'PRO_RECEIVER_API_KEY|receiverApiKey|Authorization: ApiKey' dist/reviverelay-manual.user.js
```

Expected: both commands succeed with no forbidden matches.

- [ ] **Step 3: Record exact provenance**

```bash
git rev-parse HEAD
sha256sum dist/reviverelay-manual.user.js
head -n 25 dist/reviverelay-manual.user.js
```

The generated `ReviveRelay-Build-Commit` must equal HEAD and `@version` must be `0.5.0`.

- [ ] **Step 4: Commit acceptance checklist**

`docs/reviverelay-0.5.0-acceptance.md` contains these unchecked real-browser gates:

```markdown
- [ ] Panel appears in Torn/Tampermonkey.
- [ ] Sidebar shows `ReviveRelay → Revive Me!`.
- [ ] Sidebar survives Torn navigation and does not duplicate.
- [ ] Free requester can save Cash/Xanax preset.
- [ ] One click creates exactly one certified request.
- [ ] No chat needs to be open.
- [ ] Second Pro/trial reviver sees ★ CERTIFIED REQUEST.
- [ ] Free account cannot use reviver queue.
- [ ] 7-day trial unlocks reviver queue.
- [ ] Request cancellation/state transitions work.
- [ ] No public chat collection is observed.
- [ ] Paid invoice/payment acceptance completed after paid tier is enabled.
```

- [ ] **Step 5: Commit**

```bash
git add docs/reviverelay-0.5.0-acceptance.md
git commit -m "docs: add ReviveRelay 0.5.0 acceptance gate"
```

---

### Task 13: Deploy server code safely with paid tier still disabled

**Files:**
- Runtime only; no source file mutation required.

**Interfaces:**
- Produces migrated/restarted server that supports direct requests/Pro endpoints while `PAID_TIER_ENABLED=false` prevents real subscription invoices.

- [ ] **Step 1: Create verified isolated backups**

```bash
sh deploy/backup.sh
mkdir -p /srv/voidsmith/torn-platform/reviverelay/backups/app
tar -C /srv/voidsmith/torn-platform/reviverelay -czf \
  /srv/voidsmith/torn-platform/reviverelay/backups/app/reviverelay-pre-0.5.0-$(date -u +%Y%m%dT%H%M%SZ).tar.gz app
```

- [ ] **Step 2: Synchronize tested server source only**

From the verified implementation worktree:

```bash
rsync -a --delete --exclude node_modules server/ \
  /srv/voidsmith/torn-platform/reviverelay/app/server/
```

- [ ] **Step 3: Confirm runtime paid tier remains disabled before migration/restart**

```bash
grep '^PAID_TIER_ENABLED=' /srv/voidsmith/shared/secrets/reviverelay/runtime.env
```

Expected: `PAID_TIER_ENABLED=false`.

- [ ] **Step 4: Run migrations before restarting API/worker**

```bash
docker exec reviverelay-reviverelay-api-1 node src/db/migrate.js
```

- [ ] **Step 5: Restart API and worker explicitly**

```bash
docker restart reviverelay-reviverelay-api-1 reviverelay-reviverelay-worker-1
```

- [ ] **Step 6: Verify health/isolation**

```bash
curl -fsS http://127.0.0.1:18730/health
curl -fsS https://reviverelay.voidsmithindustries.com/health
ss -lntp | grep -E ':18730|:5432' || true
docker inspect reviverelay-reviverelay-db-1 --format '{{json .NetworkSettings.Ports}}'
```

Expected: health `{"ok":true}`, API bound as before, PostgreSQL has no public host port.

- [ ] **Step 7: Verify paid invoice route fails closed while disabled**

Using a test session in the automated server suite or safe authenticated smoke mechanism, expect `503 PAID_TIER_DISABLED`; do not fabricate a production user token.

---

### Task 14: Publish 0.5.0 diagnostic and stop for Free/direct real-browser acceptance

**Files:**
- Runtime diagnostic release/Caddy only.

**Interfaces:**
- Produces public no-store diagnostic URL without changing `/install/*` current automatic release.

- [ ] **Step 1: Copy the exact tested manual artifact**

```bash
install -m 0644 dist/reviverelay-manual.user.js \
  /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.5.0-direct-pro.user.js
sha256sum dist/reviverelay-manual.user.js \
  /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.5.0-direct-pro.user.js
```

Hashes must match.

- [ ] **Step 2: Add an explicit Caddy no-store diagnostic route**

Route only:

```text
/diagnostic/reviverelay-0.5.0-direct-pro.user.js
```

to the diagnostic release file with `Cache-Control: no-store`. Back up `/etc/caddy/Caddyfile`, run `caddy validate`, then reload.

- [ ] **Step 3: Fetch public artifact and compare hash**

```bash
curl -fsS https://reviverelay.voidsmithindustries.com/diagnostic/reviverelay-0.5.0-direct-pro.user.js -o /tmp/reviverelay-0.5.0-direct-pro.user.js
sha256sum dist/reviverelay-manual.user.js /tmp/reviverelay-0.5.0-direct-pro.user.js
curl -I https://reviverelay.voidsmithindustries.com/diagnostic/reviverelay-0.5.0-direct-pro.user.js
```

Expected: equal hashes, HTTP 200, `Cache-Control: no-store`.

- [ ] **Step 4: STOP for user browser confirmation**

Required user evidence before paid-tier enablement:

```text
PANEL APPEARS: YES
SIDEBAR BUTTON APPEARS: YES
SIDEBAR SURVIVES NAVIGATION: YES
PRESET SAVES: YES
ONE-CLICK REQUEST WORKS: YES
CERTIFIED REQUEST APPEARS TO REVIVER: YES
NO CHAT LISTENING OBSERVED: YES
FREE USER PRO GATE WORKS: YES
TRIAL UNLOCKS REVIVER: YES
```

Do not claim these passed until the user reports them.

---

### Task 15: Provision the designated receiving account and enable real Pro billing

**Files:**
- Runtime secret only: `/srv/voidsmith/shared/secrets/reviverelay/runtime.env`

**Interfaces:**
- Consumes externally supplied designated receiving Torn ID and restricted receiving-account API key.
- Produces live `PAID_TIER_ENABLED=true` billing scan.

- [ ] **Step 1: Verify the provided receiving credential with a one-time server-side capability check**

Use the existing Torn client/key-info/log metadata code in a temporary operator script that prints only:

```text
receiverTornId=$VERIFIED_PRO_RECEIVER_TORN_ID
moneyIncoming=true|false
itemsIncoming=true|false
```

Never print the key.

Required: owner Torn ID equals configured receiver ID and incoming money/items are available; reject broader/unapproved credentials according to the billing-key validation implemented in Task 6.

- [ ] **Step 2: Write runtime secret values with restrictive permissions**

Set:

```text
PAID_TIER_ENABLED=true
PRO_RECEIVER_TORN_ID=$VERIFIED_PRO_RECEIVER_TORN_ID
PRO_RECEIVER_API_KEY=$VERIFIED_PRO_RECEIVER_API_KEY
```

Before editing the runtime file, require the operator environment variables with `test -n "${VERIFIED_PRO_RECEIVER_TORN_ID:-}"` and `test -n "${VERIFIED_PRO_RECEIVER_API_KEY:-}"`. Write them through a root-only script with `umask 077`; never echo the key, add it to shell history, or commit it to Git.

- [ ] **Step 3: Restart API/worker and verify billing scan exists**

```bash
docker restart reviverelay-reviverelay-api-1 reviverelay-reviverelay-worker-1
```

Query only non-secret job metadata to confirm one active `subscription.scan:reviver-pro` job exists.

- [ ] **Step 4: Execute one real low-risk paid acceptance using an approved launch plan**

Create either a monthly Xanax or monthly cash invoice from a verified test purchaser, send the exact amount to the designated receiving account, then verify:

```text
invoice state = PAID
matched Torn log ID stored once
Pro state = ACTIVE
validUntil extended by one calendar month
second scan does not extend again
```

Do not use a fabricated Torn payment or synthetic production log for this gate.

- [ ] **Step 5: STOP for user confirmation of paid acceptance**

Required:

```text
PRO INVOICE CREATED: YES
TORN PAYMENT MATCHED: YES
PRO ACTIVATED: YES
DUPLICATE SCAN SAFE: YES
```

---

### Task 16: Final verification, Source-of-Truth update, and optional production-channel promotion

**Files:**
- Modify Source-of-Truth only with facts verified in Tasks 12-14.
- Production client release only after explicit user approval.

**Interfaces:**
- Produces a fully verified direct-only ReviveRelay release and an operator record of the exact build/runtime state.

- [ ] **Step 1: Run final source verification from the implementation worktree**

```bash
npm test
npm run build
node --check dist/reviverelay-manual.user.js
node --check dist/reviverelay-auto.user.js
git diff --check
git status --short
```

Expected: all tests pass, syntax clean, no unexpected working-tree changes.

- [ ] **Step 2: Re-run privacy/build negative scans**

```bash
! grep -E 'Shared public chat requests|Live Capture|Rescan public chats|/v1/candidates|TornReviveChatDom|TornReviveClassifier|WebSocket' dist/reviverelay-manual.user.js
! grep -R -E 'PRO_RECEIVER_API_KEY=[^[:space:]]+' . --exclude-dir=.git --exclude='*.example'
```

- [ ] **Step 3: Verify runtime**

Record:

```text
API health
worker running
DB not publicly exposed
PAID_TIER_ENABLED actual state
0.5.0 public diagnostic SHA
implementation Git commit
browser acceptance result
paid acceptance result
```

- [ ] **Step 4: Update Voidsmith Source of Truth with verified facts only**

Document that ReviveRelay is direct-only, chat listening removed, Pro launch prices, receiver-secret location (path only, never value), diagnostic/release commit/hash, and paid-tier enabled state.

- [ ] **Step 5: Ask for explicit production promotion approval**

Do not modify the automatic `/install/*` current release before the user explicitly approves promotion after both browser gates.

- [ ] **Step 6: If approved, publish the exact already-tested artifact and verify hash after promotion**

Use the existing release script/current symlink procedure, then fetch `/install/reviverelay-manual.user.js` and `/install/reviverelay-auto.user.js` and compare against the release manifest hashes.

- [ ] **Step 7: Commit final documentation only after all verified facts are recorded**

```bash
git add docs
 git commit -m "docs: record ReviveRelay direct Pro release verification"
```

