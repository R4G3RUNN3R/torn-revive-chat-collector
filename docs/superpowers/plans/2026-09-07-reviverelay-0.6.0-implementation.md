# ReviveRelay 0.6.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete ReviveRelay 0.6.0 private Torn-review candidate defined by the approved design, with free/review/live subscription policy, hardened reviver authorization, unified client transport, privacy/data-lifecycle controls, immutable review/stable release channels, and a reproducible Torn review package while leaving public stable production 0.4.4 untouched.

**Architecture:** The ReviveRelay server remains authoritative for identity, subscription mode, plan pricing, merchant identity, entitlement, current Torn revive eligibility, payment evidence, deletion, and release compatibility. The userscript is one self-contained artifact built from modular source and renders server-owned state without holding secrets or automating Torn actions. PostgreSQL remains isolated from Nexis/DMOS and provides final concurrency/audit guarantees.

**Tech Stack:** Node.js 20, CommonJS, Fastify, PostgreSQL 16, node:test, Zod, Tampermonkey/TornPDA-compatible userscript JavaScript, existing ReviveRelay build/release scripts.

**Spec:** `docs/superpowers/specs/2026-09-07-reviverelay-0.6.0-review-subscriptions-design.md`

## Global Constraints

- Target release is exactly `0.6.0` and begins in the private `review` channel.
- Public stable production remains `0.4.4` until Torn review, manual browser acceptance, and explicit owner promotion approval.
- Requesting a revive is always free.
- Subscription modes are exactly `free`, `review`, and `live`.
- `review` and `live` enforce real Pro entitlement for reviver queue/notifications/Accept/registration. `free` waives only the paid/trial entitlement requirement.
- All reviver modes still require authentication, usable Reviver Verification, current Torn permanent `Ability to revive`, active reviver registration where applicable, and existing standing/abuse checks.
- Canonical plans remain monthly = 1 month / 10 Xanax / 10,000,000 Torn cash; six_months = 6 / 55 / 55,000,000; yearly = 12 / 100 / 100,000,000.
- Canonical merchant is `R4G3RUNN3R [3877028]`; client code cannot override merchant identity, plan price, duration, purchaser identity, or entitlement expiry.
- Payment sending remains manual inside Torn. ReviveRelay never sends Torn cash/items or performs a revive.
- Subscription payment evidence comes only from the server-side merchant account restricted incoming-log credential. Full/broad merchant credentials are rejected.
- User verification credentials remain encrypted server-side, never returned after bind, and are not stored in Tampermonkey.
- Existing grandfathered-reviver fix from `c239262` must not regress: historical `reviver` role never substitutes for current Torn revive ability.
- Diagnostics remain OFF by default and must not contain credentials, authorization headers, raw Torn responses/logs, chat/page content, or arbitrary payloads.
- Legacy public-chat collection/runtime is absent from the 0.6.0 distributed userscript.
- Dynamic external/user-controlled strings use text-safe DOM handling or escaping before HTML insertion.
- One pending invoice per user, one Torn payment evidence ID consumed once, payment + entitlement activation atomic, and request Accept remains single-winner under concurrency.
- Review/stable artifacts are immutable once distributed and have separate manifests/install URLs.
- No Caddy/DNS/public-production deployment is part of this implementation plan. Build and stage locally in the worktree/release workspace only. Runtime deployment is a separate gated operation.
- Never write real secret values into source, docs, tests, manifests, Git, logs, or the Voidsmith Source of Truth.

---

