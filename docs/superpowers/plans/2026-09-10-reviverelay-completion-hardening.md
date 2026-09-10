# ReviveRelay Completion Hardening Implementation Plan

> **Execution note:** This plan implements the approved `docs/superpowers/specs/2026-09-10-reviverelay-completion-hardening-design.md`. The design is authoritative if this plan and the design ever disagree.

**Goal:** Finish the ReviveRelay 0.6.x release line by hardening only evidence-backed lifecycle/state/security defects, completing automated and real-platform acceptance, reconciling repository/release truth, and promoting one immutable accepted candidate behind an explicit production gate.

**Architecture:** Preserve the current userscript + isolated ReviveRelay backend architecture. Use the existing private review channel as the only place for candidate changes and acceptance. Stable 0.4.4 remains untouched until the final owner-approved promotion. Any shipping change after the published 0.6.4 candidate creates a new immutable patch candidate rather than overwriting 0.6.4.

**Tech:** JavaScript userscript, Node.js >=20, Node test runner, isolated Express/PostgreSQL backend, Docker Compose review runtime, Caddy reverse proxy, Git, SentinelX, real Chrome/Torn and real TornPDA acceptance.

**Current audited baseline:** active worktree `.worktrees/fix-reviverelay-trial-persistence`, branch `fix/reviverelay-trial-persistence`; package version 0.6.4; active branch 76 commits ahead of `origin/main`; stable production 0.4.4; 0.6.4 automated report freezes source commit `b6b3d24b0616c9b3f7c9607f72dd5f0a72e55274` and SHA-256 `f2ff7166e6912c6a449790412d1a82947087a64efc5eafb647971ff76e3c7a73`; desktop Torn click acceptance now proves one physical sidebar click creates exactly one request.

---

## Global execution rules

1. Do not add unrelated features during this plan. Put future ideas in a backlog note instead.
2. Before modifying shipping code, write or strengthen a test that demonstrates the required behavior or the defect. A real-platform-only defect must be captured as a regression test as soon as its mechanism is understood.
3. Never rebuild or overwrite an already published 0.6.4 review artifact in place. If shipping bytes change, determine the next unused patch version and publish a new immutable review candidate.
4. Never touch public stable 0.4.4, public paid-launch state, canonical source publication, production database contents, or Torn-facing publication without the explicit production gate in Task 10.
5. Use disposable/local databases for destructive integration tests. Never point test commands at stable or review production PostgreSQL.
6. Preserve the existing recovery branch/anchor. Never force-push.
7. Every acceptance record must include the exact candidate version and artifact hash tested.
8. Real TornPDA means the TornPDA app/runtime. Desktop viewport emulation is not TornPDA acceptance.
9. Unknown/pending/stale state must not be converted into authoritative success or failure.
10. Disabled/unlicensed/inapplicable functionality must not retain unnecessary polling, notification, high-frequency DOM scanning, or duplicated lifecycle work.

---

## Task 1: Lock the completion baseline and repair release-document truth

**Files:**
- Create: `docs/review/REVIVERELAY-COMPLETION-HARDENING.md`
- Modify: `docs/review/REVIEW-CHECKLIST.md`
- Modify only if evidence requires it: `deploy/README.md`

### Step 1: Record the exact repository and candidate baseline

Run from the active completion worktree:

```bash
git status --short --branch
git rev-parse HEAD
git log -1 --oneline --decorate
git rev-list --left-right --count origin/main...HEAD
git worktree list
node -p "require('./package.json').version"
```

Expected: clean feature worktree before plan edits, package 0.6.4, no unexplained branch movement.

Record the current stable/review runtime without changing it:

```bash
readlink -f /srv/voidsmith/torn-platform/reviverelay/releases/client/current
curl -fsS http://127.0.0.1:18730/health
curl -fsS http://127.0.0.1:18730/v1/client/version
curl -fsS http://127.0.0.1:18731/health
curl -fsS -H 'X-ReviveRelay-Channel: review' http://127.0.0.1:18731/v1/client/version
```

Do not infer artifact identity from a version string alone. Compare the review release manifest and published candidate hash to `docs/review/REVIVERELAY-0.6.4-AUTOMATED-VERIFICATION.md`.

### Step 2: Identify the actual Chrome review surface

