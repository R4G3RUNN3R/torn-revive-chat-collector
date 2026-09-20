# ReviveRelay 0.6.6 Completion Review Checklist

This checklist governs the private immutable 0.6.6 review candidate. It is an evidence ledger, not a claim of Torn approval, production readiness, or completed manual acceptance. Historical 0.6.4 and 0.6.5 browser evidence is retained explicitly as historical evidence; any check whose behavior can be affected by 0.6.6 shipping changes requires fresh 0.6.6 acceptance.

## Candidate and release truth

- [x] Review candidate is 0.6.6, executable source commit `f499265a1b1d07df01c19e120c1eebf37e395e6d`. Locally reproduced this session via `node scripts/build.js` / `node scripts/verify-review-artifact.js`, matching `docs/review/BUILD-MANIFEST.json` exactly.
- [x] Published review userscript SHA-256 is `1f4885c25f9340e6730e0e844ff1172784d8edb12a6c2e32bc11bffc45d160cb`, identical to the local reproducible build. Controller-reported live review-channel verification states the public download hashes to the same value; this sandboxed worktree session had no Bash network egress and did not independently re-hash the live download itself, so that specific fact is recorded as controller-reported, not self-observed.
- [x] Public stable remains 0.4.4; stable current path and historical hash are recorded in `REVIVERELAY-COMPLETION-HARDENING.md`.
- [x] The frozen 0.6.6 artifact and manifest agree with `REVIVERELAY-0.6.6-AUTOMATED-VERIFICATION.md`.
- [ ] Repository/release reconciliation is complete and approved for publication.
- [ ] Production hard gate is complete, including owner approval and verified rollback.

Published review artifacts are immutable. Published 0.6.4 and 0.6.5 remain historical and must not be overwritten. Once 0.6.6 is published, any further shipping change requires the next unused patch candidate and affected acceptance must be rerun.

## Product / monetization

- [x] Confirm requester access remains free.
- [x] Confirm Reviver Pro trial is 7-day and one-time for eligible revivers.
- [x] Confirm approved review prices: Monthly 10 Xanax / $10,000,000; 6 Months 55 Xanax / $55,000,000; Yearly 100 Xanax / $100,000,000.
- [x] Confirm `$` means Torn in-game cash.
- [x] Confirm payment destination is **R4G3RUNN3R [3877028]**.
- [x] Confirm payment is manual in Torn and ReviveRelay never sends Cash/Xanax automatically.
- [x] Confirm paid public launch remains awaiting Torn approval.

## Scripting / API boundary

- [x] Confirm the 0.6.6 candidate has no public chat collection and does not scrape unfocused Torn pages. Reconfirmed this session: `npm run audit:review` — 15 files audited / 0 findings.
- [x] Confirm actual payment, revive, and Accept game actions remain manual user actions where applicable.
- [x] Confirm the userscript has no runtime `@require`, `eval`, or remote executable-code loading.
- [x] Confirm cross-origin userscript network access is restricted to the ReviveRelay backend.
- [x] Review `TORN-API-DISCLOSURE.md` and `TORN-API-INVENTORY.md` for exact official Torn API operations.

## Credentials / privacy

- [x] Confirm one-time identity key is not stored.
- [x] Confirm persistent ReviveRelay Verification credentials are encrypted at rest.
- [x] Confirm requester recommended access is Basic + Profile + Revives.
- [x] Confirm reviver/combined recommended access adds Perks and restricted Money/Items logs.
- [x] Confirm the subscription worker uses a separate restricted merchant incoming-payment credential that is never exposed to the userscript.
- [x] Confirm users can revoke ReviveRelay Verification and delete account data.
- [x] Confirm diagnostics are off by default and sanitized.

## Request / transaction safety

- [x] Confirm a requester can create a request before persistent verification.
- [x] Confirm unverified requests are hidden from the reviver queue.
- [x] Confirm Accept rechecks requester evidence capability inside the same database transaction before starting the payment window.
- [x] Confirm reviver queue/Accept continue to require current Torn revive ability and reviver evidence capability.
- [x] Confirm one request cannot be accepted by two revivers.
- [x] Confirm payment/refund evidence is idempotent and one Torn evidence reference cannot satisfy multiple obligations.

## Dormant-runtime acceptance

- [ ] Exercise disabled, unlicensed, revoked, and context-inapplicable states in the real review candidate.
- [ ] Verify active-feature polling, queue refresh, notification delivery, high-frequency DOM scans, observers, timers, and recurring network work stop when dormant.
- [ ] Verify only the documented bootstrap/reactivation surface remains while dormant.
- [ ] Verify stop/start is idempotent after Torn SPA navigation and remount: no duplicate timers, observers, listeners, requests, or notifications.