### Task 1: Lock the approved design state, 0.6.0 version, and subscription-mode configuration

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-reviverelay-0.6.0-review-subscriptions-design.md`
- Modify: `package.json`
- Modify: `server/src/config.js`
- Modify: `server/test/config-pro.test.js`
- Modify: `server/test/config.test.js`
- Modify: `test/direct-only-build.test.js`
- Modify: `test/browser-proven-baseline.test.js` only if its immutable historical assertion explicitly hardcodes the current package version rather than a frozen fixture

- [x] **RED:** Replace legacy config expectations with tests proving `SUBSCRIPTION_MODE` defaults to `free`, accepts only `free|review|live`, and requires both merchant fields in `review`/`live` but not `free`. Assert `PAID_TIER_ENABLED` is no longer part of loaded canonical config.

```js
const free = loadConfig(BASE);
assert.equal(free.SUBSCRIPTION_MODE, free);
assert.equal(Object.hasOwn(free, PAID_TIER_ENABLED), false);
assert.throws(() => loadConfig({...BASE, SUBSCRIPTION_MODE:review}), /PRO_RECEIVER/);
const review = loadConfig({...BASE, SUBSCRIPTION_MODE:review, PRO_RECEIVER_TORN_ID:3877028, PRO_RECEIVER_API_KEY:restricted-key});
assert.equal(review.SUBSCRIPTION_MODE, review);
```

- [x] Run `node --test server/test/config-pro.test.js server/test/config.test.js` and confirm failure because `SUBSCRIPTION_MODE` is not implemented.
- [x] **GREEN:** Replace the boolean schema with `SUBSCRIPTION_MODE: z.enum([free,review,live]).default(free)`; require merchant ID/key only outside free mode. Do not add compatibility aliases that can create two sources of truth.
- [x] Change package version from `0.5.0` to `0.6.0` and update current-release tests to 0.6.0 while preserving frozen historical fixtures.
- [x] Change spec status to `Approved for implementation - 7 September 2026`.
- [x] Run focused config/version tests and `npm run build`; confirm green.
- [x] Commit: `chore: lock ReviveRelay 0.6.0 subscription modes`

### Task 2: Add server capability metadata and one shared subscription access policy

**Files:**
- Create: `server/src/domain/subscription-mode.js`
- Modify: `server/src/security/pro-access.js`
- Modify: `server/src/routes/pro.js`
- Modify: `server/src/routes/revivers.js`
- Modify: `server/src/routes/reviver-queue.js`
- Modify: `server/src/routes/me.js`
- Modify: `server/src/app.js`
- Modify: `server/test/routes/pro.test.js`
- Modify: `server/test/routes/pro-gating.test.js`
- Modify: `server/test/routes/reviver-queue.test.js`
- Modify: `server/test/routes/revivers.test.js`
- Modify: `server/test/routes/me.test.js`

- [x] **RED:** Add policy tests proving `free` bypasses only Pro entitlement while `review`/`live` require TRIAL/ACTIVE; NONE/EXPIRED/REVOKED fail with `REVIVER_PRO_REQUIRED` in review/live. Existing credential, role and live Torn ability failures must still occur in free mode.

```js
assert.equal(subscriptionRequiresEntitlement(free), false);
assert.equal(subscriptionRequiresEntitlement(review), true);
assert.equal(subscriptionRequiresEntitlement(live), true);
```

- [x] **RED:** Add authenticated capability response assertions. `GET /v1/pro/status` must return `subscription` containing mode, `paymentsEnabled`, merchant public identity when applicable, and server-owned plans; free mode must not expose a payment target or invoice creation capability.

```json
{
  "subscription": {
    "mode": "review",
    "paymentsEnabled": true,
    "merchant": {"tornId": 3877028, "name": "R4G3RUNN3R"}
  }
}
```

- [x] Run focused route/security tests and confirm RED.
- [x] **GREEN:** Implement `normalizeSubscriptionMode`, `paymentsEnabled`, `subscriptionRequiresEntitlement`, and a shared `requireReviverAccessPolicy`/mode-aware Pro guard. Route factories receive canonical config/mode instead of reimplementing booleans.
- [x] Keep plan catalogue server-owned and return it from the Pro capability/status surface. Invoice creation returns a stable mode-specific error such as `SUBSCRIPTION_PAYMENTS_DISABLED` in free mode only when called directly; normal client UI must never offer the action there.
- [x] Preserve current Torn eligibility revalidation in queue and Accept after mode policy.
- [x] Run all focused tests, including the grandfathered eligibility regression.
- [x] Commit: `feat: centralize ReviveRelay subscription access policy`

### Task 3: Gate the one-time trial behind live reviver eligibility

**Files:**
- Modify: `server/src/routes/pro.js`
- Modify: `server/src/app.js`
- Modify: `server/test/routes/pro.test.js`
- Modify: `server/test/direct-pro-smoke.test.js`

- [x] **RED:** Add tests proving trial start is rejected until the authenticated account has a usable reviver-capable credential and current Torn `/user/perks` confirms `Ability to revive`. Missing capability returns a bounded verification error; missing perk returns `REVIVE_ABILITY_NOT_UNLOCKED`; missing perks permission returns `REVIVE_ABILITY_PERMISSION_REQUIRED`.
- [x] Confirm the current trial route incorrectly starts the trial and the new tests fail for that reason.
- [x] **GREEN:** Inject `verificationCredentialRepository` and `tornClient` into Pro routes, reuse `createReviveEligibilityService`, and perform credential + live ability checks before calling `entitlementRepository.startTrial`.
- [x] Do not require a historical reviver role before starting the trial; deliberate trial activation can precede local registration after eligibility is confirmed.
- [x] Update direct Pro smoke flow to bind verification and confirm eligibility before deliberate trial start.
- [x] Run focused route + smoke tests against disposable PostgreSQL.
- [x] Commit: `fix: require live revive eligibility before Pro trial`

### Task 4: Make payment scanning and merchant startup validation mode-aware

**Files:**
- Modify: `server/src/worker.js`
- Modify: `server/src/worker/subscription-scan.js` only if a mode guard belongs in handler composition rather than startup
- Modify: `server/test/worker/handlers.test.js`
- Modify: `server/test/worker/subscription-scan.test.js`
- Create or modify: `server/test/worker/subscription-mode.test.js`
- Modify: `deploy/.env.example`
- Modify: `deploy/README.md`

- [ ] **RED:** Add tests around a small exported worker setup decision proving `free` does not instantiate/validate the merchant evidence service or enqueue `subscription.scan`, while `review` and `live` do.
- [ ] Confirm tests fail while worker still branches on `PAID_TIER_ENABLED`.
- [ ] **GREEN:** Branch only on canonical subscription mode; review/live validate merchant credential at startup before scanning. Free mode leaves existing invoices/history untouched and simply stops new scanning/enqueue.
- [ ] Update deployment examples to `SUBSCRIPTION_MODE=free` and document required merchant environment names for review/live without example secrets.
- [ ] Run worker/config/merchant-evidence tests.
- [ ] Commit: `feat: make Pro payment scanning subscription-mode aware`

### Task 5: Expose REVOKED state and add durable refund/admin adjustment records

**Files:**
- Create: `server/src/db/migrations/007_pro_billing_adjustments.sql`
- Create: `server/src/db/pro-billing-adjustments.js`
- Modify: `server/src/db/pro-entitlements.js`
- Modify: `server/src/routes/admin-pro.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Modify: `server/test/db/pro-entitlements.test.js`
- Create: `server/test/db/pro-billing-adjustments.test.js`
- Modify: `server/test/routes/admin-pro.test.js`
- Modify: `server/test/db/migrations.test.js`

