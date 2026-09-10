# ReviveRelay Completion Hardening Evidence Ledger

Date: 2026-09-10
Scope: private ReviveRelay 0.6.x completion review
Task: 1 — lock completion baseline and repair release-document truth

## Baseline

- Active branch: `fix/reviverelay-trial-persistence`
- Baseline commit: `1adf3ac1bc955b2100e6b014f061337b01be1926`
- Baseline subject: `docs(reviverelay): record notification preference persistence`
- Branch relation: 79 commits ahead of `origin/main` (`0 79` for `origin/main...HEAD`)
- Recovery anchor: `1cd94a6` (`main`)
- Worktree baseline: clean before Task 1 edits; package version `0.6.4`
- Post-plan evidence commits preserved: `1c5d646` request-cancellation proof and `1adf3ac` notification-preference persistence proof.

## Runtime and candidate identity

Stable was read without modification:

- Version: `0.4.4`
- Current path: `/srv/voidsmith/torn-platform/reviverelay/releases/client/current -> 0.4.4`
- Artifact path: `/srv/voidsmith/torn-platform/reviverelay/releases/client/0.4.4/reviverelay-auto.user.js`
- Artifact SHA-256: `1e6d84d5dd85cf8e2501ea391243767a37745ca20b197cb5a030a57d0da57fa6`
- Health: `{"ok":true}`
- Version endpoint: `latestVersion=0.4.4`, commit `b9c8017cc95d612ebe03a578040d00f56f7580eb`

Review was read without modification:

- Version/channel: `0.6.4` / `review`
- Artifact path: `/srv/voidsmith/torn-platform/reviverelay/releases/client/review/0.6.4/ReviveRelay-0.6.4.user.js`
- Artifact source commit: `b6b3d24b0616c9b3f7c9607f72dd5f0a72e55274`
- Artifact SHA-256: `f2ff7166e6912c6a449790412d1a82947087a64efc5eafb647971ff76e3c7a73`
- Health: `{"ok":true}`
- Version endpoint: `latestVersion=0.6.4`, `minimumVersion=0.6.1`, channel `review`
- Manifest/report reconciliation: matches `docs/review/REVIVERELAY-0.6.4-AUTOMATED-VERIFICATION.md` and `docs/review/BUILD-MANIFEST.json`.

### Immutable-candidate rule

Published review artifacts are immutable. Documentation-only changes may retain 0.6.4. Any shipping userscript, server, release-contract, or runtime change requires a new unused patch candidate, normally 0.6.5; 0.6.4 must not be rebuilt or overwritten. Evidence is reusable only when the changed surface cannot affect it.

## Evidence table

| Gate | Platform | Candidate | Artifact hash | Evidence | Status | Notes |
|---|---|---|---|---|---|---|
| Automated release/provenance | CI/local release gate | 0.6.4 | `f2ff7166…c7a73` | `REVIVERELAY-0.6.4-AUTOMATED-VERIFICATION.md` records the complete gate and exact hash | PASS | Automated evidence only; not a substitute for manual acceptance |
| Stable isolation | Stable runtime | 0.4.4 | `1e6d84d5…57fa6` | Current symlink, health, version endpoint, and published artifact hash | PASS | Stable was not changed |
| Review runtime identity | Review runtime | 0.6.4 | `f2ff7166…c7a73` | Review health/version endpoint and release manifest agree | PASS | Review was not changed |
| Sidebar/request/cancel | Real Torn desktop browser | 0.6.4 | `f2ff7166…c7a73` | One physical click, HTTP 201, visible request, cancel HTTP 200, no duplicate request | PASS | Evidence recorded in checklist and prior commits |
| Notification preference persistence | Real Torn desktop browser | 0.6.4 | `f2ff7166…c7a73` | Disabled setting survived full Torn refresh | PASS | Matrix still has pending/invalid/dedup cases |
| Dormant runtime | Desktop + TornPDA | 0.6.4 | — | Required real-platform lifecycle evidence not yet recorded | OPEN | No completion claim |
| Unknown/pending/stale state | Desktop + TornPDA | 0.6.4 | — | Required state matrix not yet recorded | OPEN | No completion claim |
| Notification matrix | Desktop + TornPDA | 0.6.4 | — | Only preference persistence is evidenced | OPEN | See checklist matrix |
| Chrome review surface identity | Chrome/Torn desktop | 0.6.4 | `f2ff7166…c7a73` | Packaged userscript identified; no extension source tree found | RECORDED | Do not claim extension parity |
| Real TornPDA acceptance | Genuine TornPDA runtime | 0.6.4 | — | No evidence recorded in Task 1 | OPEN | Desktop viewport is not sufficient |
| Repository/release reconciliation | Repository/release controls | 0.6.4 | `f2ff7166…c7a73` | Baseline and artifact identity recorded | OPEN | Final reconciliation is later work |
| Production hard gate | Stable/production | 0.6.4 | — | No approval or promotion performed | BLOCKED BY GATE | Stable remains 0.4.4 |

