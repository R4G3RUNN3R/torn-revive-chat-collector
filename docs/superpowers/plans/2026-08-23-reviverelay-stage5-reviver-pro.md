# ReviveRelay Stage 5 Reviver Pro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Reviver Pro entitlement with a 7-day trial and verified Xanax subscriptions while keeping all requester functionality free and preserving equal queue access among subscribed revivers.

**Architecture:** Subscription entitlement is a server-side property of the reviver's Torn ID. A reviver creates a pending subscription purchase before sending Xanax to the configured operator account; the worker verifies the matching incoming transfer through the operator's minimally scoped Torn API key and credits time idempotently. Paid marketplace access remains disabled globally until the launch compliance flag is cleared.

**Tech Stack:** Existing backend/worker/Torn adapter, PostgreSQL subscriptions, ReviveRelay userscript subscription UI.

**Spec:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

## Global Constraints

- Requester functionality remains free.
- Reviver Pro trial is exactly 7 days once per Torn player ID.
- 2 Xanax = 30 days.
- 20 Xanax = 365 days.
- Positive multiples of 20 use annual pricing first: 40 = 730, 60 = 1095, etc.
- Other positive even quantities use monthly pricing: 4 = 60, 6 = 90, etc.
- Unsupported quantities are not silently credited.
- Early renewal stacks from later of current expiry or verified payment time.
- No per-job commission and no paid queue priority.
- Operator API key lives only in server secrets and is never exposed to client/Sheets.
- Paid gating defaults disabled until compliance gate is cleared.

---

### Task 1: Implement subscription duration rules as a pure function

**Files:**
- Create: `server/src/domain/subscription.js`
- Create: `server/test/domain/subscription.test.js`

**Interfaces:**
- `creditDaysForXanax(quantity) -> number | null`
- `extendExpiry({ currentExpiry, verifiedAt, creditedDays }) -> Date`

- [ ] **Step 1: Write failing pricing tests**

```js
assert.equal(creditDaysForXanax(2), 30);
assert.equal(creditDaysForXanax(4), 60);
assert.equal(creditDaysForXanax(20), 365);
assert.equal(creditDaysForXanax(40), 730);
assert.equal(creditDaysForXanax(60), 1095);
assert.equal(creditDaysForXanax(3), null);
assert.equal(creditDaysForXanax(1), null);
```

Also test annual priority at 20/40 and early renewal stacking.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement exact rules**

```js
function creditDaysForXanax(q) {
  if (!Number.isInteger(q) || q <= 0) return null;
  if (q % 20 === 0) return 365 * (q / 20);
  if (q % 2 === 0) return 30 * (q / 2);
  return null;
}
```

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/domain/subscription.test.js
git add server/src/domain/subscription.js server/test/domain/subscription.test.js
git commit -m "feat(pro): encode Reviver Pro Xanax pricing"
```

---

### Task 2: Add one-time 7-day trial entitlement

**Files:**
- Modify: `server/src/db/reputation.js` or create `server/src/db/revivers.js`
- Create: `server/src/routes/revivers.js`
- Create: `server/test/routes/reviver-registration.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- `POST /v1/revivers/register`
- response includes `{ trialStartedAt, proUntil, standing }`.

- [ ] **Step 1: Write tests**

First registration starts exactly 7 days. Re-registering same Torn ID after expiry does not grant a second trial. Reinstall/new session does not reset trial.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement registration**

Persist `trial_started_at` once. Initial `pro_until = trial_started_at + interval '7 days'` unless a longer existing subscription already exists.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/routes/reviver-registration.test.js
git add server/src/db server/src/routes/revivers.js server/test/routes/reviver-registration.test.js server/src/app.js
git commit -m "feat(pro): grant one-time seven-day reviver trial"
```

---

### Task 3: Create pending subscription purchase intent

**Files:**
- Create: `server/src/db/migrations/004_subscription_intents.sql`
- Create: `server/src/db/subscriptions.js`
- Create: `server/src/routes/subscriptions.js`
- Create: `server/test/routes/subscriptions.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- `POST /v1/subscriptions/intents` body `{ xanaxQuantity }`
- `GET /v1/subscriptions/me`
- response intent: `{ id, xanaxQuantity, creditedDays, operatorTornId, expiresAt }`.

- [ ] **Step 1: Write tests**

Supported quantities create intent valid for 15 minutes. Unsupported quantities return 422. Intent requester is derived from authenticated Torn ID, not body.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Add table and route**