## Unknown, pending, and stale-state acceptance

- [x] Verify loading/pending is distinct from authoritative empty/no-data.
- [x] Verify authoritative eligible/active, denied/revoked/unauthorized, and transport/server failure are distinct states.
- [x] Verify unknown, pending, transport failure, and stale cache never render or alert as authoritative success or failure.
- [x] Verify stale cached data is visibly stale and cannot overwrite newer authoritative data. Current 0.6.6 does not persist entitlement/queue state as an authoritative cache; delayed older responses are revision-rejected, so no stale persisted success state is available to render as current. This client state-authority behavior was not touched by the 0.6.6 trust-boundary/queue-UI changes (see `REVIVERELAY-0.6.6-RELEASE-NOTES.md` "Preserved contracts").
- [x] Verify actions and notifications wait for the state required by their business rule.

## Notification matrix

- [x] Permission unavailable/denied: no notification and no leakage.
- [x] Notifications disabled in Settings: no notification; queue and Accept controls remain usable.
- [x] Pending/loading: no notification.
- [x] Authoritative no-data/empty: no notification.
- [x] Authoritative new certified request: the permitted one-shot/timed notification occurs once.
- [x] Duplicate refresh/remount/reload: no duplicate notification.
- [x] Invalid, stale, revoked, unauthorized, or transport-failure state: no authoritative-success notification.
- [x] Re-enable after disable and persisted preference behavior are verified on the exact candidate.

## Exact Chrome review-surface identity

The repository contains no first-class browser-extension source tree (`manifest.json`, `background.js`, `popup.html`, or `options.html`). The current audited Chrome surface is the packaged Tampermonkey/userscript artifact `dist/review/ReviveRelay-0.6.6.user.js`. Publication and real-browser acceptance of the exact 0.6.6 bytes are recorded separately. Review/CSP verification files and the operational harness support that packaged artifact; they are not a Chrome extension package and must not be described as one.

## 0.6.4 desktop browser evidence

- [x] OWNER browser ran private review 0.6.4 with the Torn sidebar action in READY state.
- [x] One physical **ReviveRelay → Revive Me!** click produced exactly one `POST /v1/requests` on the isolated review API.
- [x] The review API returned HTTP `201` for request `req-92`; the active certified request was visible with State AVAILABLE, offer `$750,000`, message `Rev please!`, and queue count increased to 2.
- [x] Cancel returned the UI to Request None, removed the active request, preserved the `$750,000` / `Rev please!` preset, reduced the queue count from 2 to 1, and recorded HTTP 200 for cancellation.
- [x] Desktop notifications were disabled in Settings and remained disabled after a full Torn refresh.
- [ ] Complete the remaining desktop matrix: install/update, remount, self-revive protection, grouping/filter/sort, verification/revoked states, trial/expired/unlicensed/paid states, subscription flow, notification matrix, responsive layout, keyboard/focus behavior, and duplicate-work checks.

## 0.6.5 desktop browser re-test

0.6.5 replaces 0.6.4 as the current candidate because 0.6.4 intermittently failed to deliver a sidebar request after full Torn refresh, even after waiting more than ten seconds while the action still reported READY. The review API saw no POST in either failed attempt.

- [ ] Exact published 0.6.5 userscript is installed and header reports v0.6.5.
- [ ] After a full Torn refresh, OWNER/reviver state and the saved `$750,000` / `Rev please!` preset remain intact.
- [ ] Desktop notifications remain OFF after update/reload.
- [ ] Sidebar reports READY after reload.
- [x] One physical sidebar activation produced exactly one `POST /v1/requests` on the review API; request `req-ze` completed HTTP 201 and a fresh three-minute log count contained exactly one matching POST.
- [x] Request tab displays the resulting active certified request; owner confirmed the active request was visible immediately after the successful 0.6.5 sidebar activation.
- [x] With Desktop notifications OFF, no desktop notification was emitted for the newly observed certified request while the request remained visible and normal polling continued.
- [x] Test request cancelled cleanly on 0.6.5; review API request `req-163` returned HTTP 200. Owner reported completion of the instructed cancel/preset-preservation check.

0.6.5 evidence above is retained as historical: it is real acceptance evidence gathered against the exact published 0.6.5 bytes, and it remains valid for surfaces 0.6.6 did not touch. It does not stand in for 0.6.6 acceptance and does not cover the 0.6.6 trust-boundary or queue-control changes below.