## Defect ledger

| Severity | Reproduction | Test/evidence | Fix commit/candidate | Re-test evidence |
|---|---|---|---|---|
| High | Torn sidebar handling could swallow ReviveRelay activation or duplicate the request path | 0.6.4 automated verification and real desktop click log | `b6b3d24` / immutable 0.6.4 | One physical click produced exactly one `POST /v1/requests`, HTTP 201 |
| Medium | Desktop notification preference needed to persist across reload | 0.6.4 automated verification and real desktop refresh | `b6b3d24`, evidence `1adf3ac` / immutable 0.6.4 | Disabled preference remained disabled after full Torn refresh |
| — | No additional Task 1 defect was reproduced | Documentation/release identity audit | Task 1 documentation commit | Pending later lifecycle, state, TornPDA, and Torn-review gates |

## Chrome review surface

No first-class extension source tree was found at the audited depth: no `manifest.json`, `background.js`, `popup.html`, or `options.html`. The actual reviewed Chrome surface is the packaged Tampermonkey/userscript `dist/review/ReviveRelay-0.6.4.user.js`, published at the immutable review URL and supported by review/CSP verification and its operational harness. This is recorded as an artifact identity, not as extension parity.

## Production boundary

**No production action performed.** Stable symlinks, endpoints, release artifacts, containers, databases, release metadata, and runtime services were not edited or restarted by Task 1. Public stable remains 0.4.4. Production promotion remains behind the hard gate, rollback verification, and explicit owner approval.

## Task 2 — dormant runtime lifecycle

Task 2 started from `e5e086f`. The focused tests were written before the lifecycle implementation. They reproduced that a second initialization could create a second set of intervals and navigation listeners because initialization and timer startup had no ownership guard. The runtime now treats both operations as idempotent. This is a shipping userscript change; the published 0.6.4 review artifact remains immutable and Task 8 must create the next unused patch candidate.

### Lifecycle inventory

| Primitive/path | Classification | Evidence / lifecycle ownership |
|---|---|---|
| `init`, panel creation, global error hooks, `popstate`/`hashchange` sidebar handlers | Bootstrap/reactivation required while dormant | A one-time `initialized` guard prevents duplicate DOM, listener, and timer installation while retaining Torn SPA reactivation handlers. |
| `SidebarAction` mutation observer | Bootstrap/reactivation required while dormant | The controller observes only the current sidebar/navigation ancestor, debounces reconcile, and keeps one action/capture handler; its existing focused test instruments repeated observer activity. |
| `sidebarTimer` | Bootstrap/reactivation required while dormant | Reconciles Torn SPA sidebar replacement without querying the network. |
| `requestTimer` / active-request and transaction refresh | Active-feature work | It returns before network work without session or compatible runtime; requests remain available for connected compatible requester state. |
| `proTimer` / `refreshMe` / Pro status | Bootstrap/reactivation required while dormant | The compatible path refreshes entitlement; the incompatible path performs only `refreshMe` so a recovered review runtime can reactivate. |
| `queueTimer` / queue poll and notification processing | Active-feature work | It returns unless the account has reviver subscription access; queue refresh additionally requires reviver role, usable credential, and confirmed revive ability. Notifications-off still records bounded seen IDs without delivery. |
| `invoiceTimer` / invoice poll | Active-feature work | It returns unless compatible, visible, unminimized, and a pending invoice exists. |
| `telemetryTimer` / telemetry drain | Active-feature work | It returns unless diagnostics opt-in is enabled. |
| `clockTimer` / countdown rendering | Active-feature work | It returns unless the panel is open and a transaction or queue item needs a live countdown. |
| Initial restore, manual refresh, mutation follow-up network calls | Active-feature work | Each is event-driven and has session/runtime/role/credential guards at the operation boundary; resource polling uses single-flight ownership. |
| Additional observer, queue poller, or navigation watchdog | Duplicate/unnecessary work | None added. Existing timer handles are explicit and `stopTimers()` clears every handle before a subsequent start. |

### Automated evidence

- Initial focused run after test additions: failed as expected for missing initialization/timer ownership; the notification harness was corrected because its first extraction omitted the existing `writeSeenRequestIds` dependency.
- Focused lifecycle/client/sidebar suite: `node --test test/client-hardening.test.js test/bootstrap-controls.test.js test/sidebar-action.test.js` — PASS (29 tests).
- The lifecycle harness stubs interval creation and clearing: two starts create seven intervals total, two stops clear those seven once, and a later start creates a fresh seven.
- `npm run test:client` ran the full suite: 230 passed and one immutable-review verifier failure occurred because its mandatory build generated changed 0.6.4 bytes (`e27c53a…3839e`). This is the expected candidate-integrity signal for this shipping-source change, not a product-test regression; Task 8 must mint the next patch candidate before that verifier can pass again.
- No deployed runtime or published candidate artifact was modified.
