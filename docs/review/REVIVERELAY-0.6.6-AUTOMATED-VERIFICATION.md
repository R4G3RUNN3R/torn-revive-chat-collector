# ReviveRelay 0.6.6 Automated Verification

This report records fresh automated verification for the frozen ReviveRelay 0.6.6 private-review completion candidate. It does not substitute automated evidence for genuine Torn desktop or TornPDA acceptance.

## Why 0.6.6 was required

Published 0.6.5 remained immutable after completion hardening found shipping changes that could not legally be folded back into the same version:

- update-manifest URL validation accepted any HTTPS origin containing a review release path;
- the static artifact audit did not independently pin the embedded ReviveRelay review API origin; and
- the certified reviver queue lacked the grouping/filter/sort and explicit refresh controls required by the approved desktop/TornPDA acceptance design.

0.6.6 fixes those issues without changing the server API, database schema, subscription catalogue, merchant identity, OWNER rule, one-time trial rule, payment matcher, transaction contract or public stable runtime.

## Test-driven trust-boundary hardening

Task 4 strengthened the trust-boundary tests before implementation. The first strengthened run produced **17 passed / 2 failed**. The two failures proved:

1. a valid-looking manifest could point the updater to `https://evil.example/releases/review/...`; and
2. a userscript with an altered `API_BASE` could pass the static artifact audit while retaining the approved `@connect` host.

The implementation now requires exact ReviveRelay release-origin/channel/version filenames and an exact `https://reviverelay.voidsmithindustries.com/review` client API base. Targeted trust/security verification passed **25/25** client/release checks and **74/74** focused server security checks.

## Test-driven queue completion

The queue acceptance tests were written before implementation. The initial queue-control run produced **5 passed / 3 failed**, proving the required controls/helpers did not exist. A separate focus regression failed against the previous one-second queue rerender behavior.

0.6.6 now provides All/Cash/Xanax filtering, independent minimum Cash and Xanax values, newest/oldest and offer-value sorting, optional payment grouping, explicit queue refresh, narrow-viewport layout, and stable input focus. Relevant client/UI/state/sidebar verification passed **91/91** after implementation.

## Reproducible immutable build

The release builder itself was hardened test-first so a current-version pinned `BUILD-MANIFEST.json` supplies the frozen artifact source commit and build timestamp. Rebuilding an accepted candidate therefore reproduces identical bytes rather than changing the embedded timestamp and invalidating its own SHA-256 evidence.

The exact 0.6.6 artifact was built from the clean source commit below, pinned into `docs/review/BUILD-MANIFEST.json`, rebuilt normally, and produced the identical SHA-256 on the second build.

## Frozen executable candidate

- Version/channel: `0.6.6` / `review`
- Artifact: `dist/review/ReviveRelay-0.6.6.user.js`
- Artifact source commit: `f499265a1b1d07df01c19e120c1eebf37e395e6d`
- Build timestamp: `2026-09-11T18:31:40.269Z`
- Userscript SHA-256: `1f4885c25f9340e6730e0e844ff1172784d8edb12a6c2e32bc11bffc45d160cb`
- Userscript size: `134548` bytes
- Metadata SHA-256: `eb1553648099de90b75ed32110048df351f98a7453b3a3c8df850a9893f5b684`
- Metadata size: `919` bytes

## Complete automated gate

A fresh disposable PostgreSQL 16 container was created specifically for this gate, bound only to `127.0.0.1` on ephemeral host port `32809`. `TEST_DATABASE_URL` referenced only that database.

The repository-defined gate completed successfully:

- `npm test`: **client 250/250**, **server 335/335**.
- `npm run build`: passed and reproduced the frozen 0.6.6 bytes.
- `npm run check`: passed; repeated client **250/250**, server **335/335**, reproducible build, and syntax validation.
- `npm run audit:review`: **15 files audited, 0 findings**.
- `npm run verify:review`: immutable verifier PASS before and after; client **250/250**; server **335/335**; dedicated release/provenance **5/5**; userscript syntax PASS; audit **15 files / 0 findings**.
- Final SHA-256 after all repeated builds: `1f4885c25f9340e6730e0e844ff1172784d8edb12a6c2e32bc11bffc45d160cb`.

Disposable database container: `reviverelay-completion-066-pg-1789151544`. It was stopped/removed after the gate, and a subsequent Docker inventory confirmed it was absent. Neither the stable nor private-review ReviveRelay database was used.

## Release and production boundary

- 0.6.5 remains an immutable historical review artifact.
- 0.6.6 is the current frozen completion candidate and is not stable production.
- Public stable remains 0.4.4 and was not changed by this verification.
- Genuine desktop Torn and TornPDA acceptance must still run against the exact published 0.6.6 bytes.
- Remote source publication and stable promotion remain behind the explicit production hard gate.