The audited repository has no first-class browser-extension source tree. Search before describing extension parity:

```bash
find . -maxdepth 5 -type f \( -name 'manifest.json' -o -name 'background.js' -o -name 'popup.html' -o -name 'options.html' \) -print
find . -maxdepth 5 -type f | grep -Ei 'extension|chrome|review' | sort
```

Document whether the previously tested Chrome surface is the userscript, a generated review/CSP page, an operational harness outside the repository, or a separately packaged artifact. Do not mark “extension parity” complete until the artifact is named precisely.

### Step 3: Rewrite the checklist header and completion sections around the current candidate

Update `REVIEW-CHECKLIST.md` so the heading no longer claims 0.6.1. Preserve already evidenced 0.6.4 acceptance facts. Add explicit sections for:

- dormant-runtime acceptance;
- unknown/pending/stale-state acceptance;
- notification matrix;
- exact Chrome review-surface identity;
- real TornPDA acceptance;
- repository/release reconciliation;
- production hard gate.

Do not check any box merely because an automated test exists if the box requires real browser/TornPDA/Torn-review evidence.

### Step 4: Create the completion evidence ledger

`docs/review/REVIVERELAY-COMPLETION-HARDENING.md` must record:

- baseline commit, branch relation and recovery anchor;
- stable version/path/hash and review version/path/hash;
- immutable-candidate rule;
- evidence table with columns: Gate, Platform, Candidate, Artifact hash, Evidence, Status, Notes;
- defect ledger with severity, reproduction, test, fix commit/candidate, re-test evidence;
- explicit “no production action performed” line until Task 10.

### Step 5: Verify documentation consistency

```bash
grep -R -n "ReviveRelay 0.6.1 Torn Review Checklist" docs/review && exit 1 || true
grep -n "0.6.4\|TornPDA\|dormant\|pending\|production" docs/review/REVIEW-CHECKLIST.md docs/review/REVIVERELAY-COMPLETION-HARDENING.md
```

Expected: stale heading absent; all required completion concepts present.

### Step 6: Commit

```bash
git add docs/review/REVIVERELAY-COMPLETION-HARDENING.md docs/review/REVIEW-CHECKLIST.md deploy/README.md
git commit -m "docs: lock ReviveRelay completion baseline"
```

Omit `deploy/README.md` from the add command if it required no evidence-backed correction.

---

## Task 2: Prove and harden dormant runtime lifecycle

**Files:**
- Modify: `test/client-hardening.test.js`
- Modify: `test/bootstrap-controls.test.js`
- Modify as needed: `test/sidebar-action.test.js`
- Modify only if a defect is proven: `torn-revive-chat-collector.user.js`
- Modify: `docs/review/REVIVERELAY-COMPLETION-HARDENING.md`

### Step 1: Inventory lifecycle work before changing code

Inspect every `MutationObserver`, recurring timer, navigation handler, queue poller, notification poller, and repeated network path in `torn-revive-chat-collector.user.js`.

Create a table in the completion ledger classifying each as:

- bootstrap/reactivation required while dormant;
- active-feature work that must stop when disabled/unlicensed/inapplicable;
- duplicate/unnecessary work.

Do not “optimize” a lifecycle primitive without proving what wakes the client back up after Torn SPA navigation.

### Step 2: Write failing lifecycle tests first

Add focused tests that instrument/stub timers, observers, listeners and network calls. At minimum prove:

- repeated initialization does not multiply polling loops;
- Torn SPA remount/navigation does not multiply the sidebar handler;
- turning desktop notifications off suppresses notification delivery while preserving the bounded seen-ID state needed to prevent a later burst;
- unavailable/unlicensed/inapplicable Pro-only state does not continue Pro-only network work;
- stop/start is idempotent;
- the minimal reactivation surface remains alive where necessary.

Run focused tests before implementation:

```bash
node --test test/client-hardening.test.js test/bootstrap-controls.test.js test/sidebar-action.test.js
```

If the current implementation already passes a correctly constructed test, record “no shipping defect found” and do not edit production code merely to create activity.

### Step 3: Apply the smallest fix only for proven failures

Modify `torn-revive-chat-collector.user.js` only where the failing test demonstrates unnecessary dormant work or duplication. Prefer explicit lifecycle ownership and stored timer/observer handles over adding more periodic watchdogs.

