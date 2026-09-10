# ReviveRelay 0.6.5 Automated Verification

This report records automated verification for the frozen ReviveRelay 0.6.5 private-review client candidate. It does not claim that the live Torn browser defect is resolved until the exact published 0.6.5 bytes pass manual browser acceptance.

## Live 0.6.4 evidence that triggered 0.6.5

During desktop Torn acceptance, 0.6.4 had already proven one successful sidebar request/cancel cycle. After Desktop notifications were disabled and Torn was fully refreshed, however, the Request tab showed no active request after a subsequent sidebar activation attempt. Review API logs showed normal authenticated GET polling but no new `POST /v1/requests`.

A second diagnostic attempt waited more than ten seconds, exceeding two five-second sidebar reconciliation intervals, confirmed the action still reported `READY`, and clicked once. The review API again received no `POST /v1/requests`. This ruled out a simple delayed reconciliation explanation and kept the failure on the client/browser event boundary.

The exact Torn DOM event sequence was not directly instrumented in the user's browser, so this report does not claim to have observed Torn replacing the button between pointer events. The new test reproduces that defensible failure class and the implementation hardens against it.

## Test-driven sidebar repair

A regression test was added before production code requiring one activation when:

1. `pointerdown` starts on the ReviveRelay sidebar action;
2. Torn removes/replaces that action before the later click;
3. `pointerup` lands on the surviving sidebar ancestor; and
4. a later click, if emitted, must not create a duplicate activation.

Before implementation the test failed because no `pointerdown`/`pointerup` capture path existed. After the implementation and expected listener-inventory update, the sidebar-action suite passed **10/10**.

The implementation:

- captures primary-button `pointerdown` at window capture phase when the composed event path contains the ReviveRelay action;
- remembers pointer identity, start time and optional coordinates;
- completes on matching `pointerup` within two seconds and no more than 32 pixels movement, even if the original action no longer exists;
- clears pending state on `pointercancel`;
- suppresses the subsequent click briefly so one physical gesture cannot double-submit;
- retains the existing direct click handler, window click-capture handler, listener rebinding and sidebar reconciliation as fallbacks; and
- removes all owned capture listeners during controller destruction.

## Other client hardening included in 0.6.5

The candidate also includes completion-hardening work made after immutable 0.6.4 publication:

- dormant/unavailable eligibility state no longer triggers repeated useless eligibility calls on each entitlement tick;
- per-resource authoritative revisions prevent delayed queue, identity and eligibility responses from overwriting newer revocation/deletion/denial state;
- queue transport failure remains distinct from an authoritative empty queue; and
- invoice rendering waits for authoritative entitlement rather than inferring paid access from an observed payment alone.

These are client-side changes only. No server route, database schema, subscription catalog, merchant identity, OWNER rule, trial persistence rule, payment matcher or transaction contract changed.

## Frozen executable candidate

- Version/channel: `0.6.5` / `review`
- Artifact: `dist/review/ReviveRelay-0.6.5.user.js`
- Artifact source commit: `dee29b9ce7fa4a65654f053534d0ebe4ce9aa35e`
- Build timestamp: `2026-09-10T23:15:19.840Z`
- Userscript SHA-256: `9e065d49e6ac20d6cdeebc810a3099cd3ec1e728e455dcee7a84010ed3a26972`
- Userscript size: `128173` bytes
- Metadata SHA-256: `5a51723ef9a5ce780011148e9b274917f25631ee5e64d7271d6a50d61275921f`

The executable was built once from the source commit above and then pinned in `docs/review/BUILD-MANIFEST.json`. Verification after pinning used those exact bytes without rebuilding.

## Automated verification

Fresh verification against the frozen artifact completed with:

- Client suite: **239 tests, 239 passed, 0 failed**.
- Server suite: **335 tests, 335 passed, 0 failed**.
- Dedicated release/provenance smoke: **4 tests, 4 passed, 0 failed**.
- Sidebar focused suite: **10 tests, 10 passed, 0 failed**.
- Userscript syntax check: **passed**.
- Static review audit: **15 files audited, 0 findings**.
- Immutable artifact verifier: **passed before and after** with SHA-256 `9e065d49e6ac20d6cdeebc810a3099cd3ec1e728e455dcee7a84010ed3a26972`.

The server suite used a disposable PostgreSQL 16 container bound only to loopback at port 55433. `TEST_DATABASE_URL` referenced that disposable database only, and the container was removed automatically after the test run. Neither the stable nor private-review ReviveRelay database was used for the server test suite.

## Release and production boundary

- 0.6.4 remains an immutable historical review artifact and must not be overwritten.
- 0.6.5 is a private review candidate only until publication and browser acceptance are separately verified.
- The existing isolated review API contract remains compatible with minimum client 0.6.1.
- Public production remains 0.4.4 on port 18730 and must not be promoted as part of this review release.

## Required browser re-test

After immutable review publication, manual desktop acceptance must at minimum:

1. update/install the exact published 0.6.5 userscript;
2. perform a full Torn page refresh;
3. confirm the saved `$750,000` / `Rev please!` preset and OWNER/reviver state remain intact;
4. keep Desktop notifications disabled;
5. confirm the sidebar action reports `READY`;
6. click once and verify exactly one `POST /v1/requests` reaches the review API;
7. confirm the Request tab shows the active certified request; and
8. confirm no desktop notification appears for the newly observed request while notifications are disabled.

Only that real-browser evidence can close the intermittent sidebar regression and notification-suppression acceptance cases.

## Private-review publication verification

0.6.5 was published to the immutable private review channel only after the post-documentation full gate passed.

- Public userscript SHA-256 downloaded through Caddy: `9e065d49e6ac20d6cdeebc810a3099cd3ec1e728e455dcee7a84010ed3a26972`.
- Public metadata SHA-256 downloaded through Caddy: `5a51723ef9a5ce780011148e9b274917f25631ee5e64d7271d6a50d61275921f`.
- Review registry now advertises `latestVersion=0.6.5`, `minimumVersion=0.6.1`, channel `review`, and the exact immutable install/meta URLs.
- Review API remains isolated on `127.0.0.1:18731`; only that API container was recreated to reload the release registry and it reports restart count 0.
- Review subscription worker remained running and reports restart count 0.
- Previously published 0.6.4 remains byte-for-byte unchanged at SHA-256 `f2ff7166e6912c6a449790412d1a82947087a64efc5eafb647971ff76e3c7a73`.
- Stable API remains healthy on `127.0.0.1:18730`, advertises 0.4.4, and stable current userscript remains byte-for-byte unchanged at SHA-256 `1e6d84d5dd85cf8e2501ea391243767a37745ca20b197cb5a030a57d0da57fa6`.
- Stable API and worker report restart count 0.

Publication does not close browser acceptance. The exact published 0.6.5 bytes must still prove one post-refresh sidebar activation produces exactly one request and that Desktop notifications OFF suppresses delivery while queue/request state continues normally.
