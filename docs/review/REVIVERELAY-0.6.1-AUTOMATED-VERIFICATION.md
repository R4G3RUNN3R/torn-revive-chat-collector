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
- Client suite: **223 tests, 223 passed, 0 failed**.
- Release/provenance smoke: **4 tests, 4 passed, 0 failed**.
- Userscript syntax check: **passed**.
- Static Torn review audit: **15 files audited, 0 findings**.
- `git diff --check`: **passed**.

The disposable PostgreSQL container was removed after the run.


### Release-verification hardening observed on 2026-09-09

A release-process defect was found during Task 11 preflight: the previous `verify:review` command rebuilt the userscript from the later evidence commit before checking the manifest-pinned executable provenance. That made a legitimate documentation/evidence commit invalidate the exact immutable artifact it was supposed to verify.

The defect was fixed at commit `efe1545b41331a8d969161b91262b2aebead521a` (`fix: make review verification immutable`). The final gate now validates the manifest-pinned executable before and after all raw client/server/provenance/audit checks and never invokes the normal client build lifecycle during final review verification. Normal `npm run test:client` development behavior still rebuilds from current HEAD.

Fresh post-commit verification passed with the exact pinned executable unchanged:

- client: **223/223**;
- server: **335/335**;
- release/provenance smoke: **4/4**;
- static audit: **15 files, 0 findings**;
- pinned executable SHA-256 before and after the gate: `49f07cff3dbbde473d85c950b9e7986321dbde1be1bccb429b667806c1a024b3`.

Independent follow-up Codex review reported no remaining Critical or Important findings.

### Task 11 staging observed on 2026-09-09

- Immutable server runtime staged at `/srv/voidsmith/torn-platform/reviverelay/releases/server/review/0.6.1/`; copied server/runtime bytes match the tested worktree and staged Compose validates.
- Exact 0.6.1 review client/meta staged at `/srv/voidsmith/torn-platform/reviverelay/releases/client/review/0.6.1/`.
- Review userscript SHA-256 after staging and after public download: `49f07cff3dbbde473d85c950b9e7986321dbde1be1bccb429b667806c1a024b3`.
- Review metadata SHA-256 after staging and after public download: `1f104420382cf1ac2acec025efba9e93e445a20090cc26b23445f9096d1c0c21`.
- Review and stable-compatibility release-registry manifests validate as `review=0.6.1` and `stable=0.4.4` without changing the public 0.4.4 updater/symlink/runtime.
- The immutable review files return HTTP 200 on `/releases/review/0.6.1/...` with exact hashes.
- The dedicated review API is **not** running yet; `127.0.0.1:18731` has no listener and `/review/health` remains 404.
- Stable remains `current -> 0.4.4`, the stable userscript hash remains `1e6d84d5dd85cf8e2501ea391243767a37745ca20b197cb5a030a57d0da57fa6`, and stable `/health` remains healthy.
- Deployment is blocked before review-runtime startup because the server secret boundary does not yet contain the canonical merchant receiver settings required by review/live fail-closed configuration. No merchant API key is recorded in this report.

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