### Step 4: Verify focused and complete client suites

```bash
node --test test/client-hardening.test.js test/bootstrap-controls.test.js test/sidebar-action.test.js
npm run test:client
```

Expected: all pass, no new lifecycle work added without ownership/cleanup.

### Step 5: Record evidence and commit

If tests alone locked already-correct behavior:

```bash
git commit -am "test: lock ReviveRelay dormant runtime behavior"
```

If shipping code changed:

```bash
git commit -am "fix: make dormant ReviveRelay runtime quiescent"
```

Record whether this change invalidates the 0.6.4 candidate. Any shipping change means Task 8 must create the next patch candidate.

---

## Task 3: Prove unknown, pending, stale and denied state semantics

**Files:**
- Modify: `test/client-hardening.test.js`
- Modify: `test/client-api-trust.test.js` if present; otherwise use the existing trust/privacy tests that cover the same contract
- Modify: `test/pro-ui.test.js`
- Modify: `test/subscription-mode-ui.test.js`
- Modify only if a defect is proven: `torn-revive-chat-collector.user.js`
- Modify server route/domain tests only if server behavior is the proven source of the defect
- Modify: `docs/review/REVIVERELAY-COMPLETION-HARDENING.md`

### Step 1: Map state semantics

Create an explicit matrix for:

- loading/pending;
- authoritative empty/no-data;
- active/success;
- unlicensed;
- trial;
- expired trial;
- revoked;
- unauthorized/denied;
- transport/server failure;
- stale cached state;
- unknown/not-yet-verified.

For each state define UI text, action availability, notification eligibility, cache behavior and whether authoritative refresh is required.

### Step 2: Write tests before fixes

Test at least:

- pending verification never renders as VERIFIED/READY or REVOKED/FAILED;
- transport failure never becomes authoritative unlicensed/revoked state;
- authoritative empty queue is different from failed queue fetch;
- stale cached entitlement cannot overwrite newer authoritative state;
- delayed older responses cannot overwrite newer state;
- denied/revoked state cannot leak request details through notifications;
- no-data/pending/invalid state cannot produce a desktop request notification;
- checkout/payment pending cannot render as paid until backend verification says ACTIVE.

Run focused tests and capture any red case before editing runtime code.

### Step 3: Minimal implementation fix if required

Prefer an explicit state enum/result object or narrow guards at the incorrect transition. Do not replace the existing entitlement architecture.

### Step 4: Verify

```bash
node --test test/client-hardening.test.js test/pro-ui.test.js test/subscription-mode-ui.test.js test/client-privacy.test.js
npm run test:client
npm --prefix server test
```

Expected: state distinctions are enforced at UI/action/notification boundaries.

### Step 5: Commit

Use one of:

```bash
git commit -am "test: lock ReviveRelay pending state semantics"
```

or, if shipping code changed:

```bash
git commit -am "fix: preserve authoritative ReviveRelay state semantics"
```

---

## Task 4: Audit and harden network, credential and artifact boundaries

**Files:**
- Modify as needed: `test/client-privacy.test.js`
- Modify as needed: `test/verification-credential-ui.test.js`
- Modify as needed: `test/release-dependency-verification.test.js`
- Modify as needed: `test/review-artifact-verifier.test.js`
- Modify as needed: `scripts/audit-review-release.js`
- Modify as needed: `scripts/verify-review-artifact.js`
- Modify only for proven defects: `torn-revive-chat-collector.user.js`
- Modify only for proven defects: relevant files under `server/src/security/`, `server/src/torn/`, `server/src/routes/`, or `server/src/telemetry/`
- Modify: `docs/review/REVIVERELAY-COMPLETION-HARDENING.md`

### Step 1: Build a network/credential inventory

Search the client/server/release path:

```bash
grep -R -n -E "fetch\(|XMLHttpRequest|GM_xmlhttpRequest|@connect|Authorization|api.?key|token|credential|localStorage|GM_setValue|console\.|logger" torn-revive-chat-collector.user.js src server/src scripts test | head -400
```

Classify every external destination and credential by owner, storage, transport, retention and logging exposure.

### Step 2: Add or strengthen fail-closed tests

Prove:

- client network destinations are the intended ReviveRelay/Torn API destinations only;
- non-approved off-origin destinations fail closed;
- no merchant incoming-payment credential appears in the userscript or generated review artifact;
- review-only authorization material is not embedded into public/review client bytes unless explicitly intended and non-secret;
- identity bootstrap secrets are not persisted when the design says one-time;
- persistent verification credentials are never rendered back in plaintext after connection;
- telemetry/diagnostics sanitize tokens, API keys and request-sensitive material;
- release artifacts contain no `@require`, `eval`, `new Function`, or unexpected remote executable dependency.

### Step 3: Run security/release focused tests

```bash
node --test test/client-privacy.test.js test/verification-credential-ui.test.js test/release-dependency-verification.test.js test/review-artifact-verifier.test.js
npm run audit:review
```

If any command requires a generated frozen artifact, use the existing accepted review artifact or a temporary local build. Do not publish it.

### Step 4: Fix only demonstrated defects and rerun

Any shipping change creates a new patch candidate requirement.

### Step 5: Commit

```bash
git commit -am "test: harden ReviveRelay trust boundaries"
```

or, if shipping code changed:

```bash
git commit -am "fix: harden ReviveRelay trust boundaries"
```

---

## Task 5: Run the complete automated release gate on disposable infrastructure

**Files:**
- Modify: `docs/review/REVIVERELAY-COMPLETION-HARDENING.md`
- Create or update the candidate-specific automated verification report only with fresh evidence

### Step 1: Confirm clean source and candidate decision

```bash
git status --short --branch
node -p "require('./package.json').version"
git rev-parse HEAD
```

If Tasks 2-4 changed shipping bytes, do not claim 0.6.4 remains the candidate. Proceed to Task 8 to mint the next patch candidate before final candidate-wide evidence. Task 5 may still be run as a pre-candidate verification pass.

### Step 2: Run the repository-defined complete gate

Current package contract:

```bash
npm test
npm run build
npm run check
npm run audit:review
npm run verify:review
```

`npm test` must include both client and server suites. `verify:review` must verify the candidate artifact, client tests, server tests, syntax, release smoke, dependency verification, static audit, and final artifact verification.

### Step 3: Use disposable PostgreSQL for tests that need state

If the current test harness needs PostgreSQL, create a disposable PostgreSQL 16 container bound only to `127.0.0.1` or an isolated Docker network. Point test-only environment variables at that database. Never use the stable/review production database.

After the suite, remove the disposable container and verify it is gone.

### Step 4: Capture exact evidence

Record:

- git commit;
- candidate version;
- generated/frozen artifact path;
- SHA-256;
- exact test counts from current output;
- audit result;
- server test result;
- syntax result;
- disposable DB/container identity and removal confirmation.

Do not copy old 0.6.4 test counts forward if the source changed.

### Step 5: Commit evidence only after verification

```bash
git add docs/review/
git commit -m "test: record ReviveRelay completion verification"
```

---

## Task 6: Complete real desktop Chrome/Torn acceptance

**Files:**
- Modify: `docs/review/REVIEW-CHECKLIST.md`
- Modify: `docs/review/REVIVERELAY-COMPLETION-HARDENING.md`
- Modify production/tests only if acceptance exposes a defect

This task is manual/browser evidence work against the exact immutable review candidate.

### Step 1: Pin the artifact being tested

Before opening Torn, record:

```bash
sha256sum <exact-review-userscript-path>
git rev-parse HEAD
```

Also record browser version, userscript manager/version, account role under test, and review API version response.

### Step 2: Finish requester and UI acceptance

Prove in real Torn desktop:

- clean load and reload;
- sidebar re-mount across Torn SPA navigation;
- one click produces one request and never two;
- active request display and cancellation;
- self-revive protection;
- grouping/filter/sort;
- verification and explicit unverified/revoked/unauthorized states;
- no-data and transport-failure distinction;
- compact/responsive behavior at realistic desktop widths;
- keyboard/focus behavior for interactive controls.

The already recorded 0.6.4 one-click/one-POST evidence remains valid only if no later shipping candidate change affects that path.

### Step 3: Finish entitlement/subscription acceptance

Using controlled review conditions, prove:

