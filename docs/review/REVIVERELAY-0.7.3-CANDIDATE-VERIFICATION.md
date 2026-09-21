# ReviveRelay 0.7.3 Candidate Verification

**Task:** REV-006
**Date:** 21 September 2026
**Status:** IMPLEMENTED / AUTOMATED VERIFIED / NOT PUBLISHED / REAL-DEVICE ACCEPTANCE REQUIRED

## Trigger

Fresh genuine TornPDA feedback after the public 0.7.2 release reported that the dedicated RR button was still not visible.

## Confirmed design flaw in 0.7.2

The prior recovery design remained circular:

1. The RR launcher was created only when the startup-frozen runtime classification already identified TornPDA.
2. Even when TornPDA was identified, the dedicated RR launcher was normally displayed only while persisted `state.minimized` was true.
3. Therefore a user whose panel was missing/unusable could still have no recovery control, and delayed PDA bridge/helper injection could leave the launcher path unavailable.
4. A one-shot launcher mount was weaker than the independently watched/remounted launcher pattern observed in MoDuL's working Pythagoras userscript.

## Comparative evidence

MoDuL's Pythagoras Project - CIS mounts its root directly under `document.body`, maintains its footer launcher separately from the main panel, retries launcher mounting, and runs a 2-second watchdog that remounts the control if the DOM removes it.

Current TornPDA documentation warns that pre-existing userscripts can require changes because helper/library availability and code-loading times differ. TornPDA's helper API waits on `__PDA_platformReadyPromise` before native bridge calls, and recent TornPDA releases include fixes for cold-start userscript execution, PDA handler detection, lost GM/PDA helpers and browser-page recovery.

## 0.7.3 fix

- Recognize `__PDA_platformReadyPromise` as an early TornPDA runtime signal.
- Re-detect TornPDA UI context instead of relying exclusively on the frozen startup classification.
- Mount the RR recovery launcher before full ReviveRelay initialization on TornPDA/mobile recovery contexts.
- Keep the RR launcher visible independently of persisted minimized state in recovery contexts.
- If initialization failed before a panel exists, tapping RR retries initialization.
- Reconcile the launcher/panel on `flutterInAppWebViewPlatformReady` and the TornPDA ready promise.
- Apply critical recovery-launcher visibility/positioning inline with `!important`, independent of the normal injected stylesheet.
- Run a recovery-context-only 2-second launcher watchdog so WebView/DOM replacement cannot permanently remove RR.
- Preserve the 0.7.1 safe-area launcher and 0.7.2 safe updater behavior.
- Preserve Stable 0.4.4 and all backend/server authority boundaries.

## Candidate identity

- Version: `0.7.3`
- Executable source commit: `e661af8a999aa46c7db47352210fb50426218e10`
- Artifact: `dist/review/ReviveRelay-0.7.3.user.js`
- Build timestamp: `2026-09-21T11:04:19.939Z`
- SHA-256: `d46e344bc49b939a82df17f67a839296716af5147a53717973e265161dbe68cd`
- Size: `172402` bytes
- Public promoted: `false`
- Stable: `0.4.4`

## Verification

Source-candidate gate:

- Client suite before immutable pin: **314 / 314 PASS**
- Server/database suite against disposable PostgreSQL 16: **338 / 338 PASS**
- Release smoke/dependency provenance: **5 / 5 PASS**
- Syntax/static audit: PASS

Pinned immutable review gate:

- Full client suite including immutable verifier: **316 / 316 PASS**
- Server/database suite against disposable PostgreSQL 16: **338 / 338 PASS**
- Release/provenance: **5 / 5 PASS**
- Static review audit: **0 findings**
- Rebuilt SHA-256: exact match
- Rebuilt size: exact match
- Embedded version/commit/timestamp: exact match

No production database/customer/billing/Stable runtime changes were made.

## Publication state

0.7.3 is **not published**. Public Beta/Review remains 0.7.2 until George authorises another publication step.

## Required real-device acceptance

The affected tester should update/install 0.7.3 only after publication or through an explicitly provided candidate and verify:

1. RR is visible on TornPDA without first minimizing the panel.
2. RR remains visible/reappears after TornPDA navigation or WebView recovery.
3. Tapping RR opens/restores ReviveRelay.
4. If the panel failed to initialize, tapping RR retries initialization.
5. Normal request/reviver/update behavior still works.
6. Record Android/iOS and TornPDA version.

TornPDA compatibility remains `Unknown` until genuine device evidence supports a stronger claim.
