# ReviveRelay 0.7.4 Candidate Verification

**Task:** REV-008  
**Date:** 24 September 2026  
**Status:** IMPLEMENTED / AUTOMATED VERIFIED / NOT PUBLISHED / FRESH INDEPENDENT REVIEW REQUIRED / REAL-DEVICE ACCEPTANCE REQUIRED

## Trigger

Deferred Claude catch-up review of the actual merged/tagged 0.7.3 release (`999208663fac2238e10411cb2e8f5749ef094aa3` -> `2d5e1f5cd94d3ab523664510b40810a9c8348b16`) returned NO-GO with 0 Critical / 0 High / 4 Medium findings.

The four supported material findings were:

1. the validated review feed was not bound to the installer artifact that update handoff opened;
2. a failed partial initialization could leave a panel object that prevented the RR retry surface from restarting initialization;
3. desktop `window.open()` could report update-handoff success when no window was actually opened;
4. navigation authority was host-wide rather than restricted to exact approved destinations.

During remediation, live review metadata was also verified to use the exact public wrapper URL in `@updateURL` / `@downloadURL`, while the immutable release artifact uses the canonical distribution URLs. The executable bodies of the live mutable distribution artifact and immutable 0.7.3 artifact were byte-identical even though the metadata headers differed.

## 0.7.4 remediation

### Update integrity

- Review update metadata accepts only the two known metadata authorities: canonical channel-scoped ReviveRelay distribution URLs, or the exact public review wrapper URL currently emitted by the live review metadata.
- The updater does **not** execute or install from the public wrapper.
- Before an update is offered, it fetches both the mutable channel distribution userscript and the versioned immutable ReviveRelay release artifact.
- It requires matching version, build commit, build timestamp, exact executable body, and executable-body SHA-256.
- A mutable/immutable mismatch fails closed as an update-check failure.
- Stored update state is upgraded to the bounded `distribution-bound-v2` contract.
- Update handoff opens only the verified versioned immutable ReviveRelay userscript.

### Navigation authority

- Browser navigation is restricted to the exact Torn API-key setup URL used by ReviveRelay and version-matched immutable ReviveRelay userscript paths under `/releases/(review|stable)/<version>/ReviveRelay-<version>.user.js`.
- The apex Voidsmith website wrapper, mutable `/dist/` paths, arbitrary Torn pages, arbitrary ReviveRelay paths, non-HTTPS URLs, credentials, queries, and unexpected fragments are rejected.
- Desktop handoff returns failure if the browser blocks the new window.
- The opened window has its `opener` cleared.

### TornPDA recovery

- Recovery-launcher context is dynamically detected TornPDA only; desktop/narrow/coarse-pointer layouts no longer gain a second persistent RR launcher.
- Failed initialization tears down partial timers, sidebar state, resume hooks and panel state before retry.
- Tapping the TornPDA RR recovery launcher after a failed initialization restarts initialization only when no initialization is already in flight.
- Repeated initialization avoids duplicate global error hooks, sidebar navigation hooks and panel resize hooks.
- Timer startup is idempotent through an explicit timer teardown.

## Candidate identity

- Version: `0.7.4`
- Executable source commit: `077825174feaad7f3a1d28be000786686754765f`
- Executable source tree: `74ad23f9d62fac1a580a35c97f92de9f065f0c05`
- Artifact: `dist/review/ReviveRelay-0.7.4.user.js`
- Build timestamp: `2026-09-24T21:29:04.488Z`
- SHA-256: `35fbd47a74a98fab641ba6c026d3a017e15f4127e01f81002e4556ef0b001463`
- Size: `178820` bytes
- Published Beta/Review: `0.7.3`
- Stable: `0.4.4`
- Public promoted: `false`

## Verification

Pre-pin/focused verification:

- Update/platform/TornPDA recovery focused tests: **39 / 39 PASS**
- Source candidate full client suite: all non-pin behavior passed; the only deliberate pre-pin failure was the still-0.7.3 immutable build manifest.
- Server/database suite against disposable PostgreSQL 16 after dependency/environment setup: **338 / 338 PASS**

Pinned immutable review gate:

- Rebuild from `BUILD-MANIFEST.json`: **byte-for-byte SHA-256 and size match**
- Immutable artifact verifier: **2 / 2 PASS**
- Full client suite: **319 / 319 PASS**
- Full server/database suite against disposable PostgreSQL 16: **338 / 338 PASS**
- Release/dependency provenance suite: **5 / 5 PASS**
- Static review audit: **0 findings**
- Final artifact verifier: **PASS**
- Embedded version/commit/timestamp: exact match to the pinned manifest

The server suite used an isolated disposable PostgreSQL 16 database. No live/review customer, billing or production database state was used.

## Publication state

0.7.4 is **not published**. Published Beta/Review remains 0.7.3. Stable remains 0.4.4.

No production database, customer, billing, DNS/TLS, Stable runtime, public website installer or live review distribution bytes were changed by REV-008 verification.

## Remaining gates

1. Fresh independent Claude exact-candidate review must return **0 Critical / 0 High / 0 Medium**.
2. Review closure must be captured in the central Review Queue before any next review starts.
3. Any merge or publication remains a separate repository/release approval step.
4. Genuine TornPDA Android/iOS acceptance remains required before claiming TornPDA compatibility.
