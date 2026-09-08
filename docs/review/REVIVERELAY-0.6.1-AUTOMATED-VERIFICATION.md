# ReviveRelay 0.6.1 Automated Verification

This report records the exact automated verification observed for the private ReviveRelay 0.6.1 Torn review candidate. It does not claim Torn approval or completed manual browser acceptance.

## Exact executable candidate

- Version/channel: `0.6.1` / `review`
- Review artifact: `dist/review/ReviveRelay-0.6.1.user.js`
- Artifact source commit: `0badd55c5de81fa1f329257185fcaca0657dad35`
- Build timestamp: `2026-09-08T10:14:47.250Z`
- SHA-256: `49f07cff3dbbde473d85c950b9e7986321dbde1be1bccb429b667806c1a024b3`
- Size: `120361` bytes

The generated metadata points only to the immutable review URLs:

- `https://reviverelay.voidsmithindustries.com/releases/review/0.6.1/ReviveRelay-0.6.1.user.js`
- `https://reviverelay.voidsmithindustries.com/releases/review/0.6.1/ReviveRelay-0.6.1.meta.js`

## Full automated verification observed

Verification ran against a fresh disposable PostgreSQL 16 instance, not the production database.

- Server suite: **335 tests, 335 passed, 0 failed**.
- Client suite: **220 tests, 220 passed, 0 failed**.
- Release/provenance smoke: **4 tests, 4 passed, 0 failed**.
- Userscript syntax check: **passed**.
- Static Torn review audit: **15 files audited, 0 findings**.
- `git diff --check`: **passed**.

The disposable PostgreSQL container was removed after the run.

## Security/regression coverage

The verified suite includes coverage for:

- explicit review runtime contract and review/stable channel separation;
- fail-closed behavior for missing, malformed, stable-channel or incompatible runtime metadata;
- review API URL construction under `/review/v1/`;
- canonical merchant OWNER derivation and client/request spoof rejection;
- OWNER Lifetime Pro access without trial or subscription purchase controls;
- OWNER still requiring normal ReviveRelay Verification, Torn permanent revive ability and active reviver registration;
- one-time 7-day trial persistence across userscript reinstall simulation, session destruction/recreation, verification-key replacement, account delete/reactivate and repository/application restart;
- requester verification before a request can enter the reviver queue or be accepted;
- exact server-owned plan pricing and merchant identity;
- payment evidence replay protection and exact sender/currency/amount/window matching;
- dedicated review subscription scanning without dependency on the stable generic `jobs` queue;
- direct-only runtime with no public chat collection or unfocused Torn-page scraping;
- immutable review artifact provenance and no runtime `@require`/dynamic executable-code loading.

## Production boundary

Public production remains **0.4.4**. Stable 0.4.4 has not been promoted or replaced by 0.6.1. The 0.6.1 candidate belongs to the private review channel only.

## Remaining human/review evidence

The following are still pending and are intentionally not represented as completed here:

- live deployment of the dedicated `/review/*` runtime;
- manual browser acceptance for a normal user, an expired-trial user and OWNER;
- screenshot evidence for Request, Reviver, Activity, Pro and Settings;
- Torn staff approval of the paid subscription model and certified-request notification approach.
