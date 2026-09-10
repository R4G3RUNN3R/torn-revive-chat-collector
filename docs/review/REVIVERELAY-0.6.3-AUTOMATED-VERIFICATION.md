# ReviveRelay 0.6.3 Automated Verification

This report records automated verification for the client-only ReviveRelay 0.6.3 private-review hotfix discovered during live 0.6.2 browser acceptance. It does not claim completed manual browser acceptance or stable promotion.

## Browser-observed defect

On 2026-09-10, OWNER browser acceptance showed the Torn sidebar action visibly present with internal state `READY`, a valid saved request preset, and no active request, but clicking **ReviveRelay → Revive Me!** did not create a certified request. Review and stable API logs showed no `POST /v1/requests`, proving the failure occurred in the browser before transport.

The sidebar controller previously reused any existing `[data-reviverelay-sidebar-action]` node during reconciliation without verifying that the node still carried ReviveRelay's JavaScript activation listener. A regression test reproduced the observed condition by replacing the live action with a DOM clone that preserved attributes/state but not listeners: before the fix activation was absent; after the fix reconciliation restores activation. This matches the browser evidence and is the working root-cause model, although Torn's exact DOM replacement event was not directly captured from the user's browser.

The functional fix is committed at `1dbd21815cea35c8bc07ed86be2672af9cedae53`. The 0.6.3 review release boundary, including version and release metadata, is commit `b134f999189fc2c28d156c4e84d811e0d0db1b2d`.

## Exact executable candidate

- Version/channel: `0.6.3` / `review`
- Review artifact: `dist/review/ReviveRelay-0.6.3.user.js`
- Artifact source commit: `b134f999189fc2c28d156c4e84d811e0d0db1b2d`
- Build timestamp: `2026-09-10T14:32:35.834Z`
- SHA-256: `602754ee2f2c1f770b90db3fb19d82091896ddaa99fd3d72111d430ffdadd582`
- Metadata SHA-256: `ee870781937c0636b6cd05db5cbe233cdb9ac1c61038d5d3f4c277da2a211b64`
- Size: `121159` bytes

The artifact points only to immutable review URLs under `/releases/review/0.6.3/`. Published 0.6.2 review bytes remain immutable and public stable production remains 0.4.4.

## Full automated verification observed

Verification ran against a disposable loopback-only PostgreSQL 16 instance, never the production or review ReviveRelay database. The disposable database was removed after verification.

- Client suite: **225 tests, 225 passed, 0 failed**.
- Server suite: **335 tests, 335 passed, 0 failed**.
- Release/provenance smoke: **4 tests, 4 passed, 0 failed**.
- Userscript syntax check: **passed**.
- Static review audit: **15 files audited, 0 findings**.
- Immutable artifact verifier passed both before and after the full gate with SHA-256 `602754ee2f2c1f770b90db3fb19d82091896ddaa99fd3d72111d430ffdadd582`.

## Scope and compatibility

0.6.3 changes only client sidebar activation reconciliation plus version/release metadata. Rebinding is idempotent: intact actions retain one listener, while listenerless replacement nodes are rebound on reconciliation. The isolated review backend API contract, subscription model, merchant identity, OWNER lifetime entitlement, one-time trial persistence, payment verification, queue, transaction and database behavior are unchanged. Public stable production remains 0.4.4 on the stable runtime.

## Remaining browser evidence

Manual browser acceptance must resume on 0.6.3 and prove the specific failed path:

1. The Torn sidebar action reports `READY` with the saved request preset present.
2. Clicking **ReviveRelay → Revive Me!** once produces a `POST /v1/requests` to the review API.
3. The Request tab displays the resulting active certified request.
4. The request can then be cancelled/continued through the existing Task 12 acceptance flow as appropriate.

Stable promotion remains blocked until this browser regression and the remaining required Task 12 checks pass.
