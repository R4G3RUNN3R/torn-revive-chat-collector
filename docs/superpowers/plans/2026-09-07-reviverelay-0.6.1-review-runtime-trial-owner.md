# ReviveRelay 0.6.1 Review Runtime, Trial Persistence, and Owner Pro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an immutable private ReviveRelay 0.6.1 review build that uses a dedicated review backend, fails closed on incompatible runtime metadata, preserves one-time trial history across reinstall/session/account lifecycle events, and grants indefinite OWNER Pro to the canonical payment recipient R4G3RUNN3R [3877028].

**Architecture:** Stable 0.4.4 continues on `/v1/*` and its existing worker remains untouched. The 0.6.1 userscript talks only to `/review/v1/*`, served by a separate 0.6.1 API process sharing the isolated ReviveRelay PostgreSQL database; review-only subscription payment scanning runs in a dedicated direct loop rather than the shared generic jobs queue so the old stable worker cannot claim review billing jobs. Runtime/entitlement policy is server-authoritative, and the client treats missing/cross-channel metadata as incompatible rather than free.

**Tech Stack:** Node.js 20, Fastify, PostgreSQL 16, Docker Compose, Caddy, Tampermonkey userscript, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-07-reviverelay-0.6.1-review-runtime-trial-owner-design.md`

## Global Constraints

- Release version is exactly `0.6.1`; existing 0.6.0 bytes remain immutable.
- Stable public production remains `0.4.4`; `/v1/*`, stable symlink/manifest, stable API container, and stable worker are not replaced by this plan.
- Review API base is `https://reviverelay.voidsmithindustries.com/review` so client calls resolve to `/review/v1/*`.
- Missing/malformed/cross-channel runtime or subscription metadata never implies `free`; review reviver features fail closed.
- One trial per canonical Torn identity, exactly seven days from the original server timestamp.
- Canonical owner/payment recipient is `R4G3RUNN3R [3877028]`; OWNER has lifetime Pro but still needs normal verification, Torn revive ability, and active reviver registration.
- Merchant receiver credential remains server-only and restricted; no secret values may enter source, logs, artifacts, docs, or tests.
- Review-only billing scan must not use the shared `jobs` queue while the stable 0.4.4 worker remains active.
- All DB-backed tests use disposable PostgreSQL 16, never the production database.
- Final deployment work must first invoke the Voidsmith Source-of-Truth skill and revalidate live paths/ports/configuration.

---

### Task 1: Add explicit 0.6.1 runtime contract

**Files:**
- Create: `server/src/domain/runtime-contract.js`
- Modify: `server/src/config.js`
- Modify: `server/src/routes/me.js`
- Modify: `server/src/routes/pro.js`
- Test: `server/test/domain/runtime-contract.test.js`
- Test: `server/test/routes/me.test.js`
- Test: `server/test/routes/pro.test.js`

**Interfaces:**
- Produces: `createRuntimeContract({serverVersion, minimumClientVersion, releaseChannel, subscription}) -> {serverVersion, minimumClientVersion, releaseChannel, subscription}`.
- Produces config values `REVIVERELAY_SERVER_VERSION`, `REVIVERELAY_MINIMUM_CLIENT_VERSION`, `REVIVERELAY_RELEASE_CHANNEL` where release channel is `stable|review`.
- `/v1/me` and `/v1/pro/status` return `runtime` plus existing public fields.

- [ ] **Step 1: Write failing runtime-contract tests**

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRuntimeContract}=require('../../src/domain/runtime-contract');

test('review runtime contract is explicit and immutable-safe',()=>{
  const runtime=createRuntimeContract({
    serverVersion:'0.6.1',
    minimumClientVersion:'0.6.1',
    releaseChannel:'review',
    subscription:{mode:'review',paymentsEnabled:true,merchant:{tornId:3877028,name:'R4G3RUNN3R'},plans:[]}
  });
  assert.deepEqual(runtime,{
    serverVersion:'0.6.1',minimumClientVersion:'0.6.1',releaseChannel:'review',
    subscription:{mode:'review',paymentsEnabled:true,merchant:{tornId:3877028,name:'R4G3RUNN3R'},plans:[]}
  });
  assert.throws(()=>createRuntimeContract({serverVersion:'0.6.1',minimumClientVersion:'0.6.1',releaseChannel:'banana',subscription:{mode:'review'}}),/release channel/i);
});
```

Extend route tests to assert authenticated responses include:

```js
runtime: {
  serverVersion:'0.6.1',
  minimumClientVersion:'0.6.1',
  releaseChannel:'review',
  subscription:{ mode:'review', paymentsEnabled:true, merchant:{tornId:3877028,name:'R4G3RUNN3R'}, plans:[
    {id:'monthly',label:'Monthly',months:1,xanax:10,cash:10000000},
    {id:'six_months',label:'6 Months',months:6,xanax:55,cash:55000000},
    {id:'yearly',label:'Yearly',months:12,xanax:100,cash:100000000}
  ] }
}
```

- [ ] **Step 2: Run RED tests**

Run:

```bash
node --test server/test/domain/runtime-contract.test.js server/test/routes/me.test.js server/test/routes/pro.test.js
```

Expected: FAIL because `runtime-contract.js` and runtime response fields do not exist.

- [ ] **Step 3: Implement minimal runtime contract**

Create `server/src/domain/runtime-contract.js` with strict semver text and channel validation:

```js
const CHANNELS=Object.freeze(['stable','review']);
const VERSION=/^\d+\.\d+\.\d+$/;
function createRuntimeContract({serverVersion,minimumClientVersion,releaseChannel,subscription}) {
  if(!VERSION.test(String(serverVersion||''))) throw new Error('Invalid server version');
  if(!VERSION.test(String(minimumClientVersion||''))) throw new Error('Invalid minimum client version');
  if(!CHANNELS.includes(releaseChannel)) throw new Error('Invalid release channel');
  if(!subscription || typeof subscription!=='object') throw new Error('subscription is required');
  return Object.freeze({serverVersion,minimumClientVersion,releaseChannel,subscription});
}
module.exports={CHANNELS,createRuntimeContract};
```

Add config schema entries with defaults safe for local tests, and build one contract in `registerMeRoute` / `registerProRoutes` from `publicSubscriptionState()`.

- [ ] **Step 4: Run focused tests GREEN**

```bash
node --test server/test/domain/runtime-contract.test.js server/test/routes/me.test.js server/test/routes/pro.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/runtime-contract.js server/src/config.js server/src/routes/me.js server/src/routes/pro.js server/test/domain/runtime-contract.test.js server/test/routes/me.test.js server/test/routes/pro.test.js
git commit -m "feat: expose explicit ReviveRelay runtime contract"
```

---

### Task 2: Make OWNER a server-derived lifetime Pro state

**Files:**
- Modify: `server/src/domain/subscription-mode.js`
- Modify: `server/src/security/pro-access.js`
- Modify: `server/src/routes/me.js`
- Modify: `server/src/routes/pro.js`
- Test: `server/test/domain/subscription-mode.test.js`
- Test: `server/test/routes/me.test.js`
- Test: `server/test/routes/pro-gating.test.js`
- Test: `server/test/routes/pro.test.js`

**Interfaces:**
- Produces: `resolvePublicProStatus({status,tornId,subscription})` returning `OWNER` for the configured canonical merchant identity in review/live.
- `hasActivePro()` accepts `TRIAL`, `ACTIVE`, `OWNER` only.
- OWNER public shape: `{state:'OWNER',trialEligible:false,trialStartedAt:null,validUntil:null}`.

- [ ] **Step 1: Write failing OWNER tests**

Add tests proving:

```js
assert.deepEqual(resolvePublicProStatus({
  status:{state:'NONE',trialEligible:true,trialStartedAt:null,validUntil:null},
  tornId:3877028,
  subscription:{mode:'review',merchant:{tornId:3877028,name:'R4G3RUNN3R'}}
}),{state:'OWNER',trialEligible:false,trialStartedAt:null,validUntil:null});
```

Also assert Torn ID `3877029` remains `NONE`, request body/header fields cannot influence owner state, and `hasActivePro({state:'OWNER'}) === true`.

- [ ] **Step 2: Run RED tests**

```bash
node --test server/test/domain/subscription-mode.test.js server/test/routes/me.test.js server/test/routes/pro-gating.test.js server/test/routes/pro.test.js
```

Expected: FAIL because OWNER is not recognized/derived.

- [ ] **Step 3: Implement OWNER resolver**

Keep owner identity tied to canonical merchant config. Do not add an `owner=true` request field. Implement a pure server helper resembling:

```js
function isCanonicalOwner({tornId,subscription}) {
  return subscription && subscription.mode!=='free' &&
    Number(subscription.merchant?.tornId)===PRO_MERCHANT_TORN_ID &&
    Number(tornId)===PRO_MERCHANT_TORN_ID;
}
```

Route status through `resolvePublicProStatus(...)`, and ensure entitlement guards evaluate the authenticated Torn ID plus trusted subscription configuration, not browser state.

- [ ] **Step 4: Verify OWNER cannot bypass reviver safety**

Run existing reviver registration/queue tests plus new cases where OWNER lacks credential/ability/registration:

```bash
node --test server/test/routes/revivers.test.js server/test/routes/reviver-queue.test.js server/test/routes/pro-gating.test.js
```

Expected: OWNER satisfies only Pro entitlement; other gates still reject.

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/subscription-mode.js server/src/security/pro-access.js server/src/routes/me.js server/src/routes/pro.js server/test/domain/subscription-mode.test.js server/test/routes/me.test.js server/test/routes/pro-gating.test.js server/test/routes/pro.test.js
git commit -m "feat: grant canonical merchant lifetime owner Pro"
```

---

### Task 3: Lock trial persistence across reinstall/session/credential/account lifecycle

**Files:**
- Create: `server/test/db/pro-trial-persistence.test.js`
- Characterize existing production files without changing them: `server/src/db/pro-entitlements.js`, `server/src/db/users.js`, `server/src/db/account-deletion.js`

**Interfaces:**
- Existing `createProEntitlementRepository(pool)` remains authoritative.
- Trial timestamps must remain attached to the same canonical `users.id` resolved from unique `users.torn_id`.

- [ ] **Step 1: Add the lifecycle regression test**

The test must execute against one disposable database and perform this exact sequence:

```js
const t0=new Date('2026-09-07T12:00:00Z');
const first=await entitlements.startTrial({userId,now:t0});
assert.equal(first.validUntil.toISOString(),'2026-09-14T12:00:00.000Z');
await pool.query('DELETE FROM sessions WHERE user_id=$1',[userId]);
// bind/replace verification credential for same user, then delete sessions again
await deletion.deleteAccount({userId,now:new Date('2026-09-08T12:00:00Z')});
const rebound=await identities.bindIdentity({
  tornId:910061,
  name:'Same Torn User',
  access:'Custom',
  tokenHash:'reinstall-session-token-hash',
  clientVersion:'0.6.1'
});
assert.equal(rebound.userId,userId);
await assert.rejects(()=>entitlements.startTrial({userId:rebound.userId,now:new Date('2026-09-09T12:00:00Z')}),/TRIAL_ALREADY_USED/);
const expired=await entitlements.getStatus(userId,new Date('2026-09-15T12:00:00Z'));
assert.equal(expired.state,'EXPIRED');
assert.equal(expired.trialStartedAt.toISOString(),'2026-09-07T12:00:00.000Z');
assert.equal(expired.validUntil.toISOString(),'2026-09-14T12:00:00.000Z');
```

Read the raw DB row before and after lifecycle operations and assert `trial_started_at` and `trial_ends_at` are unchanged.

- [ ] **Step 2: Run the characterization test**

```bash
node --test server/test/db/pro-trial-persistence.test.js
```

Expected: if current persistence is correct, PASS. If it fails, stop and fix only the demonstrated persistence defect before proceeding. This task intentionally records an existing security invariant; no production change is required merely to make a new test red.

- [ ] **Step 3: Run related DB regression**

```bash
node --test server/test/db/pro-entitlements.test.js server/test/db/account-deletion.test.js server/test/db/pro-trial-persistence.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit the regression proof**

```bash
git add server/test/db/pro-trial-persistence.test.js
git commit -m "test: lock one-time Pro trial to Torn identity"
```

If this characterization unexpectedly exposes a persistence defect, stop this task, use systematic debugging plus TDD for that demonstrated defect, then add only the production files actually changed to the same focused commit.

---

### Task 4: Make the 0.6.1 review client fail closed and use the review API base

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `src/direct-api-client.js`
- Test: `test/subscription-mode-ui.test.js`
- Test: `test/direct-api-client.test.js`
- Create: `test/review-runtime-compatibility.test.js`

**Interfaces:**
- Userscript review build API base: `https://reviverelay.voidsmithindustries.com/review`.
- Produces pure helper `validateReviewRuntime(runtime,{clientVersion,releaseChannel}) -> {compatible:boolean,reason:string|null,subscription:object|null}`.
- Client runtime state: `state.runtimeCompatibility` with values `unknown|compatible|incompatible`.
- `subscriptionMode()` returns `unknown` when trusted runtime contract is absent/invalid; it never returns `free` as an absence fallback.

- [ ] **Step 1: Write failing client tests**

Assert the source no longer contains:

```js
state.subscription?.mode || 'free'
```

and instead behaves conceptually as:

```js
assert.deepEqual(validateReviewRuntime(null,{clientVersion:'0.6.1',releaseChannel:'review'}),{compatible:false,reason:'RUNTIME_MISSING',subscription:null});
assert.equal(validateReviewRuntime({serverVersion:'0.6.1',minimumClientVersion:'0.6.1',releaseChannel:'stable',subscription:{mode:'free'}},{clientVersion:'0.6.1',releaseChannel:'review'}).compatible,false);
const valid=validateReviewRuntime({serverVersion:'0.6.1',minimumClientVersion:'0.6.1',releaseChannel:'review',subscription:{mode:'review',paymentsEnabled:true,merchant:{tornId:3877028,name:'R4G3RUNN3R'},plans:[]}},{clientVersion:'0.6.1',releaseChannel:'review'});
assert.equal(valid.compatible,true);
assert.equal(valid.subscription.mode,'review');
```

Add a direct client test asserting review requests resolve to:

```text
https://reviverelay.voidsmithindustries.com/review/v1/me
```

- [ ] **Step 2: Run RED tests**

```bash
node --test test/subscription-mode-ui.test.js test/direct-api-client.test.js test/review-runtime-compatibility.test.js
```

Expected: FAIL on free fallback/review-base/runtime compatibility.

- [ ] **Step 3: Implement strict runtime validation**

Add a small pure validator in the userscript or direct client. It must require review channel, known subscription mode, and `clientVersion >= minimumClientVersion` using the existing strict version comparator. `serverVersion` is reported for diagnostics/provenance but is not the operand for the minimum-client gate. Missing data sets `state.runtimeCompatibility='incompatible'` after a completed server response, while initial/no-response stays `unknown`.

Change review client `API_BASE` to:

```js
const API_BASE = 'https://reviverelay.voidsmithindustries.com/review';
```

and gate reviver operations on `runtimeCompatibility === 'compatible'` before entitlement checks.

- [ ] **Step 4: Verify requester-safe and reviver-fail-closed behavior**

```bash
node --test test/requester-ui.test.js test/requester-verification-gate.test.js test/subscription-mode-ui.test.js test/client-hardening.test.js test/review-runtime-compatibility.test.js
```

Expected: requester request creation remains available only after an authenticated compatible server response; reviver queue/registration/trial/invoice/Accept remain disabled when runtime is unknown/incompatible.

- [ ] **Step 5: Commit**

```bash
git add torn-revive-chat-collector.user.js src/direct-api-client.js test/subscription-mode-ui.test.js test/direct-api-client.test.js test/review-runtime-compatibility.test.js
git commit -m "fix: fail closed on incompatible review runtime"
```

---

### Task 5: Render OWNER/Lifetime and hide owner purchase controls

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `test/pro-ui.test.js`
- Modify: `test/subscription-mode-ui.test.js`

**Interfaces:**
- OWNER display text: `Reviver Pro: OWNER`, `Access: Lifetime`, `Payment recipient account`.
- OWNER never renders trial or invoice creation controls.

- [ ] **Step 1: Write failing OWNER UI tests**

Add source/UI assertions that when `state.proStatus.state === 'OWNER'`:

```js
assert.match(rendered,/OWNER/);
assert.match(rendered,/Lifetime/);
assert.doesNotMatch(rendered,/Start 7-day Reviver Pro trial/);
assert.doesNotMatch(rendered,/Create Pro invoice/);
```

Also assert non-owner `TRIAL` and `ACTIVE` rendering remains unchanged.

- [ ] **Step 2: Run RED tests**

```bash
node --test test/pro-ui.test.js test/subscription-mode-ui.test.js
```

Expected: FAIL because OWNER-specific UI does not exist.

- [ ] **Step 3: Implement minimal OWNER UI**

Branch only on server-provided `state.proStatus.state === 'OWNER'`. Do not infer owner from local Torn ID. Render lifetime/no-expiry and suppress purchase/trial controls.

- [ ] **Step 4: Run GREEN tests**

```bash
node --test test/pro-ui.test.js test/subscription-mode-ui.test.js test/privacy-ui.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-revive-chat-collector.user.js test/pro-ui.test.js test/subscription-mode-ui.test.js
git commit -m "feat: render lifetime owner Pro access"
```

---

### Task 6: Add a dedicated review subscription scan process without shared job claims

**Files:**
- Create: `server/src/review-subscription-worker.js`
- Create: `server/test/review-subscription-worker.test.js`

**Interfaces:**
- `runSubscriptionLoop({handler,sleep,signal,logger})` invokes the existing `createSubscriptionScanHandler()` directly and sleeps until the returned `runAt`.
- It never creates or claims rows in `jobs`.
- It validates the merchant credential once before entering the loop.

- [ ] **Step 1: Write failing loop tests**

Use a fake handler and fake sleep:

```js
const calls=[];
const handler=async()=>({status:'reschedule',runAt:new Date('2026-09-07T12:01:00Z')});
await runSubscriptionLoop({handler,sleep:async ms=>{calls.push(ms);signal.stop=true;},signal,clock:()=>new Date('2026-09-07T12:00:00Z')});
assert.deepEqual(calls,[60000]);
```

Add a test whose fake `jobRepository` throws if touched, proving the review subscription process has no shared-job dependency.

- [ ] **Step 2: Run RED test**

```bash
node --test server/test/review-subscription-worker.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the review-only loop**

Reuse `createPool`, `createProInvoiceRepository`, `createTornClient`, `createLogMetadataResolver`, `createProBillingEvidenceService`, and `createSubscriptionScanHandler`. Validate `SUBSCRIPTION_MODE==='review'`, canonical merchant ID, and receiver credential before the first scan. Handle SIGINT/SIGTERM by finishing the current scan and exiting.

- [ ] **Step 4: Run focused worker tests**

```bash
node --test server/test/review-subscription-worker.test.js server/test/worker/subscription-scan.test.js server/test/worker/subscription-mode.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/review-subscription-worker.js server/test/review-subscription-worker.test.js
git commit -m "feat: isolate review subscription scanning"
```

---

### Task 7: Version and build immutable 0.6.1 review artifacts

**Files:**
- Modify: `package.json`
- Modify: `scripts/audit-review-release.js`
- Modify: `test/release-build.test.js`
- Modify: `test/release-pinning.test.js`
- Modify: `test/review-release-smoke.test.js`
- Modify: `test/review-package.test.js`
- Modify: `docs/review/BUILD-MANIFEST.json` later with observed hash

**Interfaces:**
- Build outputs `dist/review/ReviveRelay-0.6.1.user.js` and `.meta.js`.
- Metadata update/download URLs point to immutable `/releases/review/0.6.1/...`.

- [ ] **Step 1: Update tests first to expect 0.6.1**

Change exact expected version/path strings in release tests, then run:

```bash
node --test test/release-build.test.js test/release-pinning.test.js test/review-release-smoke.test.js test/review-package.test.js
```

Expected: FAIL while package/build still identifies 0.6.0.

- [ ] **Step 2: Set package version to 0.6.1 and update version-specific scripts**

`package.json` scripts must validate `dist/review/ReviveRelay-0.6.1.user.js`; do not generate or overwrite a 0.6.0 artifact.

- [ ] **Step 3: Build and verify artifact metadata**

```bash
npm run build
node --check dist/review/ReviveRelay-0.6.1.user.js
```

Expected metadata includes `@version 0.6.1`, review update/download URLs, exact 40-hex build commit, and `UPDATE_CHANNEL='review'`.

- [ ] **Step 4: Run release tests GREEN**

```bash
node --test test/release-build.test.js test/release-pinning.test.js test/review-release-smoke.test.js test/release-dependency-verification.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit source/version changes before final candidate build**

```bash
git add package.json scripts/audit-review-release.js test/release-build.test.js test/release-pinning.test.js test/review-release-smoke.test.js test/review-package.test.js
git commit -m "build: prepare immutable ReviveRelay 0.6.1 review release"
```

Then rebuild once from that exact commit; record its SHA-256. Do not amend the executable source commit after recording provenance.

---

### Task 8: Update review documentation for OWNER, runtime separation, and the trial invariant

**Files:**
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `SECURITY.md`
- Modify: `SUBSCRIPTION-MODEL.md`
- Modify: `TORN-API-DISCLOSURE.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/review/REVIVERELAY-0.6.0-STAFF-SUMMARY.md` by replacing/renaming with `docs/review/REVIVERELAY-0.6.1-STAFF-SUMMARY.md`
- Modify: `docs/review/REVIEW-CHECKLIST.md`
- Modify: `docs/review/SCREENSHOT-CHECKLIST.md`
- Modify: `docs/review/BUILD-MANIFEST.json`
- Modify: `docs/review/REVIVERELAY-0.6.0-AUTOMATED-VERIFICATION.md` by replacing/renaming with `docs/review/REVIVERELAY-0.6.1-AUTOMATED-VERIFICATION.md`
- Test: `test/review-package.test.js`

**Interfaces:**
- Review docs state 0.6.1 private review runtime, stable public 0.4.4 unchanged, OWNER/Lifetime for R4G3RUNN3R [3877028], and one-time trial persistence.

- [ ] **Step 1: Extend review-package tests before docs**

Require exact phrases/concepts for:

```text
0.6.1
/review/v1/
OWNER
Lifetime
R4G3RUNN3R [3877028]
one-time per canonical Torn identity
reinstall
stable 0.4.4 unchanged
```

- [ ] **Step 2: Run RED review-package test**

```bash
node --test test/review-package.test.js
```

Expected: FAIL against 0.6.0 review docs.

- [ ] **Step 3: Update docs truthfully**

Do not claim browser acceptance, Torn approval, or production promotion. Explain that OWNER is server-derived from canonical merchant configuration and bypasses only subscription entitlement, not revive verification/ability/registration.

- [ ] **Step 4: Run package/static audit GREEN**

```bash
node --test test/review-package.test.js test/review-audit.test.js
npm run audit:review
```

Expected: PASS and zero findings.

- [ ] **Step 5: Commit docs/evidence**

```bash
git add README.md PRIVACY.md SECURITY.md SUBSCRIPTION-MODEL.md TORN-API-DISCLOSURE.md CHANGELOG.md docs/review test/review-package.test.js
git commit -m "docs: package ReviveRelay 0.6.1 review evidence"
```

---

### Task 9: Build deployment descriptors for isolated review services

**Files:**
- Create: `deploy/docker-compose.review.yml`
- Modify: `deploy/.env.example`
- Modify: `deploy/README.md`
- Test: `server/test/deploy-review-runtime.test.js`

**Interfaces:**
- Review API binds localhost `127.0.0.1:18731:3100`.
- Review billing worker executes `node src/review-subscription-worker.js`.
- Both mount an immutable 0.6.1 review server-runtime directory and attach to existing `reviverelay_db_internal` and `reviverelay_egress` networks as external networks.
- Stable service definitions are not changed.

- [ ] **Step 1: Write failing deployment-structure tests**

Parse the YAML/text and assert:

```js
assert.match(compose,/reviverelay-review-api:/);
assert.match(compose,/127\.0\.0\.1:18731:3100/);
assert.match(compose,/review-subscription-worker\.js/);
assert.doesNotMatch(compose,/18730:3100/);
assert.doesNotMatch(compose,/reviverelay-api:\s*\n/);
```

Also assert the review file does not define a database service and references only the existing ReviveRelay networks.

- [ ] **Step 2: Run RED test**

```bash
node --test server/test/deploy-review-runtime.test.js
```

Expected: FAIL because review compose file does not exist.

- [ ] **Step 3: Create review-only compose**

Use the existing secret env file but override non-secret review values:

```yaml
environment:
  PORT: 3100
  SUBSCRIPTION_MODE: review
  REVIVERELAY_SERVER_VERSION: 0.6.1
  REVIVERELAY_MINIMUM_CLIENT_VERSION: 0.6.1
  REVIVERELAY_RELEASE_CHANNEL: review
```

Do not put receiver API key or other secrets into compose source.

- [ ] **Step 4: Run deployment tests GREEN**

```bash
node --test server/test/deploy-review-runtime.test.js server/test/config.test.js server/test/config-pro.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit deployment descriptors**

```bash
git add deploy/docker-compose.review.yml deploy/.env.example deploy/README.md server/test/deploy-review-runtime.test.js
git commit -m "ops: define isolated ReviveRelay review runtime"
```

---

### Task 10: Run exact-candidate automated verification

**Files:**
- Modify only observed evidence: `docs/review/BUILD-MANIFEST.json`, `docs/review/REVIVERELAY-0.6.1-AUTOMATED-VERIFICATION.md`

**Interfaces:**
- Executable provenance commit and artifact SHA-256 are recorded separately from later documentation-only commits.

- [ ] **Step 1: Start a disposable PostgreSQL 16 instance and run full server tests**

Use a Docker-assigned localhost port and set `TEST_DATABASE_URL` to the disposable database. Run:

```bash
npm run test:server
```

Expected: all server tests PASS, including the new lifecycle/OWNER/runtime tests.

- [ ] **Step 2: Run complete client/review verification**

```bash
npm run test:client
node --check dist/review/ReviveRelay-0.6.1.user.js
node --test test/review-release-smoke.test.js test/release-dependency-verification.test.js
npm run audit:review
```

Expected: zero failures, zero static-audit findings.

- [ ] **Step 3: Capture exact artifact hash and provenance**

```bash
sha256sum dist/review/ReviveRelay-0.6.1.user.js
grep -E 'ReviveRelay-Build-Commit|@version|@updateURL|@downloadURL' dist/review/ReviveRelay-0.6.1.user.js
```

Record observed values in the build manifest/report; do not guess timestamps/counts.

- [ ] **Step 4: Clean disposable DB and verify worktree diff**

Run `git diff --check` and confirm no secrets or unexpected generated lockfiles are staged.

- [ ] **Step 5: Commit evidence-only updates**

```bash
git add docs/review/BUILD-MANIFEST.json docs/review/REVIVERELAY-0.6.1-AUTOMATED-VERIFICATION.md
git commit -m "test: record ReviveRelay 0.6.1 verification"
```

---

### Task 11: Deploy private review runtime and immutable 0.6.1 artifact

**Files outside repo / operations:**
- `/srv/voidsmith/torn-platform/reviverelay/releases/server/review/0.6.1/`
- `/srv/voidsmith/torn-platform/reviverelay/releases/client/review/0.6.1/`
- `/srv/voidsmith/infrastructure/caddy/Caddyfile`
- review Compose project only

**Interfaces:**
- Caddy route `/review/*` proxies to localhost `18731` while stripping the `/review` prefix, so backend receives `/v1/...` and `/health`.
- Existing `/v1/* -> 127.0.0.1:18730` remains byte-for-byte functionally unchanged.

- [ ] **Step 1: Invoke Voidsmith Source-of-Truth skill and revalidate live state**

Before any mutation, verify current host, Caddy file, stable port `18730`, production `current -> 0.4.4`, existing DB/network names, and secret-file path. Abort if live state differs materially from the plan.

- [ ] **Step 2: Stage immutable server/client release directories**

Copy only the verified source/runtime and exact 0.6.1 client/meta artifacts into versioned review directories. Verify artifact SHA-256 after copy.

- [ ] **Step 3: Start review API and dedicated review billing loop**

Use `deploy/docker-compose.review.yml`; validate service health and confirm review processes connect only to ReviveRelay DB/network resources.

- [ ] **Step 4: Add and validate Caddy review route**

Add a narrowly scoped handler before the fallback:

```caddy
handle_path /review/* {
    reverse_proxy 127.0.0.1:18731
}
```

Validate Caddy config before reload. Do not modify the stable `/v1/*` handler.

- [ ] **Step 5: Publish immutable 0.6.1 review files**

The URLs must become:

```text
https://reviverelay.voidsmithindustries.com/releases/review/0.6.1/ReviveRelay-0.6.1.user.js
https://reviverelay.voidsmithindustries.com/releases/review/0.6.1/ReviveRelay-0.6.1.meta.js
```

Do not overwrite 0.6.0.

- [ ] **Step 6: Verify live route isolation**

Check:

```text
/review/health -> 0.6.1 review service
/review/v1/client/version -> review channel
/v1/client/version -> stable 0.4.4 service
/install/... -> stable current 0.4.4
```

Confirm stable container/worker identities and production symlink are unchanged.

- [ ] **Step 7: Update Source of Truth with observed deployment facts**

Record only verified non-secret facts: review ports/paths, source commit, artifact hash, OWNER rule, stable 0.4.4 unchanged, and pending Torn/browser acceptance.

---

### Task 12: Browser acceptance and final handoff

**Files:**
- Modify: `docs/review/REVIEW-CHECKLIST.md` only for checks actually observed.

**Interfaces:**
- Normal user, expired-trial user, and OWNER are three distinct acceptance cases.

- [ ] **Step 1: Install exact 0.6.1 review artifact manually**

Confirm the userscript talks to `/review/v1/*`, not stable `/v1/*`.

- [ ] **Step 2: Test normal eligible reviver**

Start one trial, record displayed expiry, disconnect/reconnect/reinstall, and verify the same server expiry remains. Attempting Start Trial again must be absent or server-rejected.

- [ ] **Step 3: Test expired-trial state**

Use a controlled test identity/fixture rather than modifying production user history. Confirm EXPIRED cannot regain trial through new session/credential.

- [ ] **Step 4: Test OWNER identity**

For R4G3RUNN3R [3877028], confirm `OWNER`, `Lifetime`, no trial button, no purchase controls, and normal verification/ability/registration requirements still apply.

- [ ] **Step 5: Final verification-before-completion gate**

Invoke `superpowers:verification-before-completion`, rerun exact critical checks, and only then claim 0.6.1 ready for Torn review.

- [ ] **Step 6: Finish branch**

Invoke `superpowers:finishing-a-development-branch`; do not promote stable production without a new explicit user decision.

---

## Follow-up research spike after 0.6.1

After this implementation is complete, perform the separately requested research sweep across current Torn forums/wiki/API material, GitHub, GreasyFork, Reddit, and adjacent browser/userscript projects. Compare concrete patterns against ReviveRelay, separate verified current practices from community anecdotes, and present a ranked improvement backlog with benefits, risks, Torn-policy implications, and recommendation. Do not implement research-derived features without a separate approved design.
