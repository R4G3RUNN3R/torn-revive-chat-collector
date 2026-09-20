# ReviveRelay 0.7.0 Automated Verification

**Task:** REV-002  
**Date:** 20 September 2026  
**Status:** IMPLEMENTED / AUTOMATED VERIFIED / PUBLIC BETA-REVIEW PUBLISHED / STABLE NOT PROMOTED

## Candidate identity

- Version: `0.7.0`
- Executable source commit: `5d1b89c8db33aeb753d79664208d046f309388a5`
- Manifest pin commit: `68e02f4`
- Artifact: `dist/review/ReviveRelay-0.7.0.user.js`
- Build timestamp: `2026-09-20T07:25:24.000Z`
- SHA-256: `25ca10f9ef87ca5287485b74cb94f45630d2cbe6ae39d083ff18bd624d10c5d8`
- Size: `165903` bytes
- Public Beta/Review website distribution: `published 2026-09-20`
- Stable promoted: `false`
- Website distribution wrapper SHA-256: `d625196ae162972f3378087ec688869af192b7207ffd7f9376820321c9fc69c8`

## Implemented TornPDA compatibility

- One shared ReviveRelay runtime supports desktop userscript managers and TornPDA; no product fork was created.
- TornPDA detection requires the Flutter bridge, native durable storage and core PDA HTTP handlers.
- Client state prefers per-script `PDA_storage`, with bounded initialization/write timeouts and GM-compatible fallback.
- Successful legacy migration neutralizes stale GM values.
- A dirty-fallback marker reconciles newer GM fallback state back into native storage when it recovers.
- Repeated reconciliation failure and late stale native write failures preserve the newest fallback state.
- Native TornPDA HTTP requests are timeout-bounded.
- Bodyless POST/PUT/PATCH requests use an explicit JSON object body.
- DELETE requests carrying a body fail explicitly instead of losing confirmation data.
- Account deletion uses authenticated `POST /v1/account/delete`; legacy DELETE remains available.
- Verification-key revocation uses authenticated `POST /v1/verification-credential/revoke`; legacy DELETE remains available.
- Mobile resume triggers authoritative state reconciliation.
- TornPDA presentation uses safe-area-aware full-height layout, touch-sized controls, non-dragging mobile presentation and stacked in-page notifications.
- TornPDA navigation for the approved Torn API-key page and ReviveRelay installer remains inside the current WebView and rejects non-HTTPS/unapproved hosts.
- TornPDA's global Torn API key is not automatically consumed.
- Server-side Torn API, entitlement, billing, transaction and credential authority remains unchanged.

## Update behavior

ReviveRelay's existing update model is preserved.

- Userscript metadata contains channel-scoped `@version`, `@updateURL` and `@downloadURL`.
- The in-client update manager checks on startup and on a persisted 12-hour cadence.
- Update metadata is validated for release channel, version and exact approved install/meta URLs.
- Applying the update is handed to the userscript manager / TornPDA installer.
- ReviveRelay does not remotely eval or silently self-replace executable JavaScript.

## Voidsmith version policy

The client parser, release-manifest parser, runtime contract and server configuration all enforce single-digit numeric components. Values such as `0.6.10`, `0.10.0`, `10.0.0` and leading-zero variants are rejected. ReviveRelay therefore advances from `0.6.9` to `0.7.0`.

## Automated evidence

The final exact candidate passed `npm run verify:review` against a fresh disposable PostgreSQL 16 instance bound only to loopback.

- Client tests: **308 / 308 PASS**
- Server/database tests: **338 / 338 PASS**
- Release/provenance tests: **5 / 5 PASS**
- Static review audit: **15 files audited / 0 findings**
- Immutable artifact verifier: **PASS**
- Verified executable source commit: `5d1b89c8db33aeb753d79664208d046f309388a5`
- Verified SHA-256: `25ca10f9ef87ca5287485b74cb94f45630d2cbe6ae39d083ff18bd624d10c5d8`

No production or review database was used by the automated test gate.

## Independent review

Claude and Codex were used as independent read-only review lanes.

- Both initially identified TornPDA-specific storage/request hardening issues in earlier internal 0.7.0 candidates. Those candidates were superseded and never released.
- Claude's final delta review confirmed the two remaining fallback-state races were fixed and returned **BLOCKER: NO**.
- Codex independently reviewed the same final delta, found no Critical/High/Medium issue, and returned **BLOCKER: NO**.
- Reviewer feedback was reconciled against code and automated tests rather than accepted by model consensus alone.

## Review publication evidence

George explicitly authorised the website update on 20 September 2026. Publication remained review-only; Stable 0.4.4 was not promoted.

- The isolated review backend was patched with only the two PDA-safe POST aliases on top of the existing 0.6.1 review server release. No database migration was introduced.
- Public review readback returned `401 AUTH_REQUIRED` for unauthenticated `POST /review/v1/account/delete` and `POST /review/v1/verification-credential/revoke`, proving both routes exist and remain authenticated.
- The immutable review artifact is publicly readable at `/releases/review/0.7.0/ReviveRelay-0.7.0.user.js` with exact SHA-256 `25ca10f9ef87ca5287485b74cb94f45630d2cbe6ae39d083ff18bd624d10c5d8`.
- The mutable `/dist/review/` update bridge and `https://voidsmithindustries.com/torn/install/reviverelay.user.js` now report `@version 0.7.0`.
- The website wrapper changes userscript metadata only; its executable body is byte-for-byte identical to the tested candidate body. Wrapper SHA-256 is `d625196ae162972f3378087ec688869af192b7207ffd7f9376820321c9fc69c8`.
- Public website installer response includes `Cache-Control: no-cache` as required for the mutable distribution endpoint.
- The public Torn catalogue reports ReviveRelay `0.7.0`, lifecycle `Beta`, install approved, and TornPDA compatibility `Unknown` pending genuine device acceptance.
- Website source was reconciled to local canonical main commit `bdfd2fbce1e3f316546d3369aa0ce09ac0877d47`. That repository currently has no configured Git remote, so no remote push is claimed.
- Public stable `/v1/client/version` continued to report `0.4.4`; the stable API and worker were not restarted or replaced.

## Remaining human gate

ReviveRelay 0.7.0 is publicly distributed as **Beta/Review** for acceptance testing. It must not be described as Stable or as verified TornPDA-compatible yet.

Before Stable promotion:

1. Complete the Real TornPDA acceptance section in `docs/review/REVIEW-CHECKLIST.md` on genuine Android and iOS TornPDA runtimes.
2. Confirm fresh install, update discovery/install navigation, API-key navigation, suspend/resume, storage fallback recovery, account deletion, verification revocation, notification stacking, safe-area/orientation behavior and minimize/restore.
3. Re-verify the exact artifact bytes and public readback before any later Stable promotion.