## 0.6.6 desktop browser acceptance

0.6.6 replaces 0.6.5 as the current candidate. Task 4 found published 0.6.5 accepted an off-origin update-manifest URL and an artifact whose embedded `API_BASE` had been altered while keeping the approved `@connect` declaration; 0.6.6 also adds certified-queue payment filtering, minimum-offer filtering, sorting, grouping, and an explicit refresh control. No completion claim is made for any item below; only the automated gate recorded in `REVIVERELAY-0.6.6-AUTOMATED-VERIFICATION.md` has run against the exact 0.6.6 bytes.

- [ ] Exact published 0.6.6 userscript is installed and header reports v0.6.6.
- [ ] After a full Torn refresh, OWNER/reviver state and the saved preset remain intact; sidebar reports READY.
- [ ] Desktop notifications remain OFF after update/reload.
- [ ] One physical sidebar activation produces exactly one `POST /v1/requests`; the resulting certified request is visible; cancel returns the UI to Request None with HTTP 200.
- [ ] Certified queue payment filter (All/Cash/Xanax), independent minimum Cash/Xanax filters, newest/oldest and offer sorting, optional grouping, and the explicit `Refresh queue` control behave as designed on the real candidate.
- [ ] A crafted or off-origin update manifest cannot open an off-origin install URL from the real running candidate.
- [ ] Standard responsive/narrow-viewport queue-control layout and stable filter focus are confirmed on the real candidate.

## Real TornPDA acceptance

TornPDA acceptance requires a genuine TornPDA app/in-app browser on a physical device or equivalent genuine runtime; a narrow desktop viewport is not sufficient.

- [ ] Fresh install on real TornPDA opens the panel normally, keeps Diagnostics OFF by default, and creates no bogus session or preset state.
- [ ] Install/update and boot on real TornPDA; confirm the native script manager detects a newer ReviveRelay build and the validated ReviveRelay update action navigates to the approved install URL.
- [ ] Confirm Create API key opens the intended Torn API-key page inside the TornPDA WebView.
- [ ] Background/suspend and resume during an in-flight request recovers after the bounded request timeout and refreshes authoritative state.
- [ ] Verify sidebar/control availability, requester flow, queue presentation, filtering/sorting, and navigation/remount behavior.
- [ ] Verify verification, dormant/disabled, error, trial, and safely exercisable subscription states, including POST-based account deletion and Verification-key revocation.
- [ ] Verify multiple certified-request notifications stack visibly rather than overlap; record that notification delivery is in-page and therefore not guaranteed while TornPDA is suspended/backgrounded.
- [ ] Rotate portrait/landscape and confirm safe-area placement, scrolling, touch targets, keyboard behavior and minimize/restore access.
- [ ] Close/reopen TornPDA after a simulated/faulted storage fallback and confirm the latest session/UI state is reconciled rather than stale native state returning.
- [ ] Record any TornPDA capability difference as an explicit compatibility rule, including notification support.

## Subscription safety

- [x] Confirm client cannot set price, duration, or merchant identity.
- [x] Confirm invoice matching checks sender, exact currency/asset, exact amount, and invoice time window.
- [x] Confirm one merchant evidence/log ID cannot activate two invoices.
- [x] Confirm subscription is prepaid and does not auto-renew.

## Torn review and human evidence

- [ ] Capture the five required UI surfaces listed in `SCREENSHOT-CHECKLIST.md`.
- [x] Perform requester browser acceptance.
- [ ] Perform non-reviver rejection browser acceptance. **Machine equivalent PASS:** focused server matrix proves non-reviver sessions cannot view or accept the queue.
- [ ] Perform eligible reviver queue/Accept browser acceptance. **Machine equivalent PASS:** focused server matrix proves authenticated eligible reviver queue/Accept, current ability/credential gates, self-accept rejection and one-winner concurrency.
- [ ] Perform review-mode subscription invoice/payment browser acceptance with controlled test conditions. **Machine equivalent PASS:** focused client/server matrix proves server-owned pricing, safe merchant rendering, exact evidence matching, one-time activation and no client price/duration injection.
- [ ] Confirm whether ReviveRelay certified-request network notifications are acceptable to Torn; they originate from direct server requests, not public-chat scraping or background/unfocused extraction.
- [ ] Record Torn staff review outcome before any public paid promotion.

Public production must remain **0.4.4** until every required gate and explicit owner approval are complete.
