# ReviveRelay Stage 3 Marketplace Verification Design

Date: 2026-08-26
Status: Approved design, pending written-spec review
Repository: `R4G3RUNN3R/torn-revive-chat-collector`
Base: `main` at `296a8017defc96b86dbd30f577fead56a8061a41`
Parent design: `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

## 1. Purpose

Stage 3 turns ReviveRelay from a request/candidate client with an isolated backend into an evidence-backed paid-revive marketplace.

The server becomes authoritative for:

- transaction-verification credential eligibility;
- request reservation and acceptance;
- the three-minute payment window;
- Cash and Xanax payment verification;
- the five-minute revive SLA;
- revive-attempt verification;
- retry/refund handling after a genuine failed attempt;
- third-party revive, requester self-exit and natural hospital expiry outcomes;
- the ten-minute refund window;
- evidence-backed no-attempt and missing-refund outcomes;
- sanitized operational error telemetry and Google Sheet triage mirroring;
- userscript release/version metadata, update channels and minimum-supported-version enforcement.

Stage 3 does not yet implement the full human dispute/reputation/admin workflow or Reviver Pro billing. Those remain Stages 4 and 5.

## 2. Non-negotiable constraints

1. ReviveRelay PostgreSQL remains physically/logically isolated from every other Voidsmith product database.
2. ReviveRelay receives no DungeonMasterOS, Nexis, CIEL, website, Guacamole or other project database credentials.
3. Identity-only Torn API keys are verified and discarded. They are never persisted.
4. Persistent Torn credentials are a separate `transaction_verification` credential, minimally scoped and encrypted at rest with an encryption key held outside PostgreSQL.
5. A protected paid transaction cannot begin unless both sides have enough evidence access to adjudicate it.
6. Browser/client claims are never proof of payment, revive, refund or deadline compliance.
7. Contractual timers derive from PostgreSQL/server timestamps, never client clocks.
8. Torn outages, revoked credentials or ambiguous evidence never create automatic misconduct findings.
9. Public-chat privacy boundaries from Stages 1/2 remain unchanged.
10. `PAID_TIER_ENABLED=false` remains in force throughout Stage 3 implementation and internal testing.
11. Public DNS/Caddy exposure remains a separate launch gate. Stage 3 must not expose PostgreSQL or bypass the localhost-only API architecture.
12. Completed and verified work is merged to `main`.

## 3. Current foundation this design extends

Current `main` already contains:

- isolated PostgreSQL 16, API and worker containers;
- a PostgreSQL job queue using row locking / `SKIP LOCKED`;
- users, sessions, `api_credentials`, revivers, requests, transactions, payments, attempts, refunds, disputes, bans, subscriptions, audit events and jobs;
- atomic request acceptance;
- public-candidate ingestion/deduplication;
- Stage 2 client onboarding, Live Capture, candidate-only submission and free requester UI;
- identity binding that persists no Torn API credential.

Existing worker job names reserve:

- `payment.verify`
- `revive.verify`
- `refund.verify`
- `subscription.scan`
- `sheets.mirror`

Stage 3 implements the first three. `subscription.scan` remains inactive until Stage 5. `sheets.mirror` is used in Stage 3 only for operational error triage; business/admin mirroring remains Stage 4.

## 4. Transaction-verification credential model

### 4.1 Identity remains one-time verification

`POST /v1/auth/bind` remains identity-only:

1. verify Torn identity through current Torn key information;
2. issue an opaque ReviveRelay session;
3. discard the supplied identity key;
4. create no `api_credentials` row.

### 4.2 Separate persistent credential flow

Stage 3 adds authenticated endpoints:

- `GET /v1/verification-credential`
- `POST /v1/verification-credential`
- `DELETE /v1/verification-credential`

`POST` accepts plaintext only for the request lifetime. The backend:

1. verifies that the key belongs to the authenticated Torn player;
2. validates the exact selections/log categories Torn reports through current key metadata;
3. rejects a key that is insufficient or grants unapproved unrelated access;
4. derives whether it provides requester capability, reviver capability, or both;
5. encrypts the key with AES-256-GCM using the application encryption key outside PostgreSQL;
6. atomically revokes any previous active `transaction_verification` credential for that user;
7. stores only ciphertext, IV, authentication tag and validated non-secret access metadata;
8. records a non-secret audit event.

Plaintext credentials are never returned, logged, mirrored to Sheets or embedded in error telemetry.

### 4.3 Database credential purpose

`api_credentials` gains an explicit `purpose`, initially:

`transaction_verification`

Only one active credential of that purpose may exist per user.

The stored access metadata represents what ReviveRelay actually validated, not what the client says the key can do.

### 4.4 Requester scope

Requester capability uses the narrowest current Torn access needed to determine:

- authenticated identity;
- incoming revive evidence;
- hospital/status evidence needed to distinguish third-party revive, requester self-exit and natural expiry.

Payment receipt and refund sending are primarily proved from the assigned reviver's credential, so the requester is not forced to grant unrelated money/item access merely as a duplicate source.

Unrelated battle stats, messages, inventory, faction data, company data and private communications are forbidden.

### 4.5 Reviver scope

Reviver capability uses the narrowest current Torn access needed for:

- outgoing revive evidence;
- incoming Cash payment evidence;
- incoming item/Xanax payment evidence;
- outgoing Cash refund evidence;
- outgoing item/Xanax refund evidence.

Where Torn custom-key category restrictions are available, ReviveRelay requires category-limited `user/log` access instead of unrestricted log access.

### 4.6 Revoked/narrowed credentials during a live transaction

Credential problems do **not** become a business transaction state and do not rewrite contractual deadlines.

Instead, transactions may carry a verification hold:

- `verification_hold_reason`
- `verification_hold_started_at`
- non-secret hold metadata

The underlying business state remains unchanged. The worker stops making misconduct/terminal evidence decisions while required access is unavailable, prompts rebind, and later reconciles recovered Torn evidence against the **original** payment/revive/refund deadlines.

New protected requests/acceptances are blocked while a required credential is unusable. Repeated invalid-key calls are stopped/backed off so ReviveRelay does not hammer Torn.

If evidence cannot be restored conclusively, Stage 3 records an unresolved evidence condition for Stage 4 review rather than guessing.

## 5. Protected-transaction eligibility gate

A requester may create a protected request only with a current requester-capable transaction-verification credential.

A reviver may view/accept protected jobs only when all are true:

- authenticated ReviveRelay session;
- registered reviver record;
- standing `active`;
- no active ban;
- current reviver-capable transaction-verification credential.

Stage 5 later adds Reviver Pro entitlement. It is deliberately not active while Stage 3 is under internal development/testing.

The server enforces these gates.

## 6. Repeat reservations must preserve history

The Stage 1 schema currently has `transactions.request_id UNIQUE`. That cannot support returning an unpaid request to the queue.

Stage 3 changes the model:

- one revive request may have multiple historical reservation/transaction rows;
- every acceptance creates a new immutable transaction row;
- at most one open transaction exists for a request at once;
- an expired unpaid reservation closes instead of being overwritten;
- the request returns to `AVAILABLE` only after that reservation is safely closed;
- a later acceptance creates a new transaction with a new reviver and deadlines.

A partial unique index enforces one open transaction per request.

This preserves who accepted, the payment window, what evidence was seen and why each reservation closed.

## 7. Server-authoritative transaction states

### 7.1 Active business states

- `WAITING_FOR_PAYMENT`
- `PAYMENT_RECONCILING`
- `WAITING_FOR_REVIVE`
- `FAILED_ATTEMPT_CHOICE`
- `RETRY_OFFERED`
- `REFUND_REQUIRED`
- `REFUND_RECONCILING`

### 7.2 Terminal/non-active assignment states

- `PAYMENT_EXPIRED`
- `COMPLETED`
- `REFUNDED`
- `CANCELLED_BY_REQUESTER`
- `CLOSED_REQUESTER_EXIT`
- `CLOSED_NATURAL_EXPIRY`
- `REPORTABLE_NO_ATTEMPT`
- `REPORTABLE_MISSING_REFUND`

Late payment is normalized as `REFUND_REQUIRED` with `refund_reason='late_payment'`. The older `REFUND_REQUIRED_LATE_PAYMENT` concept is superseded and is migrated/translated rather than kept as a competing permanent state.

### 7.3 State history

Add append-only `transaction_state_history` containing:

- transaction ID;
- from/to state;
- transition/event code;
- actor type/user where applicable;
- server timestamp;
- non-secret metadata.

`transactions.state` remains the current fast lookup; history is never rewritten to hide earlier assignments/outcomes.

## 8. Acceptance and three-minute payment window

Atomic acceptance continues to lock the request and produce exactly one winner.

On success the server:

1. creates a new transaction;
2. records `accepted_at = now()`;
3. sets `payment_deadline = accepted_at + 3 minutes`;
4. moves the request to `WAITING_FOR_PAYMENT`;
5. appends history/audit;
6. enqueues one deduplicated `payment.verify` job immediately.

The worker polls boundedly during the window. A client `Check payment` action only expedites/enqueues the existing logical verification job; it never calls Torn directly and cannot create an unbounded pile of duplicate jobs.

The job layer therefore gains a stable deduplication key/constraint for active logical verification work.

At the payment deadline the transaction enters `PAYMENT_RECONCILING` for a short configured API-propagation grace period. The contractual three-minute deadline does not change.

After reconciliation:

- qualifying evidence timestamped on/before the payment deadline -> payment verified;
- no qualifying evidence -> close `PAYMENT_EXPIRED`, then return the request to `AVAILABLE` if the requester remains eligible;
- qualifying evidence timestamped after the payment deadline -> `REFUND_REQUIRED` with reason `late_payment`.

Unpaid expiry carries no misconduct penalty.

## 9. Payment evidence model

The assigned reviver's narrowly scoped **incoming** evidence is primary proof because ReviveRelay must prove the assigned reviver actually received value from the requester.

### Cash

Qualifying evidence matches requester Torn ID, assigned reviver, relevant Cash-transfer category/type, transaction time window and amount.

### Xanax

Qualifying evidence matches requester Torn ID, assigned reviver, Torn's canonical Xanax item identity, relevant item-transfer category/type, transaction time window and quantity.

### Split transfers

Multiple qualifying same-method transfers may aggregate until the agreed value is met.

Stage 3 therefore uses:

- one aggregate `payments` row per transaction;
- child `payment_evidence` rows with globally unique Torn evidence IDs, values and evidence timestamps.

Repeated polling is idempotent.

If qualifying transfers exceed the offer, `verified_amount` stores the actual accepted evidence amount/quantity. Any later required refund is based on actual verified value so an accidental overpayment cannot vanish into a nominal-contract loophole.

## 10. Payment verification starts the five-minute SLA

When payment becomes verified, one DB transaction:

1. stores aggregate payment/evidence;
2. sets `payment_verified_at`;
3. sets `revive_deadline = payment_verified_at + 5 minutes`;
4. moves transaction/request to `WAITING_FOR_REVIVE`;
5. appends history/audit;
6. enqueues one deduplicated `revive.verify` job.

The five-minute SLA begins only at server-verified payment, never at Accept and never from a client clock.

## 11. Revive-attempt verification

The worker uses current Torn revive evidence, including incoming/outgoing direction where supported, plus narrow hospital/log evidence only where necessary.

Each genuine assigned-reviver attempt is immutable and stores:

- unique Torn evidence ID;
- sequence number;
- attempt timestamp;
- success/failure;
- bounded non-secret evidence metadata required for later audit.

Outcomes:

- assigned success -> `COMPLETED`;
- genuine assigned failure -> `FAILED_ATTEMPT_CHOICE`, explicitly **not misconduct**;
- requester chooses retry -> `RETRY_OFFERED`;
- reviver accepts retry -> new five-minute `WAITING_FOR_REVIVE` window and next attempt sequence;
- reviver declines or the retry-response window expires -> `REFUND_REQUIRED`;
- requester chooses refund after failure -> `REFUND_REQUIRED`.

No second payment is required for an approved retry.

## 12. Third-party revive, requester self-exit and natural expiry

If a different player successfully revives the requester after verified payment and before assigned completion:

- assigned service becomes impossible;
- transaction moves to `REFUND_REQUIRED` with reason `third_party_revive`.

If the requester leaves hospital by a self-directed action with no incoming third-party revive:

- no refund is due;
- transaction closes `CLOSED_REQUESTER_EXIT`.

If hospital time naturally expires:

- no refund is due;
- transaction closes `CLOSED_NATURAL_EXPIRY`.

If evidence is ambiguous, ReviveRelay does not guess or penalize. It holds verification and retries within a bounded reconciliation window; unresolved cases become Stage 4 review material.

## 13. No-attempt deadline

At the five-minute deadline, the worker performs a final evidence reconciliation pass. API visibility grace does not alter the contractual deadline.

If no qualifying assigned attempt existed on time and no legitimate exit outcome explains closure, the transaction becomes `REPORTABLE_NO_ATTEMPT`.

Stage 4 consumes this high-confidence state for report/suspension handling. Stage 3 does not automatically ban a player.

## 14. Refund workflow

Refund reasons include:

- requester chooses refund after a genuine failed attempt;
- reviver declines/times out on requested retry;
- third-party revive makes assigned service impossible;
- late payment arrives after the reservation deadline;
- future Stage 4 administrative outcome.

On entry to `REFUND_REQUIRED`:

- set `refund_reason`;
- `refund_required_at = now()`;
- `refund_deadline = refund_required_at + 10 minutes`;
- create refund record idempotently;
- enqueue one deduplicated `refund.verify` job.

The required refund uses the same method and the **actual verified payment value**. Split refunds may aggregate.

Add child `refund_evidence` rows keyed by unique Torn evidence IDs.

Successful refund -> `REFUNDED` and request closes.

At the ten-minute deadline, final reconciliation accepts evidence proving an on-time refund even if Torn surfaced it slightly later. Otherwise the transaction becomes `REPORTABLE_MISSING_REFUND` for Stage 4 handling.

## 15. Worker architecture

Stage 3 implements:

- `payment.verify`
- `revive.verify`
- `refund.verify`

Handlers remain thin and delegate to focused units:

- transaction credential repository/decryptor;
- Torn evidence adapter;
- payment matcher;
- revive/outcome matcher;
- refund matcher;
- transaction transition service.

Jobs are idempotent and produce explicit outcomes: complete, reschedule, verification hold, retryable Torn failure, or terminal internal data error.

Torn 429/5xx/timeouts never create misconduct states. They emit sanitized telemetry, use bounded backoff/jitter and preserve original contractual timestamps for later evidence-time comparison.

Worker heartbeat remains critical operational data because server reconciliation drives marketplace timers.

## 16. Torn API discipline

Stage 3 uses current Torn API v2/current supported routes where practical.

Relevant current constraints/capabilities include:

- user revive data with incoming/outgoing filtering;
- `user/log` requested separately;
- custom keys restricted to specific log categories;
- v2 key information exposing allowed categories;
- Torn API rate limits.

Implementation:

- requests narrow `from`/`to` windows around each transaction;
- requests only relevant categories/types;
- never bundles `user/log` contrary to Torn's current behavior;
- stops polling credentials Torn reports invalid;
- centralizes retry/backoff so simultaneous jobs do not create needless bursts.

Exact log category/type IDs are current configuration/test fixtures derived from Torn's `logcategories`/`logtypes` metadata and are not guessed from stale forum examples.

## 17. Stage 3 client UI

### Verification settings

Options show:

- identity connection;
- transaction-verification state;
- validated requester/reviver capability;
- last successful validation;
- Rebind/Revoke actions;
- plain-language disclosure of evidence categories used.

Plaintext key values are never redisplayed.

### Requester

Request creation is disabled until requester verification capability is valid. Active transaction UI shows assigned reviver identity, payment terms, authoritative state/deadlines, server-derived countdowns, optional `Check payment`, failed-attempt retry/refund choice, refund state and terminal result.

### Reviver

Add registration/verification state, available direct-request queue, Accept, assigned requester/terms, payment status, revive deadline, retry response and refund-required countdown.

Automatic revive execution is out of scope. The reviver performs the revive in Torn.

## 18. API additions

Credential:

- `GET /v1/verification-credential`
- `POST /v1/verification-credential`
- `DELETE /v1/verification-credential`

Reviver:

- `POST /v1/reviver/register`
- `GET /v1/reviver/queue`
- existing Accept route extended with verification/standing eligibility

Transaction:

- `GET /v1/transactions/:id`
- `POST /v1/transactions/:id/check-payment`
- `POST /v1/transactions/:id/retry-request`
- `POST /v1/transactions/:id/retry-response`
- `POST /v1/transactions/:id/request-refund`
- `POST /v1/transactions/:id/check-refund`

Every transaction read/action is authorized to the requester, assigned reviver or future administrator role as appropriate. Clients request actions/checks; they never submit arbitrary target states.

## 19. Automatic error telemetry

### 19.1 Sources

Capture sanitized operational errors from:

- userscript `error` events;
- unhandled promise rejections;
- meaningful client/API operation failures;
- Fastify/API faults;
- worker handler failures;
- Torn transport/rate/invalid-response failures;
- database/migration failures;
- backup/health failures when wired to the telemetry adapter.

Telemetry transport failure never recursively reports itself.

### 19.2 Client ingestion

Add tightly rate-limited:

`POST /v1/telemetry/errors`

Authentication is optional because startup may fail before session restore. When a valid session exists, an occurrence may reference the internal user ID for affected-user counts. Google Sheets never receives those user IDs.

Unauthenticated telemetry does not persist IP addresses merely for tracking. Infrastructure may still use IPs transiently for rate limiting.

### 19.3 Allowed/forbidden data

Allowed bounded fields:

- product/component/source;
- client/server version and build commit;
- severity hint;
- error name/code;
- sanitized message;
- bounded sanitized stack;
- operation/context code;
- safe route name without secret query data.

Never store/export:

- Torn API keys;
- ReviveRelay bearer/session tokens;
- Authorization headers;
- cookies;
- DB/encryption/Google credentials;
- raw chat messages;
- requester comments;
- payment/revive/refund API payload bodies;
- arbitrary request/response bodies;
- full URLs containing tokens/query secrets;
- unrelated Torn player data.

Redaction happens client-side where practical and again server-side.

### 19.4 Fingerprints and version regression tracking

The server fingerprint intentionally **does not include application version**. Otherwise the same bug would become a different issue row in every release.

Fingerprint basis is normalized:

`product + component + error code/type + message template + top stack signature`

One repeated fault becomes one `error_group`.

Version impact is tracked separately so the same group can show, for example, 3 occurrences on 0.4.2, 812 on 0.4.3 and 4 on 0.4.4.

Add:

`error_groups`
- unique fingerprint;
- product/component/severity/summary;
- representative sanitized stack;
- first/last seen;
- total occurrence count;
- first/last affected version;
- last build commit.

`error_occurrences`
- error group;
- optional internal user ID;
- source/version/build;
- sanitized context;
- occurred time;
- bounded diagnostics.

`error_group_versions`
- error group + version unique;
- occurrence count;
- first/last seen;
- last build commit.

Raw occurrences retain for about 30 days. Aggregate groups/version statistics retain at least 24 months.

### 19.5 Client storm protection and disclosure

The client deduplicates bursts, sends bounded batches, caps the queue and drops/aggregates repeated noise rather than consuming unbounded storage.

Options/onboarding disclose sanitized diagnostic telemetry. A user may disable optional **client** diagnostic submission; server/API/worker operational errors and security/audit records remain server-side because they are necessary to operate the service safely.

Telemetry delivery never blocks Torn/ReviveRelay UI behavior.

## 20. Google Sheet error-triage mirror

Create/use a common human-triage document such as `Voidsmith Error Triage`, initially with a ReviveRelay issues tab. This is external reporting only and does not join/share application databases.

One row per fingerprint.

Automatic columns:

- Product
- Fingerprint
- Severity
- Component
- First Version
- Last Version
- Version Breakdown
- Summary
- Occurrences
- Affected Authenticated Users
- First Seen
- Last Seen
- Last Build Commit
- Last Sync

Manual columns that exporter must preserve:

- Status (`New`, `Investigating`, `Fixed`, `Ignored`)
- Owner
- Notes
- GitHub Issue
- Fixed In

`sheets.mirror` starts at a 15-minute cadence. It identifies rows by fingerprint, updates automatic columns only, appends new groups and preserves human columns.

Sheet edits never mutate ReviveRelay users, transactions, credentials, bans, subscriptions or error-group truth.

Google Sheets API/service-account credentials are server secrets outside PostgreSQL and Git. If Google export fails, ReviveRelay continues operating and retains telemetry until sync recovers.

Critical/high-severity groups may also feed a deduplicated operator-alert adapter once a provider credential is configured; alert delivery is secondary and cannot affect transaction processing.

## 21. Version/release manifest

Add public-safe read-only:

`GET /v1/client/version`

It returns stable/latest/minimum version, release timestamp/notes, Git commit and SHA-256/URLs for direct automatic/manual artifacts.

No executable code is returned from the manifest endpoint.

Add immutable release records containing version/channel, minimum supported version, timestamp, notes, Git commit, artifact hashes/paths and mandatory/security flag.

During Stage 3 internal testing the manifest/artifacts are tested via internal/local routing. Public `reviverelay.voidsmithindustries.com` install/version paths are not activated until the separate launch/DNS/Caddy gate.

## 22. Genuine automatic vs manual update modes

ReviveRelay never downloads and `eval`s remote executable code.

Direct Voidsmith distribution builds two metadata variants from the **same verified application source**.

### 22.1 Automatic channel

Artifacts:

- `reviverelay.meta.js` containing update metadata/header;
- `reviverelay.user.js` containing the full automatic-channel script.

The automatic script contains `@version`, `@updateURL` and `@downloadURL`. The userscript manager performs actual replacement under its security/permission settings.

ReviveRelay's own release-manifest check occurs at most once per 24 hours for release notes, compatibility and minimum-version state.

### 22.2 Manual channel

`reviverelay-manual.user.js` uses supported userscript metadata to disable native direct-channel update checks, specifically `@downloadURL none`, and does not rely on a custom automatic update URL.

The script checks the ReviveRelay manifest at most once per 24 hours. When newer, it shows:

- current/latest version;
- short release notes;
- Update/View Update;
- Remind Me Later.

Update opens the canonical manual artifact so the userscript manager presents its normal installation/update confirmation.

### 22.3 Switching update mode

Because update metadata is static, a runtime Boolean cannot truly change update behavior.

Options expose `Update mode: Automatic / Manual`. If desired mode differs from the installed artifact channel, a one-time `Switch update mode` action opens the corresponding canonical artifact.

Both variants share source, version, namespace and normal ReviveRelay storage/session keys.

### 22.4 Greasy Fork

Greasy Fork strips custom update/download URLs for scripts installed from Greasy Fork. Therefore:

- Greasy Fork/userscript-manager settings govern actual installation updates;
- ReviveRelay's own version check remains at most once per day;
- ReviveRelay may show compatibility/security notices;
- ReviveRelay never bypasses Greasy Fork caching/rules with dynamic executable injection.

## 23. Minimum supported version gate

Server tracks `minimumVersion` independently from `latestVersion`.

Protected mutation requests include:

`X-ReviveRelay-Version`

If below minimum:

- version endpoint remains available;
- authentication/session/read-only status may remain available where protocol-compatible;
- protected mutations such as request creation/accept/retry/refund actions return `CLIENT_UPDATE_REQUIRED`.

A modified old client cannot bypass this by hiding its update banner because compatibility is enforced server-side.

## 24. Release publication pipeline

Only verified `main` may publish a release.

1. feature work completes in isolation;
2. automated tests pass;
3. completed work merges to `main`;
4. full verification runs on merged `main`;
5. build generates automatic/manual artifacts and automatic `.meta.js` from identical source/version;
6. syntax/tests validate all artifacts;
7. SHA-256 hashes are calculated;
8. immutable versioned release directory is created;
9. release record/manifest is updated atomically;
10. stable pointers move only after artifact verification;
11. Source of Truth is updated.

Never publish a dirty working tree or unverified branch artifact.

Suggested layout:

```text
/srv/voidsmith/torn-platform/reviverelay/releases/
  0.4.2/
    reviverelay.meta.js
    reviverelay.user.js
    reviverelay-manual.user.js
    manifest.json
    checksums.sha256