- [ ] **RED:** Change revoked entitlement expectation from EXPIRED to `REVOKED` and prove `validUntil` remains historical informational data while access is denied.
- [ ] **RED:** Add DB tests for immutable adjustment records containing invoice reference when applicable, adjustment type (`FULL_REFUND`, `ENTITLEMENT_CORRECTION`, `COMPLIMENTARY_GRANT`), currency/value snapshot when applicable, reason, actor identity, timestamp, previous/new entitlement state and previous/new validity.
- [ ] **RED:** Add admin route test for full refund against a PAID invoice; it must record adjustment and revoke/reduce paid access through one audited transaction/service boundary. Partial automatic prorating remains absent.
- [ ] Confirm RED failures because no adjustment table/repository exists and revoked state is still EXPIRED.
- [ ] **GREEN:** Add migration with foreign keys, bounded enum checks, non-negative values and immutable insert-only repository interface. Expose a transactional admin billing service or repository method so adjustment + entitlement change cannot diverge.
- [ ] Preserve original invoice/payment evidence; never mutate a PAID invoice back to pending or delete consumed Torn evidence.
- [ ] Run migration, entitlement, admin and concurrency-relevant DB tests against disposable PostgreSQL.
- [ ] Commit: `feat: audit Reviver Pro refunds and entitlement adjustments`