`subscription_intents` stores reviver ID, expected quantity, credited days, created/expiry/fulfilled/cancelled timestamps. One open intent per reviver; creating another supersedes the unfulfilled old intent.

This intent is crucial: random 2/20-Xanax gifts to the operator are not automatically treated as ReviveRelay payments unless a matching live intent exists.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/routes/subscriptions.test.js
git add server/src/db/migrations/004_subscription_intents.sql server/src/db/subscriptions.js server/src/routes/subscriptions.js server/test/routes/subscriptions.test.js server/src/app.js
git commit -m "feat(pro): create explicit subscription payment intents"
```

---

### Task 4: Verify operator incoming Xanax and credit subscription idempotently

**Files:**
- Create: `server/src/worker/handlers/subscription-scan.js`
- Create: `server/test/worker/subscription-scan.test.js`
- Modify: `server/src/torn/client.js`

**Interfaces:**
- Operator key supplied from config; worker finds incoming Xanax transfers to operator matching sender Torn ID, quantity, and intent time window.

- [ ] **Step 1: Write worker tests**

Matching 2 Xanax intent -> +30 days. 20 -> +365. 40 -> +730. Same Torn evidence ID processed twice credits once. Transfer without an intent is ignored for automatic credit. Wrong sender/quantity ignored.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement evidence matching**

Record source transfer evidence ID in `subscriptions` with unique constraint. In one transaction: mark intent fulfilled, calculate start/expiry, insert subscription credit, update `revivers.pro_until`, append audit event.

- [ ] **Step 4: Handle API outage/rate limiting**

Retry job with backoff; never expire an intent as unpaid solely because Torn API is unavailable. If intent wall-clock expires during outage, keep it in reconciliation until a successful scan covers the full intent interval.

- [ ] **Step 5: Run/commit**

```bash
node --test server/test/worker/subscription-scan.test.js
git add server/src/worker/handlers/subscription-scan.js server/test/worker/subscription-scan.test.js server/src/torn/client.js
git commit -m "feat(pro): verify Xanax subscription payments"
```

---

### Task 5: Enforce Reviver Pro entitlement on earning features

**Files:**
- Create: `server/src/security/entitlements.js`
- Create: `server/test/security/entitlements.test.js`
- Modify: `server/src/routes/reviver-queue.js`
- Modify: `server/src/routes/requests.js`

**Interfaces:**
- `hasReviverPro({ proUntil, standing, paidTierEnabled, now }) -> boolean/result`

- [ ] **Step 1: Write tests**

Active trial/subscription + ACTIVE standing -> allowed when paid tier enabled. Expired -> 402/403 typed `REVIVER_PRO_REQUIRED`. Suspended/banned -> standing error even if paid. Requester routes remain free.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Gate queue/Accept/pro lead endpoints**

No paid queue priority. All entitled revivers query the same canonical queue.

- [ ] **Step 4: Preserve requester reputation visibility**

Requester can see accepted reviver's public reputation regardless of requester subscription and regardless of whether reviver is currently near expiry.

- [ ] **Step 5: Run/commit**

```bash
node --test server/test/security/entitlements.test.js
git add server/src/security/entitlements.js server/test/security/entitlements.test.js server/src/routes
git commit -m "feat(pro): gate reviver earning tools"
```

---

### Task 6: Add subscription UI and payment instructions

**Files:**
- Create: `src/subscription-ui.js`
- Create: `test/subscription-ui.test.js`
- Modify: `src/api-client.js`
- Modify: `torn-revive-chat-collector.user.js`

**Interfaces:**
- View shows trial/pro expiry, Monthly `2 Xanax / 30 days`, Yearly `20 Xanax / 365 days`, and custom annual multiples via quantity input validated against server-supported rules.

- [ ] **Step 1: Write UI model tests**

7-day trial label; expired state; 2/20 plan labels; 40 Xanax preview says 730 days; unsupported 3 Xanax rejected before intent call.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement payment flow**

User chooses quantity -> create intent -> UI shows exact operator Torn ID/profile link, quantity, 15-minute intent window, and `Check payment` action. Do not automate item transfer; player performs Torn transfer manually.

- [ ] **Step 4: Poll subscription state from ReviveRelay backend**

After server verifies transfer, show new expiry and re-enable marketplace controls.

- [ ] **Step 5: Run/commit**

```bash
node --test test/subscription-ui.test.js
git add src/subscription-ui.js test/subscription-ui.test.js src/api-client.js torn-revive-chat-collector.user.js
git commit -m "feat(ui): add Reviver Pro subscription flow"
```

---

### Task 7: Add global paid-tier compliance kill switch

**Files:**
- Modify: `server/src/config.js`
- Modify: `server/src/security/entitlements.js`
- Create: `server/test/security/paid-tier-switch.test.js`
- Modify: `deploy/.env.example`
- Modify: `deploy/README.md`

**Interfaces:** `PAID_TIER_ENABLED=false` default.

- [ ] **Step 1: Write tests**

When false, paid subscription purchase endpoints return `PAID_TIER_NOT_ENABLED`; existing requester/free collector features remain usable; no paid charge can be automatically credited as a purchase initiated after disablement.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement switch**

Document operator must set true only after recording required Torn approval/clarification.

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/security/paid-tier-switch.test.js
git add server/src/config.js server/src/security/entitlements.js server/test/security/paid-tier-switch.test.js deploy
git commit -m "feat(compliance): gate Reviver Pro launch"
```

