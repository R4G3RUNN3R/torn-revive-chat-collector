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

Task 2 started from `e5e086f`. The bootstrap has one reachable call site: either the one-time `DOMContentLoaded` listener or the immediate document-idle branch. A second userscript injection has a fresh IIFE, so an internal initialization guard would not address it. No reachable duplicate-init or stop/start defect was found; no synthetic timer lifecycle code is retained.

Focused, executable coverage did prove one dormant Pro-only defect: an eligibility request that failed as `UNAVAILABLE` was retried by every later entitlement tick. `refreshReviverEligibility()` now retains that terminal marker and makes no further eligibility request until a normal reactivation path resets state. This is a shipping userscript change; the published 0.6.4 review artifact remains immutable and Task 8 must create the next unused patch candidate.

### Lifecycle inventory

| Primitive/path | Classification | Evidence / lifecycle ownership |
|---|---|---|
| `init`, panel creation, global error hooks, `popstate`/`hashchange` sidebar handlers | Bootstrap/reactivation required while dormant | The one-time DOMContentLoaded bootstrap (or document-idle immediate branch) installs the compatible Torn SPA reactivation handlers. No reachable repeated-init caller exists. |
| `SidebarAction` mutation observer | Bootstrap/reactivation required while dormant | The controller observes only the current sidebar/navigation ancestor, debounces reconcile, and keeps one action/capture handler; its existing focused test instruments repeated observer activity. |
| `sidebarTimer` | Bootstrap/reactivation required while dormant | Reconciles Torn SPA sidebar replacement without querying the network. |
| `requestTimer` / active-request and transaction refresh | Active-feature work | It returns before network work without session or compatible runtime; requests remain available for connected compatible requester state. |
| `proTimer` / `refreshMe` / Pro status / eligibility | Bootstrap/reactivation required while dormant | The compatible path refreshes entitlement; the incompatible path performs only `refreshMe` so a recovered review runtime can reactivate. Eligibility polling stops after `UNAVAILABLE`; it also makes no request while unlicensed or without the reviver credential. |
| `queueTimer` / queue poll and notification processing | Active-feature work | It returns unless the account has reviver subscription access; queue refresh additionally requires reviver role, usable credential, and confirmed revive ability. Notifications-off still records bounded seen IDs without delivery. |
| `invoiceTimer` / invoice poll | Active-feature work | It returns unless compatible, visible, unminimized, and a pending invoice exists. |
| `telemetryTimer` / telemetry drain | Active-feature work | It returns unless diagnostics opt-in is enabled. |
| `clockTimer` / countdown rendering | Active-feature work | It returns unless the panel is open and a transaction or queue item needs a live countdown. |
| Initial restore, manual refresh, mutation follow-up network calls | Active-feature work | Each is event-driven and has session/runtime/role/credential guards at the operation boundary; resource polling uses single-flight ownership. |
| Additional observer, queue poller, navigation watchdog, or timer teardown | Duplicate/unnecessary work | None added. A teardown operation has no reachable lifecycle owner and is not retained. |

### Automated evidence

- The eligibility test first failed: a second execution after the failed request made a second network call; it also caught and rejected clearing the `UNAVAILABLE` marker. It now executes unavailable, unlicensed, and inapplicable states and asserts their endpoint-call counts.
- The notification test executes suppression and bounded seen-ID persistence. The sidebar observer test asserts one pending debounce callback and one action/capture handler after repeated callbacks; the existing rebuild test covers sidebar replacement.
- Focused lifecycle/client/sidebar suite: `node --test test/client-hardening.test.js test/bootstrap-controls.test.js test/sidebar-action.test.js` — PASS (28 tests).
- Full client-suite evidence is recorded in the Task 2 report after its final run.
- No deployed runtime or published candidate artifact was modified.

## Task 3 — unknown, pending, stale, and denied state semantics

Task 3 started from `a8a76c4`. It records the client boundary contract below. “Authoritative refresh” means a successful response from the validated direct API for the current state revision; cached public identity, a prior response, or a transport failure is never authority for entitlement or queue contents.