### Task 6: Implement authenticated ReviveRelay account/data deletion

**Files:**
- Create: `server/src/db/account-deletion.js`
- Create: `server/src/routes/account.js`
- Create: `server/test/db/account-deletion.test.js`
- Create: `server/test/routes/account.test.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Modify: `server/src/security/rate-limits.js`
- Modify: `server/src/db/migrations/007_pro_billing_adjustments.sql` only if the lifecycle design needs a tombstone/audit relation introduced in the same new migration; otherwise create `008_account_deletion.sql`

- [ ] **RED:** Add integration test proving `DELETE /v1/account` requires auth and explicit confirmation payload, then immediately revokes all sessions, revokes/removes encrypted user verification credentials, removes active reviver registration/preferences/preset-linked operational data where safe, and prevents the old bearer token from authenticating again.
- [ ] **RED:** Prove paid invoices/payment evidence/billing adjustments and minimal anti-reuse/security history survive without retaining plaintext/raw Torn payloads.
- [ ] Confirm RED because route/service is absent.
- [ ] **GREEN:** Implement one transactional deletion service with explicit retention behavior. Prefer pseudonymization/tombstoning of the identity row when foreign-key-retained billing history requires it rather than cascading protected finance evidence.
- [ ] Route response must describe completion only after commit and never return retained secret/internal fields.
- [ ] Apply a specific account-mutation rate limit.
- [ ] Run account deletion + auth + DB privacy tests.
- [ ] Commit: `feat: add ReviveRelay account data deletion`

### Task 7: Consolidate Pro requests into the unified client API transport

**Files:**
- Modify: `src/direct-api-client.js`
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/client-modules.js`
- Modify: `test/direct-api-client.test.js`
- Modify: `test/pro-client.test.js` to assert legacy Pro client is no longer a production dependency or remove this test/file if no longer meaningful
- Modify: `test/pro-ui.test.js`
- Modify: `test/client-privacy.test.js`
- Modify: `test/direct-only-build.test.js`

- [ ] **RED:** Extend direct-client tests with `getProStatus`, `startProTrial`, `getProPlans` or capability-derived plan access, `createProInvoice`, `getProInvoice`, and `deleteAccount`. Assert server error codes are preserved for 403/409/422/503 instead of collapsing them to generic categories, while status/retryability remain bounded.

```js
throw new DirectApiClientError(serverCode || fallbackCode, {status, retryable, details:safeDetails});
```

- [ ] **RED:** Assert the production bundle inventory no longer includes `src/pro-client.js`, userscript no longer reads `ReviveRelayProClient`, and only one transport instance owns base URL/session/version/channel headers.
- [ ] Confirm RED.
- [ ] **GREEN:** Move Pro methods/validation into `createDirectApiClient`, preserve safe server error codes, remove production `proApi` construction, and route all Pro calls through `state.api`.
- [ ] Leave `src/pro-client.js` only as non-production historical source if deletion would harm history; it must not be bundled or invoked.
- [ ] Run direct client, Pro UI, privacy and bundle tests.
- [ ] Commit: `refactor: unify ReviveRelay client API transport`

### Task 8: Render subscription mode and server-owned plans without hard-coded client pricing

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `test/pro-ui.test.js`
- Modify: `test/requester-ui.test.js`
- Create or modify: `test/subscription-mode-ui.test.js`

- [ ] **RED:** Replace tests that search the userscript for hard-coded launch prices with state-rendering tests/static assertions proving plan labels/amounts are rendered from server response data.
- [ ] **RED:** Add tests for exact UI policy: free = no purchase/invoice button and explanatory free-mode copy; review/live = plans + manual payment creation; requester path unchanged in all modes; merchant shown from server public metadata.
- [ ] **RED:** Add error mapping assertions for revive ability/key update/invoice expiry/client update/Torn unavailable so raw server codes remain Diagnostics-only.
- [ ] Confirm current UI fails because prices/actions are hard-coded and mode-unaware.
- [ ] **GREEN:** Store `subscription` capability state from the server and render Pro controls from it. Keep only currency formatting logic client-side, not authoritative plan values.
- [ ] Ensure invoice instructions explicitly say the payment must be sent manually in Torn and never imply ReviveRelay performs the payment.
- [ ] Run Pro/subscription/requester UI tests.
- [ ] Commit: `feat: render Reviver Pro from server subscription state`

