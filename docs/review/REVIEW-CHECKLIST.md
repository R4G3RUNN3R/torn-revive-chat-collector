# ReviveRelay 0.6.5 Completion Review Checklist

This checklist governs the private immutable 0.6.5 review candidate. It is an evidence ledger, not a claim of Torn approval, production readiness, or completed manual acceptance. Historical 0.6.4 browser evidence is retained explicitly as historical evidence; any check whose behavior can be affected by 0.6.5 shipping changes requires fresh 0.6.5 acceptance.

## Candidate and release truth

- [x] Review candidate is 0.6.5, executable source commit `dee29b9ce7fa4a65654f053534d0ebe4ce9aa35e`.
- [x] Published review userscript SHA-256 is `9e065d49e6ac20d6cdeebc810a3099cd3ec1e728e455dcee7a84010ed3a26972`; the public download was hashed after publication and matches the frozen candidate exactly.
- [x] Public stable remains 0.4.4; stable current path and historical hash are recorded in `REVIVERELAY-COMPLETION-HARDENING.md`.
- [x] The frozen 0.6.5 artifact and manifest agree with `REVIVERELAY-0.6.5-AUTOMATED-VERIFICATION.md`.
- [ ] Repository/release reconciliation is complete and approved for publication.
- [ ] Production hard gate is complete, including owner approval and verified rollback.

Published review artifacts are immutable. Published 0.6.4 remains historical and must not be overwritten. Once 0.6.5 is published, any further shipping change requires the next unused patch candidate and affected acceptance must be rerun.

## Product / monetization

- [ ] Confirm requester access remains free.
- [ ] Confirm Reviver Pro trial is 7-day and one-time for eligible revivers.
- [ ] Confirm approved review prices: Monthly 10 Xanax / $10,000,000; 6 Months 55 Xanax / $55,000,000; Yearly 100 Xanax / $100,000,000.
- [ ] Confirm `$` means Torn in-game cash.
- [ ] Confirm payment destination is **R4G3RUNN3R [3877028]**.
- [ ] Confirm payment is manual in Torn and ReviveRelay never sends Cash/Xanax automatically.
- [ ] Confirm paid public launch remains awaiting Torn approval.

## Scripting / API boundary

- [ ] Confirm the 0.6.5 candidate has no public chat collection and does not scrape unfocused Torn pages.
- [ ] Confirm actual payment, revive, and Accept game actions remain manual user actions where applicable.
- [ ] Confirm the userscript has no runtime `@require`, `eval`, or remote executable-code loading.
- [ ] Confirm cross-origin userscript network access is restricted to the ReviveRelay backend.
- [ ] Review `TORN-API-DISCLOSURE.md` and `TORN-API-INVENTORY.md` for exact official Torn API operations.

## Credentials / privacy

- [ ] Confirm one-time identity key is not stored.
- [ ] Confirm persistent ReviveRelay Verification credentials are encrypted at rest.
- [ ] Confirm requester recommended access is Basic + Profile + Revives.
- [ ] Confirm reviver/combined recommended access adds Perks and restricted Money/Items logs.
- [ ] Confirm the subscription worker uses a separate restricted merchant incoming-payment credential that is never exposed to the userscript.
- [ ] Confirm users can revoke ReviveRelay Verification and delete account data.
- [ ] Confirm diagnostics are off by default and sanitized.

## Request / transaction safety

- [ ] Confirm a requester can create a request before persistent verification.
- [ ] Confirm unverified requests are hidden from the reviver queue.
- [ ] Confirm Accept rechecks requester evidence capability inside the same database transaction before starting the payment window.
- [ ] Confirm reviver queue/Accept continue to require current Torn revive ability and reviver evidence capability.
- [ ] Confirm one request cannot be accepted by two revivers.
- [ ] Confirm payment/refund evidence is idempotent and one Torn evidence reference cannot satisfy multiple obligations.

## Dormant-runtime acceptance

- [ ] Exercise disabled, unlicensed, revoked, and context-inapplicable states in the real review candidate.
- [ ] Verify active-feature polling, queue refresh, notification delivery, high-frequency DOM scans, observers, timers, and recurring network work stop when dormant.
- [ ] Verify only the documented bootstrap/reactivation surface remains while dormant.
- [ ] Verify stop/start is idempotent after Torn SPA navigation and remount: no duplicate timers, observers, listeners, requests, or notifications.

## Unknown, pending, and stale-state acceptance

- [ ] Verify loading/pending is distinct from authoritative empty/no-data.
- [ ] Verify authoritative eligible/active, denied/revoked/unauthorized, and transport/server failure are distinct states.
- [ ] Verify unknown, pending, transport failure, and stale cache never render or alert as authoritative success or failure.
- [ ] Verify stale cached data is visibly stale and cannot overwrite newer authoritative data.
- [ ] Verify actions and notifications wait for the state required by their business rule.

## Notification matrix

- [ ] Permission unavailable/denied: no notification and no leakage.
- [ ] Notifications disabled in Settings: no notification; queue and Accept controls remain usable.
- [ ] Pending/loading: no notification.
- [ ] Authoritative no-data/empty: no notification.
- [ ] Authoritative new certified request: the permitted one-shot/timed notification occurs once.
- [ ] Duplicate refresh/remount/reload: no duplicate notification.
- [ ] Invalid, stale, revoked, unauthorized, or transport-failure state: no authoritative-success notification.
- [ ] Re-enable after disable and persisted preference behavior are verified on the exact candidate.

## Exact Chrome review-surface identity

The repository contains no first-class browser-extension source tree (`manifest.json`, `background.js`, `popup.html`, or `options.html`). The current audited Chrome surface is the packaged Tampermonkey/userscript artifact `dist/review/ReviveRelay-0.6.5.user.js`. Publication and real-browser acceptance of the exact 0.6.5 bytes are recorded separately. Review/CSP verification files and the operational harness support that packaged artifact; they are not a Chrome extension package and must not be described as one.

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

## Real TornPDA acceptance

TornPDA acceptance requires a genuine TornPDA app/in-app browser on a physical device or equivalent genuine runtime; a narrow desktop viewport is not sufficient.

- [ ] Install/update and boot on real TornPDA.
- [ ] Verify sidebar/control availability, requester flow, queue presentation, filtering/sorting, and navigation/remount behavior.
- [ ] Verify verification, dormant/disabled, error, trial, and safely exercisable subscription states.
- [ ] Record any TornPDA capability difference as an explicit compatibility rule, including notification support.

## Subscription safety

- [ ] Confirm client cannot set price, duration, or merchant identity.
- [ ] Confirm invoice matching checks sender, exact currency/asset, exact amount, and invoice time window.
- [ ] Confirm one merchant evidence/log ID cannot activate two invoices.
- [ ] Confirm subscription is prepaid and does not auto-renew.

## Torn review and human evidence

- [ ] Capture the five required UI surfaces listed in `SCREENSHOT-CHECKLIST.md`.
- [ ] Perform requester browser acceptance.
- [ ] Perform non-reviver rejection browser acceptance.
- [ ] Perform eligible reviver queue/Accept browser acceptance.
- [ ] Perform review-mode subscription invoice/payment browser acceptance with controlled test conditions.
- [ ] Confirm whether ReviveRelay certified-request network notifications are acceptable to Torn; they originate from direct server requests, not public-chat scraping or background/unfocused extraction.
- [ ] Record Torn staff review outcome before any public paid promotion.

Public production must remain **0.4.4** until every required gate and explicit owner approval are complete.
