# Task 2 Report — Prove and harden dormant runtime lifecycle

## Status

Completed from baseline commit `e5e086f`.

## Scope and implementation

- Inventory recorded in `docs/review/REVIVERELAY-COMPLETION-HARDENING.md` classifying every observer, recurring timer, navigation handler, poller, and repeated network path.
- Test-first lifecycle work added focused instrumentation for notification suppression/seen-ID persistence, interval ownership, and repeated sidebar-observer activity.
- A focused test initially failed for the absence of initialization/timer ownership. The userscript now has a one-time initialization guard, a start guard, and explicit stored-handle cleanup in `stopTimers()`.
- Existing entitlement guards already prevented Pro-only queue and eligibility network calls while unavailable, unlicensed, or inapplicable; no new polling or watchdog was added.
- Sidebar observer behavior remains bounded to the sidebar/navigation ancestor and debounced. SPA reactivation surfaces remain: sidebar reconcile plus the compatible/incompatible entitlement refresh path.

## Validation

| Command | Result |
|---|---|
| `node --test test/client-hardening.test.js test/bootstrap-controls.test.js test/sidebar-action.test.js` | PASS — 29 tests |
| `npm run test:client` | 230 passed, 1 failed |

The sole full-suite failure is `test/review-artifact-verifier.test.js`: `npm run test:client` first runs the mandated build, and the userscript source change produces a new local 0.6.4 artifact hash (`e27c53a969bc1fb7025b4fc38546d4359f696c803edfd1e11093f2deaba3839e`) that correctly differs from immutable published 0.6.4 evidence. It is a candidate-integrity failure, not a behavioral regression. The task brief requires Task 8 to create the next unused patch candidate for any shipping change.

## Self-review

- Production diff is confined to lifecycle ownership; it creates no additional network operation, timer, observer, listener, or polling route.
- All seven interval handles are cleared and nulled; repeated start does not add loops, and stop/start recreates exactly one set.
- The init guard prevents duplicate panel creation, global error handlers, sidebar controller/navigation handlers, and timer setup.
- Task 1 evidence remains intact. No deployed runtime, release directory, or published candidate artifact was edited.

## Executable/runtime source changed

Yes: `torn-revive-chat-collector.user.js`.

## Candidate impact and concerns

- 0.6.4 is invalid as the candidate for this source revision and must not be rebuilt or published over. Task 8 must create the next unused patch candidate.
- The full client command cannot be fully green until that candidate/version work updates the immutable-artifact expectation; its behavioral test coverage otherwise passed.