### Task 9: Harden polling, mutation idempotence UX, optional GM APIs, and dynamic text sinks

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `src/telemetry-client.js` only if needed for opt-in behavior isolation
- Modify: `test/requester-ui.test.js`
- Modify: `test/pro-ui.test.js`
- Modify: `test/telemetry-integration.test.js`
- Create: `test/client-hardening.test.js`

- [ ] **RED:** Add tests/static contract checks for one single-flight lock per request/queue/eligibility/Pro/invoice/transaction poller; concurrent calls return/await existing work rather than issue duplicate network requests.
- [ ] **RED:** Assert request, cancel, Accept, register, trial, invoice, verification bind/revoke and account-delete buttons are disabled while their mutation is in flight and restored on settled result.
- [ ] **RED:** Add malicious external text fixtures such as `<img src=x onerror=...>` and prove rendered output is escaped or assigned via `textContent`; inventory remaining `innerHTML` sinks and require dynamic values to pass `escapeHtml`.
- [ ] **RED:** Remove unconditional dependency on `GM_notification`; test behavior when notification API is absent. Diagnostics remains false by default and telemetry failure cannot throw into product flow.
- [ ] **GREEN:** Implement scoped in-flight state and subsystem render functions. Do not rebuild Settings/request forms during routine polling.
- [ ] Feature-detect optional userscript APIs and keep TornPDA-compatible core behavior.
- [ ] Run client-hardening, requester, Pro, telemetry and bootstrap tests.
- [ ] Commit: `fix: harden ReviveRelay client polling and rendering`

### Task 10: Add About & Privacy, verification revocation guidance, and deletion UI

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Create: `test/privacy-ui.test.js`
- Modify: `test/requester-ui.test.js`
- Modify: `test/verification-credential-ui.test.js`

- [ ] **RED:** Add UI tests requiring an `About & Privacy` settings section with version/channel, API purpose, data stored, encrypted-key statement, recommended permissions, broad-key warning, subscription terms, merchant, diagnostics consent, verification revocation, delete-account action, and review/privacy-document links.
- [ ] **RED:** Require deletion confirmation copy that distinguishes immediate operational deletion from retained minimal billing/security evidence.
- [ ] **RED:** Require Reviver Verification revoke copy/link instructing the user to delete the key in Torn API settings too.
- [ ] **GREEN:** Implement the section using safe static text + escaped server state; account delete calls unified API endpoint only after explicit local confirmation and clears local ReviveRelay session/preset/preferences after successful server response.
- [ ] Run privacy/settings/verification tests.
- [ ] Commit: `feat: add ReviveRelay privacy and deletion controls`

### Task 11: Build immutable review/stable release channels and exact 0.6.0 review artifact

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Modify: `scripts/release-client.js`
- Modify: `server/src/domain/client-version.js`
- Modify: `server/src/security/client-version.js`
- Modify: `server/src/routes/client-version.js`
- Modify: `server/src/release/registry.js`
- Modify: `test/release-build.test.js`
- Modify: `test/release-client.test.js`
- Modify: `test/release-pinning.test.js`
- Modify: `test/release-dependency-verification.test.js`
- Modify: `server/test/domain/client-version.test.js`
- Modify: `server/test/routes/client-version.test.js`
- Modify: `server/test/release/registry.test.js`
- Create: `test/review-release-smoke.test.js`