- requester remains free;
- eligible reviver one-time trial behavior;
- reinstall does not reset the one-time trial;
- expired trial returns to unlicensed behavior;
- OWNER lifetime Pro behavior;
- paid invoice remains pending until backend evidence verifies it;
- correct monthly/6-month/yearly values and receiver identity;
- no automatic Torn cash/Xanax transfer;
- correct ACTIVE transition after verified payment evidence;
- correct return to unlicensed after entitlement expiry where feasible in review fixtures.

### Step 4: Finish desktop notification matrix

Prove:

- permission prompt/denial handling;
- enabled notification for a newly observed certified request;
- one-shot/timed behavior as supported by the product;
- deduplication;
- disabled preference persists through Torn reload;
- disabled means no desktop notification;
- no stale burst after re-enable;
- no notification on pending/unknown/failed fetch;
- no sensitive request notification when revoked/unauthorized;
- notification and queue behavior remain distinct.

### Step 5: Identify and test the Chrome review surface accurately

If there is a real packaged review harness outside this repository, record its source/path/version and test the applicable parity states. If the only repository-controlled surface is the userscript plus generated CSP/review page, state that explicitly and test only claims that artifact can actually support.

### Step 6: Failure loop

For every failure:

1. capture exact reproduction and browser evidence;
2. add a regression test where technically possible;
3. implement the minimal fix;
4. create the next immutable review candidate if shipping bytes changed;
5. rerun affected automated tests and affected desktop acceptance;
6. update the defect ledger.

Do not simply tick the box after a code edit.

### Step 7: Commit acceptance evidence

```bash
git add docs/review/
git commit -m "test: record ReviveRelay desktop acceptance"
```

---

## Task 7: Complete real TornPDA acceptance

**Files:**
- Modify: `docs/review/REVIEW-CHECKLIST.md`
- Modify: `docs/review/REVIVERELAY-COMPLETION-HARDENING.md`
- Modify production/tests only if TornPDA exposes a defect

This is a physical/runtime acceptance task. If the controller cannot operate the user's TornPDA device, stop only at the exact interaction that requires the user, provide the smallest possible action, then continue as soon as the evidence is returned.

### Step 1: Record the real environment

Capture:

- candidate version and SHA-256;
- TornPDA version;
- device OS/version;
- userscript install/update method;
- whether desktop notifications or equivalent are actually supported by TornPDA.

### Step 2: Exercise the core path

Prove:

- userscript installs/updates and boots;
- ReviveRelay control remains reachable;
- navigation/remount works inside TornPDA;
- requester create/cancel works exactly once;
- active request is visible;
- queue/group/filter/sort UI remains usable;
- self-revive block works;
- verification states remain truthful;
- trial/unlicensed/eligible behavior is correct;
- disabled controls do not leave unnecessary active work;
- pending/no-data/error/revoked states remain distinguishable;
- no duplicated requests/actions after navigation or app resume.

### Step 3: Exercise platform-specific alert behavior

Test only capabilities TornPDA actually exposes. If browser desktop notifications are unsupported, record that as an explicit compatibility distinction rather than a failure. Verify that unsupported APIs fail safely and do not spam errors or background loops.

### Step 4: Failure loop

Use the same test-first/minimal-fix/new-candidate loop as Task 6. Any shipping fix invalidates candidate evidence on affected paths and requires rerun.

### Step 5: Commit evidence

```bash
git add docs/review/
git commit -m "test: record ReviveRelay TornPDA acceptance"
```

---

## Task 8: Mint a new immutable review candidate only if shipping bytes changed

**Files:**
- Modify as required by current release machinery: `package.json`, `torn-revive-chat-collector.user.js`, release-boundary tests, `CHANGELOG.md`
- Generated locally: `dist/review/ReviveRelay-<version>.user.js`, metadata/manifest files
- Modify: candidate-specific verification documentation

### Step 1: Decide whether a new candidate is required

Compare accepted source against the frozen 0.6.4 source/provenance. If Tasks 2-4, 6 or 7 changed userscript/server/runtime/release-contract shipping behavior, determine the next unused semantic patch version. Normally this will be 0.6.5, but verify existing immutable releases first.

If no shipping bytes changed, do not bump a version for ceremony. Continue with 0.6.4.

### Step 2: Write release-boundary tests before version edits