| State | UI text | Actions | Notifications | Cache / refresh rule |
|---|---|---|---|---|
| Loading/pending verification | “Checking the ReviveRelay review backend…” | Protected controls disabled | Never | Require authoritative runtime refresh |
| Authoritative empty/no-data queue | Empty queue card | No queue Accept action | None | Successful empty array replaces prior queue |
| Active/success | Server-provided `TRIAL`, `ACTIVE`, or `OWNER` | Allowed only with role, usable credential, and confirmed ability | Eligible only with all guards | Current authoritative response only |
| Unlicensed | Server-provided `NONE` / no paid access | Reviver queue and Accept disabled in paid modes | Never | Require authoritative entitlement refresh |
| Trial | Server-provided `TRIAL` | Normal gated reviver actions | Eligible only with all guards | Current authoritative entitlement response |
| Expired trial | Server-provided non-active status | Reviver queue and Accept disabled | Never | Require authoritative entitlement refresh |
| Revoked | Server-provided `REVOKED` | Reviver queue and Accept disabled, including free-mode fallback | Never; no request details disclosed | Cannot be replaced by an older response |
| Unauthorized/denied | Compatibility/auth error or eligibility `DENIED` | Protected controls disabled; genuine session auth failure reconnects | Never | Do not convert to entitlement state; refresh after reconnect/authority recovery |
| Transport/server failure | User-facing failure message | Existing known state remains; no new protected access | Never from failed/no-data queue | Do not write an empty queue or unlicensed/revoked state; retry on normal polling |
| Stale cached state | No entitlement/queue cache is persisted | Existing authoritative action gates remain | Never if guards are incomplete | Cached public identity cannot grant access; require authoritative refresh |
| Delayed older response | No terminal-state copy is rendered from it | No action change | No notification from discarded queue response | Per-resource revision rejects it when newer authority/mutation exists |
| Unknown/not-yet-verified | “Checking…” / review-backend unavailable | Protected controls disabled | Never | Require authoritative runtime contract before subscription evaluation |
| Payment pending | `PENDING` invoice | Payment-status check only | None | Require invoice plus entitlement refresh |
| Payment observed, entitlement pending | `VERIFYING` invoice | No paid access implied | None | Do not render `PAID` until backend status is `ACTIVE` |

### Automated evidence

- The corrective focused red run, retained in the Task 3 report, executed real delayed promises through `refreshReviverQueue()`, `revokeVerificationKey()`, `deleteReviveRelayAccount()`, and `refreshMe()`. It failed because a queue response repopulated request details after revocation and a delayed `/me` response replaced `REVOKED` with `ACTIVE`.
- The executable regression tests now also execute delayed eligibility, a rejected queue transport, an authoritative empty queue, and `renderInvoice()`’s paid-versus-verified transition. Transport failure retains the known queue; only a successful empty response clears it.
- The implementation applies per-resource revisions to `/me` and eligibility writes, invalidates queue/eligibility/invoice revisions on incompatible runtime, revocation, and account deletion, and keeps all corrections client-side. No server routes/domain behavior, deployed runtime directories, or immutable 0.6.4 artifact was altered. A new patch candidate is required before shipping this userscript change.

## 2026-09-11 self-run acceptance consolidation

The owner delegated the remaining executable test work to the controller. The current immutable candidate is now 0.6.5, source `dee29b9ce7fa4a65654f053534d0ebe4ce9aa35e`, SHA-256 `9e065d49e6ac20d6cdeebc810a3099cd3ec1e728e455dcee7a84010ed3a26972`. Public stable remains 0.4.4 at SHA-256 `1e6d84d5dd85cf8e2501ea391243767a37745ca20b197cb5a030a57d0da57fa6`.

Fresh controller-run evidence on disposable PostgreSQL 16 infrastructure passed the complete `verify:review` gate: client 239/239, server 335/335, release/provenance 4/4, syntax pass, audit 15 files/0 findings, and immutable verification before/after. Focused follow-up matrices passed 70/70 client/UI/security, 68/68 server entitlement/reviver/subscription, and 13/13 trust-boundary/release tests. Both disposable database containers used for these runs were stopped and auto-removed.

The machine matrix therefore supports the subscription/trial, non-reviver rejection, eligible-reviver authorization, self-accept rejection, concurrent-Accept exclusion, verification gating, payment evidence matching, notification suppression/deduplication, stale-state, privacy, credential, network and release-boundary assertions. These are not relabelled as real-browser/TornPDA evidence where the approved design explicitly requires a genuine platform.

Two acceptance boundaries remain technically important:

1. The current direct 0.6.5 queue has no Cash/Xanax filter, offer-value filter/sort, or grouping control although the completion-hardening design still names grouping/filter/sort. That criterion is a specification/product discrepancy and remains OPEN rather than being fabricated as a pass.
2. Current dormant lifecycle ownership intentionally preserves bootstrap/reactivation timers/handlers while active-feature callbacks fail closed and avoid unnecessary protected network work. The stricter literal reading that every timer/observer must be torn down is not what the implemented Task 2 lifecycle model does; changing that would be an architectural change and requires an explicit new candidate rather than checklist editing.

Real TornPDA execution, cross-account real-browser evidence that is explicitly required as browser evidence, controlled manual Torn payment UI evidence, Torn notification-policy review, Torn staff approval and the production hard gate remain external. No production action was performed.