- [ ] **RED:** Define exact manifest schema carrying semantic version, minimum version, build timestamp, Git SHA, release channel (`review|stable`), SHA-256, API compatibility, release notes and immutable install metadata. Review manifest may reference only review URLs; stable manifest only stable URLs.
- [ ] **RED:** Build tests require `ReviveRelay-0.6.0.user.js` review artifact, metadata `@version 0.6.0`, `ReviveRelay-Build-Commit`, build timestamp, and `review` channel. No stale `0.5.0`, `automatic`, or `manual` release-channel metadata may remain in the candidate artifact.
- [ ] **RED:** Compatibility handler chooses install URL for the requesting client channel and never routes a review client to stable or vice versa.
- [ ] Confirm RED with current automatic/manual build model.
- [ ] **GREEN:** Rework build variants around review/stable. Build timestamp is generated once per build and embedded consistently; each channel has separate output directory/manifest and immutable versioned filename. Stable build capability exists but 0.6.0 is generated only for review during this plan.
- [ ] Preserve self-contained bundle and pinned Git provenance verification.
- [ ] Add simulated userscript smoke test proving metadata parses, support globals exist once, bootstrap parses/loads, sidebar boot path is present, and legacy chat runtime modules are absent.
- [ ] Run release/domain/smoke tests and syntax checks.
- [ ] Commit: `build: add immutable review and stable release channels`

### Task 12: Produce Torn review documentation, static security audit, and exact-candidate verification report

**Files:**
- Modify: `README.md`
- Create: `PRIVACY.md`
- Create: `SECURITY.md`
- Create: `TORN-API-DISCLOSURE.md`
- Create: `SUBSCRIPTION-MODEL.md`
- Create: `CHANGELOG.md`
- Create: `docs/review/REVIVERELAY-0.6.0-STAFF-SUMMARY.md`
- Create: `docs/review/ENDPOINT-INVENTORY.md`
- Create: `docs/review/TORN-API-INVENTORY.md`
- Create: `docs/review/PAYMENT-VERIFICATION-FLOW.md`
- Create: `docs/review/REVIEW-CHECKLIST.md`
- Create: `docs/review/SCREENSHOT-CHECKLIST.md`
- Create: `scripts/audit-review-release.js`
- Create: `test/review-package.test.js`
- Modify: `package.json`

- [ ] **RED:** Add review-package test requiring all 19 review-package evidence classes from the approved spec, exact merchant/prices, explicit manual Torn-action boundary, privacy/deletion/revocation disclosures, paid launch awaiting Torn approval, and the explicit Torn question about certified ReviveRelay-server notifications.
- [ ] **RED:** Add static audit script tests/fixtures proving the exact generated review artifact/package fails on embedded token/key patterns, unexpected network hosts, `eval`/remote executable code, unsafe unescaped dynamic sinks flagged by the audit allow-list, excessive GM permissions, legacy chat runtime identifiers/dependencies, or stale 0.5.0 metadata.
- [ ] **GREEN:** Write documents from implemented behavior only; do not claim screenshots or manual acceptance already completed. Screenshot checklist names Request, Reviver, Activity, Pro and Settings captures as required human evidence.
- [ ] Add `npm run audit:review` and `npm run verify:review` that operate on the exact candidate commit/artifact and include build, client tests, server tests, syntax, release smoke and static audit. Database-backed verification receives `TEST_DATABASE_URL` from an isolated disposable database in CI/operator execution, never from production.
- [ ] Run exact candidate verification against a fresh disposable PostgreSQL 16 instance. Record command, Git SHA, client/server test totals, artifact SHA-256 and audit result in `docs/review/REVIVERELAY-0.6.0-AUTOMATED-VERIFICATION.md` generated from observed output, not invented values.
- [ ] Run `git diff --check`, confirm clean worktree after commit, and verify no secret-like values are present in tracked diff.
- [ ] Commit: `docs: package ReviveRelay 0.6.0 for Torn review`

## Final review and handoff gate

- [ ] Review the full branch diff from design base `c239262aaeb5af57661ed7caaf66212959a9751f` through final candidate commit for spec compliance, security regressions, secret exposure, entitlement bypasses, stale-client bypasses, payment evidence replay, account deletion retention mistakes, unsafe DOM sinks, and release-channel crossing.
- [ ] Run the complete exact-commit disposable-PostgreSQL verification once more after any review fixes.
- [ ] Update the Voidsmith Source of Truth with only durable, verified 0.6.0 implementation facts and the resulting candidate commit/hash. Do not record secrets.
- [ ] Stop before runtime/public deployment. Present the private review artifact and manual browser acceptance checklist to the owner.
- [ ] Public production 0.4.4 and its current manifest/symlink remain unchanged.
