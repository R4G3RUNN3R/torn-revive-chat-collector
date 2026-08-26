# ReviveRelay Stage 3 Marketplace Verification Design

Date: 2026-08-26
Status: Approved design, pending written-spec review
Repository: `R4G3RUNN3R/torn-revive-chat-collector`
Base: `main` at `296a8017defc96b86dbd30f577fead56a8061a41`
Parent design: `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

## 1. Purpose

Stage 3 turns ReviveRelay from a request/candidate client with an isolated backend into an evidence-backed paid-revive marketplace.

The server becomes authoritative for transaction-verification credentials, reservation/payment/revive/refund timers and evidence, reportable no-attempt/missing-refund outcomes, operational error telemetry, and userscript version/release metadata.

Stage 3 does not yet implement the full human dispute/reputation/admin workflow or Reviver Pro billing. Those remain Stages 4 and 5.

## 2. Non-negotiable constraints

1. ReviveRelay PostgreSQL remains physically/logically isolated from every other Voidsmith product database.
2. No DungeonMasterOS, Nexis, CIEL, website, Guacamole, or other database credentials are available to ReviveRelay.
3. Identity-only Torn API keys are verified and discarded. They are never persisted.
4. Persistent Torn credentials are a separate transaction-verification credential, minimally scoped and encrypted at rest with a key held outside PostgreSQL.
5. A paid protected transaction cannot begin unless both sides have the evidence access needed to adjudicate it.
6. Browser/client claims are never proof of payment, revive, refund, or deadline compliance.
7. Timers are server-derived from PostgreSQL timestamps.
8. Torn API outages or ambiguous evidence pause/retry verification rather than declaring misconduct.
9. Public chat privacy boundaries from Stages 1/2 remain unchanged.
10. `PAID_TIER_ENABLED=false` remains in force through Stage 3 implementation/testing.
11. Public DNS/Caddy exposure remains a launch gate; internal implementation must not expose PostgreSQL or bypass the existing localhost-only API architecture.
12. Completed and verified work is merged to `main`.

## 3. Current foundation this design extends

Current `main` already contains the isolated PostgreSQL/API/worker deployment, a PostgreSQL job queue using row locking / `SKIP LOCKED`, the Stage 1 business tables, atomic request acceptance, public-candidate ingestion/deduplication, and the Stage 2 client/onboarding/requester workflow.

Current worker job names already reserve:

- `payment.verify`
- `revive.verify`
- `refund.verify`
- `subscription.scan`
- `sheets.mirror`

Stage 3 implements the first three. `subscription.scan` stays inactive until Stage 5. `sheets.mirror` is used only for the approved error-triage mirror in Stage 3; business/admin mirroring remains Stage 4.

## 4. Transaction-verification credential model

### 4.1 Separate from identity verification

`POST /v1/auth/bind` remains identity-only: verify Torn identity, issue an opaque ReviveRelay session, then discard the supplied key. No `api_credentials` row is created by identity binding.

### 4.2 Credential endpoints

Stage 3 adds authenticated endpoints:

- `GET /v1/verification-credential`
- `POST /v1/verification-credential`
- `DELETE /v1/verification-credential`

`POST` accepts the plaintext key only for the duration of the request. The backend verifies ownership and exact access, rejects insufficient or unapproved scope, encrypts the validated key with AES-256-GCM using the application key outside PostgreSQL, atomically revokes any prior active transaction credential, stores only ciphertext/IV/auth tag/validated non-secret scope metadata, and writes a non-secret audit event.

### 4.3 Credential purpose

`api_credentials` gains an explicit purpose, initially `transaction_verification`. Only one active credential of that purpose may exist per user.

### 4.4 Requester capability

Before creating a protected direct request, the requester credential must be sufficient for the narrowest current Torn evidence needed for:

- authenticated Torn identity;
- incoming revive evidence;
- hospital/status evidence needed to distinguish third-party revive, self-exit and natural expiry;
- outgoing payment evidence when useful for corroboration;
- incoming refund evidence when useful for corroboration.

Unrelated stats, messages, inventory, faction/company data and private communications are forbidden.

### 4.5 Reviver capability

Before registering/accepting, the reviver credential must be sufficient for:

- outgoing revive evidence;
- incoming Cash payment evidence;
- incoming item/Xanax payment evidence;
- outgoing Cash refund evidence;
- outgoing item/Xanax refund evidence.

Where Torn custom-key category restrictions are supported, ReviveRelay validates category-limited `user/log` access rather than accepting unrestricted log access.

### 4.6 Access drift/revocation

If a stored credential is later revoked, narrowed or invalid, the server marks it unusable, stops hammering Torn with it, pauses affected verification without declaring misconduct, prompts rebind, and blocks new protected requests/acceptances until access is restored.

## 5. Paid-transaction eligibility gate

A requester may create a protected request only with a valid requester-capable transaction credential.

A reviver may view/accept protected jobs only when authenticated, registered, active, not banned, and holding a valid reviver-capable transaction credential. Stage 5 later adds Reviver Pro entitlement; it is deliberately not active during Stage 3 testing.

The server enforces these gates.

## 6. Repeat reservations must preserve history

The current Stage 1 schema has `transactions.request_id UNIQUE`, which conflicts with returning an unpaid request to the queue.

Stage 3 changes the model so:

- one revive request may have multiple historical reservation/transaction rows;
- each acceptance creates a new immutable transaction row;
- at most one transaction for a request is open at once;
- expired unpaid reservations close rather than being overwritten;
- the request returns to `AVAILABLE` only after the prior reservation is closed;
- a later reviver acceptance creates a new transaction/deadlines.

A partial unique index enforces one open transaction per request.

## 7. Server-authoritative states

### Active

- `WAITING_FOR_PAYMENT`
- `PAYMENT_RECONCILING`
- `WAITING_FOR_REVIVE`
- `FAILED_ATTEMPT_CHOICE`
- `RETRY_OFFERED`
- `REFUND_REQUIRED`
- `REFUND_RECONCILING`
- `CREDENTIAL_REQUIRED`

### Terminal/non-active assignment

- `PAYMENT_EXPIRED`
- `COMPLETED`
- `REFUNDED`
- `CANCELLED_BY_REQUESTER`
- `CLOSED_REQUESTER_EXIT`
- `CLOSED_NATURAL_EXPIRY`
- `REPORTABLE_NO_ATTEMPT`
- `REPORTABLE_MISSING_REFUND`

Late payment after deadline uses the refund path and never silently becomes a new revive obligation. Prefer normalized `REFUND_REQUIRED` plus `refund_reason='late_payment'` rather than multiplying state names unless compatibility makes the separate existing state safer.

Stage 3 also adds append-only `transaction_state_history` with transaction ID, from/to state, event code, actor, server timestamp and non-secret metadata.

## 8. Acceptance and three-minute payment window

Acceptance remains atomic. On success the server creates a new transaction, records `accepted_at`, sets `payment_deadline = accepted_at + 3 minutes`, moves the request to `WAITING_FOR_PAYMENT`, records history/audit, and enqueues `payment.verify` immediately.

The worker polls boundedly during the payment window. Client `I paid` actions may request an earlier check but never constitute proof.

At `payment_deadline`, the transaction enters `PAYMENT_RECONCILING` for a short configured API propagation grace. The contractual payment deadline does not change.

After reconciliation:

- qualifying payment whose evidence timestamp is on/before deadline -> `WAITING_FOR_REVIVE`;
- no qualifying payment -> close as `PAYMENT_EXPIRED`, return request to `AVAILABLE` if still eligible;
- payment evidenced after deadline -> refund-required late-payment path.

Unpaid expiry has no misconduct penalty.

## 9. Payment evidence

The assigned reviver's narrowly scoped incoming evidence is primary proof because the server must prove the assigned reviver received value from the requester. Requester outgoing evidence may corroborate.

Cash evidence matches requester Torn ID, assigned reviver, transfer type/category, transaction window and aggregate amount.

Xanax evidence matches requester Torn ID, assigned reviver, Torn's canonical Xanax identity, transaction window and aggregate quantity.

Split same-method transfers are supported. Stage 3 therefore normalizes payment storage into one aggregate payment plus child `payment_evidence` rows keyed by unique Torn evidence ID.

Repeated polling is idempotent. If the qualifying aggregate exceeds the offer, `verified_amount` stores the actual accepted evidence amount. Any later required refund is based on actual verified value so overpayment cannot disappear into an accounting crack.

## 10. Payment verification starts the five-minute SLA

When payment is verified, in one DB transaction the server stores evidence, records `payment_verified_at`, sets `revive_deadline = payment_verified_at + 5 minutes`, moves transaction/request to `WAITING_FOR_REVIVE`, appends history/audit, and enqueues `revive.verify`.

The five-minute timer begins only at server-verified payment, never at Accept and never from a client clock.

## 11. Revive-attempt verification

The worker uses current Torn revive evidence, including incoming/outgoing direction where supported, plus narrowly scoped logs/status where needed.

Each genuine assigned-reviver attempt is stored immutably with unique Torn evidence ID, sequence number, timestamp and success/failure.

Outcomes:

- assigned success -> `COMPLETED`;
- genuine assigned failure -> `FAILED_ATTEMPT_CHOICE`, explicitly not misconduct;
- requester chooses retry -> `RETRY_OFFERED`;
- reviver accepts retry -> new five-minute `WAITING_FOR_REVIVE` window and next sequence;
- reviver declines/times out -> `REFUND_REQUIRED`;
- requester chooses refund after failure -> `REFUND_REQUIRED`.

No additional payment is required for an approved retry.

## 12. Third-party revive, self-exit and natural expiry

If another player successfully revives the requester after verified payment and before assigned completion, service becomes impossible and the transaction moves to refund-required with reason `third_party_revive`.

If the requester leaves hospital through a self-directed action with no third-party revive, no refund is due and the transaction closes `CLOSED_REQUESTER_EXIT`.

If hospital time naturally expires, no refund is due and the transaction closes `CLOSED_NATURAL_EXPIRY`.

If evidence is ambiguous, ReviveRelay does not guess. It retries within a bounded reconciliation window and, if still unresolved, records an unresolved evidence condition for Stage 4 review rather than assigning misconduct.

## 13. No-attempt deadline

At the five-minute deadline the worker performs a final evidence reconciliation pass. API propagation grace does not change the contractual deadline.

If no qualifying assigned attempt exists and no legitimate exit outcome explains closure, state becomes `REPORTABLE_NO_ATTEMPT`. Stage 4 consumes this evidence-backed state for report/suspension workflow; Stage 3 does not auto-ban.

## 14. Refund workflow

Refund-required reasons include failed-attempt refund choice, retry decline/timeout, third-party revive, late payment, and future admin decisions.

On entry:

- `refund_required_at = now()`;
- `refund_deadline = refund_required_at + 10 minutes`;
- refund record is created idempotently;
- `refund.verify` is enqueued.

Required refund uses the same method and actual verified payment amount/quantity. Split refunds may aggregate. A child `refund_evidence` table stores unique Torn evidence IDs.

Successful refund -> `REFUNDED` and request closes.

At the ten-minute deadline the worker does a final reconciliation. Evidence proving an on-time refund despite delayed API visibility is accepted. Otherwise state becomes `REPORTABLE_MISSING_REFUND`; Stage 4 handles protective suspension/report review.

## 15. Worker architecture

Stage 3 implements:

- `payment.verify`
- `revive.verify`
- `refund.verify`

Handlers stay thin and delegate to focused credential, Torn evidence, matcher and transaction-transition services.

Jobs are idempotent and return an explicit result: complete, reschedule, blocked on credential/service condition, retryable Torn failure, or terminal internal data error.

Torn 429/5xx/timeouts never create misconduct states. They emit sanitized telemetry, use bounded backoff/jitter and preserve contractual timestamps for later evidence-time comparison.

Worker heartbeat remains critical monitoring data.

## 16. Torn API discipline

Use current Torn API v2/current supported routes where practical.

Relevant current constraints/capabilities include user revive data with incoming/outgoing filtering, `user/log` as a separate selection, category-restricted custom log access, key/info reporting allowed categories, and Torn rate limits.

Implementation requests narrow transaction time windows, only relevant log categories/types, stops using invalid keys, and centralizes backoff to avoid bursts.

Exact log category/type IDs are configuration/test fixtures derived from Torn's current metadata and are never guessed from stale posts.

## 17. Stage 3 client UI

Options show identity connection, transaction credential state, validated requester/reviver capabilities, last validation, Rebind/Revoke, and a clear evidence-access disclosure. Plaintext key values are never redisplayed.

Requester UI gates request creation on sufficient verification access and then shows assigned reviver identity, agreed payment, authoritative state/deadlines, server-derived countdown, payment check convenience action, failed-attempt retry/refund choice, refund status and terminal outcome.

Reviver UI adds registration/verification state, available request queue, Accept, assigned requester/terms, payment status, revive deadline, retry response and refund-required countdown.

Automatic revive execution remains out of scope; the reviver acts in Torn.

## 18. API contract additions

Credential:

- `GET /v1/verification-credential`
- `POST /v1/verification-credential`
- `DELETE /v1/verification-credential`

Reviver:

- `POST /v1/reviver/register`
- `GET /v1/reviver/queue`
- existing Accept route extended with eligibility gates

Transaction:

- `GET /v1/transactions/:id`
- `POST /v1/transactions/:id/check-payment`
- `POST /v1/transactions/:id/retry-request`
- `POST /v1/transactions/:id/retry-response`
- `POST /v1/transactions/:id/request-refund`
- `POST /v1/transactions/:id/check-refund`

Clients request actions/checks. They never submit arbitrary target states.

## 19. Automatic error telemetry

ReviveRelay automatically collects sanitized operational errors from userscript errors/unhandled rejections, meaningful API operation failures, Fastify/API faults, worker failures, Torn transport/rate/response faults, DB/migration failures, and backup/health failures when connected to telemetry.

Telemetry transport failure never recursively reports itself.

Stage 3 adds a tightly rate-limited `POST /v1/telemetry/errors`. Auth is optional because startup can fail before a session exists. Valid sessions may associate an internal user ID for affected-user counts, but Google Sheets never receives Torn IDs from error telemetry. Unauthenticated occurrences do not store durable IP identity.

Allowed bounded fields include component, version/build, severity hint, error name/code, sanitized message/stack, operation/context and safe route name.

Forbidden data includes Torn keys, ReviveRelay session tokens, Authorization headers, cookies, DB/encryption/Google credentials, chat messages, requester comments, evidence bodies, arbitrary request/response bodies, full secret-bearing URLs, and unrelated Torn player data.

The server fingerprints normalized product/component/error/message/top-stack/version data. One repeated fault becomes one `error_group` rather than thousands of Sheet rows.

Add:

`error_groups`
- unique fingerprint;
- product/component/severity/summary;
- representative sanitized stack;
- first/last seen;
- occurrence count;
- first/last version;
- last build commit.

`error_occurrences`
- error group;
- optional internal user ID;
- source/version/build;
- sanitized context;
- occurred time;
- bounded sanitized diagnostics.

Raw occurrence retention target is 30 days; aggregate groups at least 24 months.

Client-side storm protection deduplicates bursts, batches boundedly, caps the queue and never blocks gameplay on telemetry delivery.

## 20. Google Sheet error-triage mirror

Use a common human-triage document such as `Voidsmith Error Triage`, initially with a ReviveRelay issues tab. This is external reporting only and does not weaken database isolation.

One row per fingerprint.

Automatic columns:

- Product
- Fingerprint
- Severity
- Component
- First Version
- Last Version
- Summary
- Occurrences
- Affected Authenticated Users
- First Seen
- Last Seen
- Last Build Commit
- Last Sync

Manual columns preserved by the exporter:

- Status (`New`, `Investigating`, `Fixed`, `Ignored`)
- Owner
- Notes
- GitHub Issue
- Fixed In

`sheets.mirror` starts at a 15-minute cadence, updating only automatic columns and preserving manual work. Sheet edits never mutate users, transactions, credentials, bans or subscriptions.

Google Sheets API/service-account credentials are server secrets outside PostgreSQL and Git. If Google is unavailable, ReviveRelay continues normally and keeps telemetry in PostgreSQL until export recovers.

## 21. Version and release manifest

Stage 3 adds public-safe read-only `GET /v1/client/version` with stable/latest/minimum version, release timestamp/notes, Git commit and SHA-256 hashes/URLs for automatic and manual direct-distribution artifacts.

No executable code is returned by the manifest endpoint.

Historical release records store version/channel, minimum supported version, timestamp, notes, Git commit, artifact hashes/paths and mandatory/security flag.

## 22. Genuine automatic vs manual update modes

ReviveRelay never downloads and `eval`s remote executable code.

To provide a real automatic/manual distinction, direct Voidsmith distribution builds two metadata variants from the same verified source.

### Automatic

`reviverelay.user.js` contains `@version`, `@updateURL` and `@downloadURL`. Tampermonkey/userscript manager performs actual replacement according to its security/permission settings. ReviveRelay's own manifest check occurs at most once per 24 hours for UI/release notes/minimum-version state.

### Manual

`reviverelay-manual.user.js` disables native automatic direct-channel checks using supported userscript metadata behavior. ReviveRelay checks its manifest at most once per 24 hours and, when newer, shows current/latest version, short notes, Update/View Update and Remind Me Later. Update opens the canonical manual artifact so the userscript manager presents its normal install/update confirmation.

### Switching modes

Because update metadata is static, a runtime toggle alone cannot truly change update behavior. Options therefore expose Automatic/Manual and provide a one-time `Switch update mode` installation when desired mode differs from the installed artifact channel. Both variants share source/version/namespace/storage keys.

### Greasy Fork

Greasy Fork strips custom update/download URLs and uses its own update mechanism. For Greasy Fork installs, manager/Greasy Fork settings govern actual replacement; ReviveRelay may show notices but does not bypass caching/rules or inject remote executable code.

## 23. Minimum supported version gate

Server tracks `minimumVersion` separately from `latestVersion`.

Protected mutations include an `X-ReviveRelay-Version` header. When below minimum, session/update/read-only status may remain available where compatible, but request creation, accept and other protected mutations return `CLIENT_UPDATE_REQUIRED`.

The server, not the update banner, enforces this.

## 24. Release publication pipeline

Only verified `main` can publish.

1. feature work completes in isolation;
2. tests pass;
3. merge to `main`;
4. verify merged `main`;
5. build automatic/manual artifacts from identical source;
6. syntax/tests validate both;
7. compute SHA-256;
8. create immutable versioned release directory;
9. atomically update release record/manifest;
10. move stable install pointers only after verification;
11. update Source of Truth.

Never publish a dirty worktree/unverified branch artifact.

Suggested layout:

```text
/srv/voidsmith/torn-platform/reviverelay/releases/
  0.4.2/
    reviverelay.user.js
    reviverelay-manual.user.js
    manifest.json
    checksums.sha256
