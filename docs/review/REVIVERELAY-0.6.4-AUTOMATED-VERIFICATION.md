# ReviveRelay 0.6.4 Automated Verification

This report records automated verification for the client-only ReviveRelay 0.6.4 private-review hotfix discovered during live 0.6.3 browser acceptance. It does not claim completed manual browser acceptance or stable promotion.

## Browser-observed defect

On 2026-09-10, OWNER browser acceptance showed ReviveRelay 0.6.3 connected with the Torn sidebar action visibly present and reporting `READY`, a valid saved request preset, and no active request. Clicking **ReviveRelay → Revive Me!** still appeared to do nothing. Review API logs were inspected immediately afterward and contained normal authenticated GET polling but no `POST /v1/requests`, proving that the request never reached the review backend.

0.6.3 had already repaired the case where Torn replaces or clones the ReviveRelay node and drops its direct JavaScript listener. The remaining evidence therefore points to the Torn-managed sidebar/browser event boundary rather than request validation or the server. Because the user's live browser was not instrumented at DOM-event level, the exact Torn handler that consumes the event is not claimed as directly observed.

0.6.4 hardens that boundary with a window-level capture/delegation handler for the ReviveRelay sidebar action. It identifies the action from the browser event path before Torn's later sidebar handlers can consume it, prevents the ReviveRelay click from becoming Torn navigation, and uses per-event deduplication so capture delivery plus the existing direct listener cannot double-submit. The 0.6.3 reconciliation/rebinding behavior remains in place as an independent fallback.

## Desktop notification control

0.6.4 also adds a persistent **Desktop notifications for new certified requests** checkbox under Settings → Notifications.

- Default: enabled, preserving existing upgrade behavior.
- Disabled: no desktop notification is emitted for newly observed certified requests.
- Queue polling and Accept controls remain active.
- Newly observed request IDs are still bounded/persisted as seen while notifications are disabled, preventing a stale notification burst if notifications are later re-enabled.

## Exact executable candidate

- Version/channel: `0.6.4` / `review`
- Review artifact: `dist/review/ReviveRelay-0.6.4.user.js`
- Artifact source commit: `b6b3d24b0616c9b3f7c9607f72dd5f0a72e55274`
- Build timestamp: `2026-09-10T19:00:41.267Z`
- SHA-256: `f2ff7166e6912c6a449790412d1a82947087a64efc5eafb647971ff76e3c7a73`
- Metadata SHA-256: `ad1e0b52991b70d599199c11d4a6dc0dcbf718089a267ff0a94dd967f8fbc23f`
- Size: `122958` bytes

The executable was built once from the exact source commit above and then pinned in `docs/review/BUILD-MANIFEST.json`. Subsequent verification used those frozen bytes without rebuilding them.

## Test-driven evidence

Two new regression tests were written before the production fixes:

1. A capture/delegation test that simulates the ReviveRelay sidebar action being present while the ordinary target/bubble click path is unavailable. It failed before the capture handler existed and passed after the fix.
2. A Settings/notification-preference test requiring a default-enabled persistent notification toggle and enforcement inside the queue notification function. It failed before implementation and passed after the fix.

The focused regression suite finished **26/26 passed** after implementation.

Release-boundary tests were then changed to require 0.6.4 before the package version was updated. They failed **4/13** solely on the expected old 0.6.3 version/path assertions, then passed **13/13** after the 0.6.4 boundary was implemented.

## Full automated verification observed

Verification ran against a disposable PostgreSQL 16 container published only on a Docker-assigned `127.0.0.1` port. `TEST_DATABASE_URL` pointed only at that disposable database. The production and review ReviveRelay databases were not used, and the disposable verification container was removed automatically afterward; an explicit post-run check found no remaining `reviverelay-064-verify-*` container.

- Client suite: **227 tests, 227 passed, 0 failed**.
- Server suite: **335 tests, 335 passed, 0 failed**.
- Release/provenance smoke: **4 tests, 4 passed, 0 failed**.
- Userscript syntax check: **passed**.
- Static review audit: **15 files audited, 0 findings**.
- Immutable artifact verifier passed both before and after the complete gate with SHA-256 `f2ff7166e6912c6a449790412d1a82947087a64efc5eafb647971ff76e3c7a73`.

## Scope and compatibility

0.6.4 changes only client sidebar activation handling, desktop-notification preference/UI, tests, and review release metadata. The isolated review backend API contract, subscription model, merchant identity, OWNER lifetime entitlement, one-time trial persistence, payment verification, queue semantics, transaction workflow and database behavior are unchanged. The review API minimum supported client remains 0.6.1. Public stable production remains 0.4.4.

## Remaining browser evidence

Manual browser acceptance must resume on 0.6.4 and prove the live Torn boundary:

1. ReviveRelay loads as 0.6.4 with the saved request preset preserved.
2. Settings → Notifications exposes the desktop-notification checkbox and the preference persists across a Torn reload.
3. The sidebar action reports `READY`.
4. Clicking **ReviveRelay → Revive Me!** once produces exactly one `POST /v1/requests` to the review API.
5. The Request tab displays the resulting active certified request.
6. The request can then be cancelled or continued through the remaining Task 12 acceptance flow as appropriate.

Stable promotion remains blocked until this browser regression and the remaining required Task 12 checks pass.

## Private-review publication verification

0.6.4 was published only to the immutable private review channel after the complete automated gate.

- Public userscript URL: `/releases/review/0.6.4/ReviveRelay-0.6.4.user.js`
- Public userscript SHA-256 downloaded through Caddy: `f2ff7166e6912c6a449790412d1a82947087a64efc5eafb647971ff76e3c7a73`.
- Public metadata SHA-256 downloaded through Caddy: `ad1e0b52991b70d599199c11d4a6dc0dcbf718089a267ff0a94dd967f8fbc23f`.
- Review API was restarted by exact review-container identity only to reload the review manifest; it now advertises `latestVersion=0.6.4`, `minimumVersion=0.6.1`, and release channel `review`.
- Review API remained on `127.0.0.1:18731`; stable API remained on `127.0.0.1:18730`.
- Previously published 0.6.3 remained byte-for-byte unchanged at SHA-256 `602754ee2f2c1f770b90db3fb19d82091896ddaa99fd3d72111d430ffdadd582`.
- Stable 0.4.4 remained byte-for-byte unchanged at SHA-256 `1e6d84d5dd85cf8e2501ea391243767a37745ca20b197cb5a030a57d0da57fa6` and its API container retained its pre-publication start time.

Publication does not satisfy browser acceptance. The sidebar action still requires one real Torn click on 0.6.4 followed by review-API log confirmation of exactly one `POST /v1/requests`.