Update version/path assertions to require the chosen next candidate, then run them and confirm they fail only because the source still names the prior version.

Relevant current tests include:

```bash
node --test test/release-build.test.js test/release-client.test.js test/release-pinning.test.js test/review-package.test.js test/review-release-smoke.test.js
```

### Step 3: Update version and release metadata

Change only the minimum versioned surfaces required by the release machinery. Add a concise changelog entry describing evidence-backed fixes.

### Step 4: Build without publishing

Use the repository release builder with a clean tree and a release-notes file as required by `scripts/release-client.js`. Inspect the script contract immediately before execution rather than guessing arguments.

At minimum:

```bash
npm run build
npm run check
npm run verify:review
```

Capture the generated SHA-256 and provenance commit.

### Step 5: Publish to private review only

This is a deployment side effect but not stable promotion. Use the existing immutable review-release mechanism already used for 0.6.4. Do not use a stale legacy publish script simply because it exists in the repository; first verify that the operational publisher matches the current `dist/review/ReviveRelay-<version>.user.js` artifact layout.

Verify after publication:

- immutable candidate URL returns the expected bytes;
- downloaded SHA-256 equals the local frozen artifact;
- review API advertises the new candidate and correct minimum version;
- review remains on `127.0.0.1:18731` behind the review route;
- stable 0.4.4 artifact, endpoint and container remain unchanged.

### Step 6: Re-run affected acceptance

Repeat every desktop/TornPDA path touched by the shipping change. If the change affects shared bootstrap, state, notification, navigation, auth or request submission, rerun the full corresponding platform matrix.

### Step 7: Commit release evidence

```bash
git add package.json torn-revive-chat-collector.user.js CHANGELOG.md test docs/review scripts server
git commit -m "release: prepare ReviveRelay <version> completion candidate"
```

Stage only files actually changed.

---

## Task 9: Reconcile repository and source-release truth without publishing yet

**Files:**
- Modify: `docs/review/REVIVERELAY-COMPLETION-HARDENING.md`
- Modify release/source scripts only if a test demonstrates they cannot publish the accepted candidate safely

### Step 1: Re-audit the branch graph

```bash
git status --short --branch
git log --graph --oneline --decorate --all -40
git rev-list --left-right --count origin/main...HEAD
git merge-base --is-ancestor origin/main HEAD
git branch --contains 1cd94a6
```

Expected: no rewritten recovery history and a comprehensible ancestry path.

### Step 2: Verify source/provenance consistency

For the accepted candidate prove:

- artifact build provenance commit exists locally;
- candidate hash matches acceptance evidence;
- release manifest points at the same candidate/version/channel;
- generated artifact does not depend on uncommitted files;
- any public source URL intended for the release can resolve to matching source after publication.

### Step 3: Prepare, but do not perform, remote publication

Determine the exact non-force Git operation that would reconcile `origin/main` with the accepted history. If a fast-forward is possible, record the exact command. If not, stop and design a safe merge/reconciliation path. Never force-push.

Remote Git publication and any public source-release synchronization remain pending Task 10 approval.

### Step 4: Commit the release-truth record

```bash
git add docs/review/REVIVERELAY-COMPLETION-HARDENING.md
git commit -m "docs: prepare ReviveRelay source reconciliation"
```

---

## Task 10: PRODUCTION HARD GATE

**STOP HERE. Do not execute this task without fresh explicit owner approval after Tasks 1-9 are complete and their evidence has been presented.**

This gate may include remote source publication, stable client promotion, stable API/release-metadata change, and any Torn-facing/public paid-release transition that has actually been approved. Treat each as an external side effect.

### Pre-gate evidence package

Present to the owner:

- accepted candidate version and SHA-256;
- accepted source commit;
- automated verification result;
- desktop acceptance result;
- real TornPDA acceptance result;
- open Torn staff-review dependencies, if any;
- security/privacy/network/credential audit result;
- exact source reconciliation operation;
- exact stable promotion mechanism;
- backup and rollback procedure;
- proof stable 0.4.4 is still unchanged before promotion.

Obtain explicit approval for production launch/promotion.

### After approval: fresh verification

Run a clean, fresh full gate immediately before changing production:

```bash
git status --short --branch
npm test
npm run check
npm run verify:review
```

Any failure cancels the production action.

### Backup