```

## 25. Version-aware telemetry

Every error event carries client/server version and build commit where known. Error groups retain first/last affected versions, enabling regression detection across releases instead of a sheet full of duplicate stack traces.

## 26. Security boundaries for telemetry/releases

- manifest is read-only/public-safe;
- userscript sessions cannot publish releases;
- no client endpoint accepts executable uploads;
- artifacts are generated from repository source;
- hashes are recorded before publication;
- telemetry cannot mutate transaction state;
- telemetry is aggressively redacted;
- Google Sheet exporter is one-way;
- Google/release/deploy secrets stay outside PostgreSQL/Git;
- existing DB/network isolation remains unchanged.

## 27. Error vocabulary

Stage 3 adds/standardizes errors including:

- `AUTH_REQUIRED`
- `VERIFICATION_CREDENTIAL_REQUIRED`
- `VERIFICATION_CREDENTIAL_INSUFFICIENT`
- `VERIFICATION_CREDENTIAL_INVALID`
- `REQUEST_UNAVAILABLE`
- `TRANSACTION_STATE_CONFLICT`
- `PAYMENT_NOT_YET_FOUND`
- `REFUND_NOT_YET_FOUND`
- `TORN_UNAVAILABLE`
- `RATE_LIMITED`
- `CLIENT_UPDATE_REQUIRED`

Transient service failures remain distinct from user misconduct/terminal outcomes.

## 28. Testing strategy

Stage 3 is TDD-first.

Credential tests cover identity-key discard, ownership, exact scope, plaintext leakage, atomic rebind/revoke and invalid-key pause behavior.

Reservation/payment tests cover accept race, repeat acceptance after unpaid expiry with historical rows preserved, on-time/late/no payment, split Cash/Xanax, duplicate evidence and overpayment refund basis.

Revive tests cover assigned success/failure, retry, third-party revive, self-exit, natural expiry, ambiguity and no-attempt final reconciliation. A genuine failed revive must never be mislabeled no-attempt fraud.

Refund tests cover exact/split Cash/Xanax, duplicate evidence, delayed API visibility and reportable missing refund.

Worker tests cover Torn 429/5xx/timeouts, invalid credentials, stale locks, concurrent workers and idempotent retries.

Telemetry tests cover secret redaction, fingerprint dedupe, concurrent counts, bounded client storms, endpoint rate limits, no recursion, Sheet manual-column preservation and Sheet outage independence.

Update/release tests cover deterministic version comparison, at-most-daily manifest checks, identical application code across metadata variants, correct auto/manual metadata, matching hashes, server minimum-version blocking and explicit prohibition of remote `eval`/Function/dynamic executable injection.

Existing deployment isolation, backup and disposable restore tests remain mandatory.

## 29. Implementation decomposition

1. schema/state-history/repeat-reservation migration;
2. transaction-verification credential binding/validation;
3. payment evidence engine;
4. revive evidence/outcome engine;
5. retry/refund evidence engine;
6. transaction/reviver API and client UI;
7. error telemetry datastore/ingestion/redaction;
8. Google Sheet error-triage exporter;
9. release manifest/minimum-version gate;
10. auto/manual release artifact pipeline and update UI;
11. internal deployment/migrations/worker activation;
12. full isolation/backups/restore/evidence verification;
13. merge verified completion to `main`.

Do not mix Stage 4 disputes/reputation/admin tooling or Stage 5 subscription billing into Stage 3.

## 30. Deferred to Stage 4

- reputation calculations/display beyond placeholders needed by transaction UI;
- report submission/evidence bundles;
- protective suspension automation after reports;
- admin dispute review;
- confirmed violation/ban workflow;
- business/admin Sheets mirrors beyond operational error triage.

## 31. Deferred to Stage 5

- 7-day Reviver Pro trial activation;
- operator Xanax subscription scanning;
- 2 Xanax / 30 days;
- 20 Xanax / 365 days and annual multiples;
- subscription stacking;
- paid feature gating;
- monetization/compliance/public release gate.

## 32. Success criteria

Stage 3 is complete only when:

1. requester/reviver protected actions are impossible without sufficient transaction-verification access;
2. identity keys remain discarded;
3. unpaid reservations safely expire and later reservations preserve history;
4. Cash/Xanax payment evidence is server-verified/idempotent;
5. five-minute SLA starts only on verified payment;
6. revive success/failure/third-party/self-exit/natural-expiry/no-attempt outcomes are evidence-derived;
7. retry/refund flows are server-timed/evidence-backed;
8. missing refund/no-attempt become reportable only after final reconciliation;
9. Torn outages/credential failures do not generate false misconduct;
10. sanitized errors dedupe in PostgreSQL and mirror one row per fingerprint to the triage Sheet without secrets;
11. errors correlate to version/build;
12. direct distribution has genuine automatic/manual channels from the same source;
13. manifest checks occur no more than once per 24 hours;
14. obsolete clients can be blocked server-side from protected mutations;
15. no remote executable-code/self-`eval` updater exists;
16. all tests/build/isolation/backup/restore checks pass;
17. production DB remains completely separate from every other Voidsmith database;
18. public paid launch remains disabled until Stages 4/5/compliance are complete;
19. completed verified Stage 3 work is merged to `main`.

## 33. External capability notes reviewed 2026-08-26

- Torn API v2 remains current/evolving, so implementation validates against current schemas.
- Torn supports category-restricted custom `user/log` access and v2 key information exposes allowed categories.
- `user/log` is requested separately rather than bundled with unrelated selections.
- Torn documents API rate limits and the need to stop using invalid keys.
- Tampermonkey uses `@version` for update comparison and supports `@updateURL` / `@downloadURL`.
- Greasy Fork strips custom update/download URLs for Greasy-Fork-installed scripts and prohibits script-initiated update checks more frequently than once per day.

These are constraints, not reasons to weaken ReviveRelay's server-side evidence/version controls.