---

### Task 8: Add Greasy Fork/public disclosure metadata

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `README.md`
- Create: `docs/PRIVACY.md`
- Create: `docs/REVIVER-PRO.md`
- Modify: `test/metadata.test.js`

**Interfaces:** Public documentation names all server communication and paid feature behavior.

- [ ] **Step 1: Extend metadata tests**

Require appropriate Greasy Fork payment/tracking antifeature declarations when publishing paid/networked build and link disclosure docs in README.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Write disclosure docs**

`PRIVACY.md` states public-only local classification and explicit Faction/Company/private exclusion, stored identity/transaction/reputation data, API-key handling, retention/admin access. `REVIVER-PRO.md` states requester free tier, 7-day trial, 2/30 and 20/365 pricing, annual multiples, no commission/priority, and operator identity/payment instructions supplied dynamically.

- [ ] **Step 4: Run/commit**

```bash
npm test
npm run build
git add torn-revive-chat-collector.user.js README.md docs/PRIVACY.md docs/REVIVER-PRO.md test/metadata.test.js
git commit -m "docs: disclose ReviveRelay privacy and paid features"
```

---

### Task 9: Add subscription information to private Sheets mirror

**Files:**
- Modify: `server/src/db/mirror.js`
- Modify: `server/src/worker/handlers/sheets-mirror.js`
- Modify: `google-apps-script/Code.gs`
- Modify: `server/test/worker/sheets-mirror.test.js`

**Interfaces:** `Subscriptions` tab summary fields: Torn ID, current name, trial start, Pro expiry, last credited quantity/days/date, standing. No operator/API secrets.

- [ ] **Step 1: Write sanitized mirror test**

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement sanitized subscription mirror**

- [ ] **Step 4: Run/commit**

```bash
node --test server/test/worker/sheets-mirror.test.js
git add server/src/db/mirror.js server/src/worker/handlers/sheets-mirror.js google-apps-script/Code.gs server/test/worker/sheets-mirror.test.js
git commit -m "feat(mirror): include Reviver Pro admin summaries"
```

---

### Task 10: Stage 5 end-to-end subscription and free-tier regression

**Files:**
- Create: `server/test/e2e/subscription-flow.test.js`
- Create: `test/free-requester-regression.test.js`

- [ ] **Step 1: Test full paid flow**

Register reviver -> 7-day trial -> expire clock -> queue denied -> create 20-Xanax intent -> matching operator transfer -> +365 days -> queue allowed -> 40-Xanax early renewal -> expiry +730 days from existing expiry.

- [ ] **Step 2: Test idempotency/random-gift protection**

Same evidence twice credits once. 2 Xanax transfer with no pending intent does not auto-credit.

- [ ] **Step 3: Test requester remains free**

Requester can onboard, classify/submit candidates, create direct request, see transaction/reputation/report states without Reviver Pro.

- [ ] **Step 4: Test equal queue access**

Two entitled revivers receive same queue ordering/data; no subscription tier/remaining-duration priority exists.

- [ ] **Step 5: Run full repository checks**

```bash
npm test
npm --prefix server test
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/test/e2e/subscription-flow.test.js test/free-requester-regression.test.js
git commit -m "test(stage5): verify Reviver Pro and free requester tier"
```

## Stage 5 completion gate

- Trial cannot reset by reinstall/rebinding.
- Subscription crediting is idempotent and requires an explicit intent.
- 20-Xanax annual rate always beats monthly interpretation; 40/60 scale correctly.
- Operator key never leaves backend secrets.
- Requester functions remain free.
- Queue has no paid priority.
- Paid tier can be globally disabled until launch approval is recorded.