Create and verify current ReviveRelay PostgreSQL backup using the documented isolated backup process:

```bash
sh /srv/voidsmith/torn-platform/reviverelay/app/deploy/backup.sh
```

Run the documented disposable restore test on that exact backup before irreversible state-dependent work.

Also record stable client symlink/manifest/hash and relevant container image/start-state information so rollback is deterministic.

### Publish canonical source without rewriting history

Perform only the pre-approved non-force source operation from Task 9. Verify the remote commit immediately afterward.

If source publication must precede the stable artifact because the artifact provenance/source URLs depend on it, verify the remote immutable commit before continuing.

### Promote the accepted candidate

Use the current operational stable promotion mechanism that preserves immutable version directories and advances the stable pointer atomically. Do not use a legacy script until its artifact layout has been proven compatible with the accepted candidate.

Stable promotion must not mutate the review candidate bytes.

### Immediate smoke verification

Verify:

```bash
curl -fsS http://127.0.0.1:18730/health
curl -fsS http://127.0.0.1:18730/v1/client/version
```

Then verify through the public HTTPS route:

- stable client install URL responds;
- downloaded SHA-256 equals the accepted candidate hash;
- public version endpoint reports the accepted version/channel/provenance;
- requester free path works;
- stable API health is clean;
- review route remains intentionally configured or is retired only according to the approved release procedure.

### Rollback rule

If any version/hash/health/install/requester-smoke check disagrees, restore the previous stable pointer/manifest/runtime using the recorded rollback path before investigating further. Never debug forward on a broken public stable release.

---

## Task 11: Normalize final documentation and canonical Source of Truth

**Files:**
- Modify: `docs/review/REVIEW-CHECKLIST.md`
- Modify: `docs/review/REVIVERELAY-COMPLETION-HARDENING.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify only if still stale: `deploy/README.md`
- External durable record: canonical Voidsmith Source of Truth Google Doc

### Step 1: Record final production truth

Document:

- stable version/hash/commit;
- promotion timestamp;
- stable endpoint result;
- source publication commit;
- backup and rollback reference;
- desktop and TornPDA evidence IDs/notes;
- Torn staff review status and any public paid-launch restriction still in force.

Do not mark Torn approval if Torn has not actually approved the relevant behavior.

### Step 2: Remove stale version language

Search:

```bash
grep -R -n -E "0\.6\.0|0\.6\.1|0\.6\.2|0\.6\.3|0\.6\.4" README.md CHANGELOG.md deploy docs/review | head -300
```

Historical records may retain historical versions. Operational/current-state prose must name the actual stable/review state after promotion.

### Step 3: Update the canonical Source of Truth

Only now, after durable production change, update the ReviveRelay project/runtime/release entry in the canonical Voidsmith Source of Truth. Preserve unrelated project data. Re-read the updated section and verify that it matches the live stable version, source commit, runtime ports/isolation, review status and release restrictions.

### Step 4: Final verification

```bash
git status --short --branch
npm test
npm run check
```

Review every unchecked item in `docs/review/REVIEW-CHECKLIST.md`. Any intentionally open external dependency must be explicitly labelled as such and must not contradict a “complete” release claim.

### Step 5: Final commit

```bash
git add README.md CHANGELOG.md deploy/README.md docs/review/
git commit -m "docs: finalize ReviveRelay completion release"
```

Stage only files actually changed.

---

## Final completion criteria

The plan is complete only when all of the following are true:

- One immutable 0.6.x candidate is the accepted release candidate and its exact hash is known.
- Fresh automated verification is clean on that candidate.
- Real desktop Chrome/Torn acceptance is complete for required paths.
- Real TornPDA acceptance is complete for required paths, with platform differences documented rather than disguised.
- Dormant runtime behavior and unknown/pending state semantics are test-protected.
- Security, privacy, credential and network boundaries have no unresolved release blockers.
- The repository/release/source provenance is internally consistent and no force-push occurred.
- Public stable remained 0.4.4 until the explicit production gate.
- Production promotion has explicit owner approval and immediate smoke verification.
- Rollback is proven and available.
- Canonical Voidsmith Source of Truth is updated only after the durable production change and is re-verified.
- Any remaining Torn staff approval dependency is stated accurately and does not masquerade as completed approval.