```

## 25. Version-aware telemetry

Every error occurrence carries client/server version and build commit where known. `error_group_versions` keeps per-version counts, so the Sheet can reveal release regressions without splitting one logical bug into many fingerprints.

## 26. Security boundaries for telemetry/releases

- manifest is read-only/public-safe;
- userscript sessions cannot publish releases;
- no client endpoint accepts executable uploads;
- published artifacts are built from repository source;
- hashes are recorded before publication;
- telemetry cannot mutate transaction state;
- telemetry is aggressively redacted;
- Google Sheet flow is one-way;
- Google/release/deploy secrets stay outside PostgreSQL/Git;
- existing DB/network isolation remains unchanged.

## 27. Stable Stage 3 error vocabulary

Where applicable:

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

### Credentials

- identity bind still creates zero API credentials;
- transaction credential must belong to authenticated Torn ID;
- insufficient or unrelated/broad scope rejected;
- plaintext never returned/logged;
- rebind atomically revokes old credential;
- revoked Torn credential creates verification hold, not player penalty;
- restored credential reconciles against original deadlines.

### Reservation/payment

- second reviver cannot accept active reservation;
- unpaid expiry closes first transaction and allows a new transaction for the same request;
- historical reservations remain queryable;
- check-payment spam does not create duplicate jobs;
- payment before deadline starts five-minute SLA only after verification;
- late payment enters normalized late-payment refund reason;
- no payment returns request to available without penalty;
- split Cash/Xanax aggregate correctly;
- duplicate Torn evidence never double-counts;
- overpayment refund basis equals actual verified amount.

### Revive/outcomes

- assigned success -> completed;
- genuine failure -> failed-attempt choice;
- retry acceptance -> new five-minute attempt sequence;
- retry decline/timeout -> refund required;
- third-party revive -> refund required;
- requester self-exit -> no-refund terminal;
- natural expiry -> no-refund terminal;
- ambiguous evidence does not guess/penalize;
- no attempt becomes reportable only after final reconciliation;
- a failed revive is never labeled no-attempt fraud.

### Refund

- exact/split Cash and Xanax refunds accepted;
- duplicate evidence idempotent;
- on-time refund visible late accepted;
- missing refund becomes reportable only after final reconciliation.

### Worker/outage

- Torn 429/5xx/timeouts reschedule without misconduct;
- invalid key stops repeated calls;
- stale locks reclaimed;
- concurrent workers do not process one logical job twice;
- retries are idempotent.

### Telemetry

- keys/tokens/headers/payloads redacted;
- same error across versions stays one fingerprint/group;
- per-version counts update correctly;
- concurrent occurrence/affected-user counts are safe;
- client storm bounded;
- endpoint rate-limited;
- telemetry failure not recursive;
- client diagnostic opt-out honored;
- Sheet sync preserves manual columns;
- Sheet outage cannot stop marketplace behavior.

### Update/release

- deterministic version comparison;
- client manifest check no more than once per 24 hours;
- automatic/manual artifacts share identical application code;
- automatic metadata points to correct `.meta.js`/download path;
- manual artifact contains `@downloadURL none` and no competing direct auto-update behavior;
- hashes match generated artifacts;
- minimum-version gate blocks protected mutations server-side;
- supported/current clients remain allowed;
- version endpoint remains available to blocked clients;
- no remote `eval`, Function-constructor loading or dynamic executable-code injection exists.

### Isolation

Existing deployment-isolation, backup and disposable restore checks remain mandatory.

## 29. Implementation decomposition

1. schema/state-history/repeat-reservation/job-dedupe migration;
2. transaction-verification credential binding/validation;
3. payment evidence engine;
4. revive evidence/outcome engine;
5. retry/refund evidence engine;
6. transaction/reviver API and client UI;
7. error telemetry datastore/ingestion/redaction;
8. Google Sheet error-triage exporter;
9. release manifest/minimum-version gate;
10. automatic/manual release build pipeline and update UI;
11. internal deployment/migrations/worker activation;
12. full isolation/backups/restore/evidence verification;
13. merge verified completion to `main`.

Do not mix Stage 4 dispute/reputation/admin implementation or Stage 5 subscription billing into Stage 3.

## 30. Deferred to Stage 4

- full reputation calculation/display;
- user report submission and evidence bundles;
- protective suspension automation after a reportable transaction;
- admin dispute review;
- confirmed violation/ban workflow;
- business/admin Sheets mirrors beyond operational error triage.

## 31. Deferred to Stage 5

- seven-day Reviver Pro trial activation;
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
3. credential failure during a transaction creates an evidence hold without rewriting deadlines or falsely penalizing either side;
4. unpaid reservations safely expire and later reservations preserve history;
5. Cash/Xanax evidence is server-verified/idempotent;
6. five-minute SLA starts only on verified payment;
7. revive success/failure/third-party/self-exit/natural-expiry/no-attempt outcomes are evidence-derived;
8. retry/refund flows are server-timed/evidence-backed;
9. missing refund/no-attempt become reportable only after final reconciliation;
10. Torn outages/credential failures do not generate false misconduct;
11. sanitized errors deduplicate in PostgreSQL and mirror one row per fingerprint to the triage Sheet without secrets;
12. the same error remains one group across releases with per-version counts;
13. direct distribution builds genuine automatic/manual channels from the same source;
14. client manifest checks occur no more than once per 24 hours;
15. obsolete clients can be blocked server-side from protected mutations;
16. no remote executable-code/self-`eval` updater exists;
17. all tests/build/isolation/backup/restore checks pass;
18. production DB remains completely separate from every other Voidsmith database;
19. public paid launch remains disabled until Stages 4/5/compliance are complete;
20. completed verified Stage 3 work is merged to `main`.

## 33. External capability notes reviewed 2026-08-26

- Torn API v2 remains current/evolving, so implementation validates against current schemas.
- Torn supports category-restricted custom `user/log` access and v2 key information exposes allowed categories.
- `user/log` is requested separately rather than bundled with unrelated selections.
- Torn documents API rate limits and the need to stop using invalid keys.
- Tampermonkey uses `@version` for update comparison and supports `@updateURL` / `@downloadURL`; `@downloadURL none` disables its update check for that artifact.
- Greasy Fork strips custom update/download URLs for Greasy-Fork-installed scripts and prohibits script-initiated update checks more frequently than once per day.

These external capabilities constrain implementation; they do not weaken ReviveRelay's server-side evidence, privacy or version controls.
