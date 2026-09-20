# ReviveRelay 0.7.1 Automated Verification

**Task:** REV-004
**Date:** 20 September 2026
**Status:** IMPLEMENTED / AUTOMATED VERIFIED / PUBLIC BETA-REVIEW PUBLISHED / STABLE NOT PROMOTED

## Defect reproduced

A genuine TornPDA user reported that ReviveRelay installed but exposed no usable way to open or interact with the script.

Two concrete failure paths were confirmed in the 0.7.0 Beta client:

1. TornPDA detection required PDA storage, PDA HTTP helpers and the Flutter bridge to exist at the same instant. TornPDA injects these surfaces independently, so startup timing could misclassify the runtime.
2. A persisted minimized panel hid the entire ReviveRelay panel. Restore depended on finding Torn desktop-style sidebar markup. On a TornPDA/mobile layout with no matching sidebar target, no restore control existed, leaving the script effectively invisible.

Current TornPDA documentation and known-good TornPDA scripts support tolerant startup timing plus independent DOM/floating controls rather than relying exclusively on desktop sidebar markup.

## Fix

- TornPDA runtime detection now accepts the Flutter bridge when present, or the complete PDA storage+HTTP helper pair while bridge injection catches up.
- Partial helper pairs still do not identify TornPDA.
- A TornPDA-only 48px safe-area floating `RR` launcher is created directly under `document.body` while ReviveRelay is minimized.
- The launcher clears persisted minimized state and restores the panel without depending on Torn sidebar markup.
- Desktop sidebar behavior and the normal visible panel remain unchanged.
- No server authority, entitlement, billing, credential, database or Stable behavior changed.

## Candidate identity

- Version: `0.7.1`
- Executable source commit: `737cd210b014959eaf89dc234ef28ebd5769556b`
- Manifest pin commit: `66f2ddb71aa08a9f27735c62474924e402e272d7`
- Artifact: `dist/review/ReviveRelay-0.7.1.user.js`
- Build timestamp: `2026-09-20T20:00:24.568Z`
- SHA-256: `d072ec98806d986067d044ca3654c3bf0340152527b66d47b5f2c4fb56864a2f`
- Size: `167927` bytes
- Website wrapper SHA-256: `617c9ad769ce65807443dd7c3e7d2239bf91dd4d9f0d81d5043355c39c75b16e`
- Stable promoted: `false`

## Automated verification

The exact pinned candidate passed the full `npm run verify:review` gate against a fresh disposable PostgreSQL 16 instance bound only to loopback. The test container was removed after the gate.

- Client regression/release suite: PASS
- Server/database suite: PASS
- Release smoke/provenance suite: PASS
- Static review audit: **15 files / 0 findings**
- Immutable artifact verifier: PASS
- JavaScript syntax checks: PASS
- Exact artifact SHA-256/readback: PASS

No production or review database was used by the automated verification gate.

## Public Beta/Review publication

The exact candidate was published only to the existing Review/Beta distribution surfaces.

- Immutable review artifact: `/releases/review/0.7.1/ReviveRelay-0.7.1.user.js`
- Mutable review update feed: `/dist/review/ReviveRelay.user.js`
- Main Voidsmith installer: `https://voidsmithindustries.com/torn/install/reviverelay.user.js`
- Immutable public readback SHA-256: `d072ec98806d986067d044ca3654c3bf0340152527b66d47b5f2c4fb56864a2f`
- Review-feed and website-wrapper readback SHA-256: `617c9ad769ce65807443dd7c3e7d2239bf91dd4d9f0d81d5043355c39c75b16e`
- Mutable distribution endpoints return `Cache-Control: no-cache`.
- Website catalogue reports `0.7.1`, lifecycle `Beta`, TornPDA compatibility `Unknown`.
- Public Stable `/v1/client/version` still reports `0.4.4`.

The website wrapper modifies userscript metadata only. Its executable body is identical to the verified 0.7.1 candidate body.

## Website verification

Voidsmith Torn catalogue source commit:

`8593644d64a0a936320748cfd22fb8ee029f4e37`

Static website verification passed:

- site validator: PASS
- catalogue/site tests: **69 / 69 PASS**
- JavaScript syntax checks: PASS
- public bundle build: PASS
- public HTTPS readback for Torn landing, catalogue, ReviveRelay detail and catalogue JSON: HTTP 200
- public installer reports `@version 0.7.1`

Rollback backup:

`/srv/voidsmith/torn-platform/website/testing/backups/torn-site-pre-rev004-20260920T201140Z.tar.gz`

## Remaining human gate

This release fixes the reproduced code-level failure and is public as **Beta/Review**, but TornPDA compatibility remains `Unknown` until genuine-device acceptance.

Required next evidence:

1. Existing affected user updates/reinstalls to 0.7.1 in TornPDA.
2. Confirm the panel is visible on a fresh/open state.
3. Minimize ReviveRelay and confirm the floating `RR` launcher appears.
4. Tap `RR` and confirm the panel restores.
5. Confirm normal request/reviver interaction still works.
6. Preserve Android/iOS compatibility as `Unknown` until real-device evidence supports a stronger claim.

Stable 0.4.4 was not modified or promoted.
