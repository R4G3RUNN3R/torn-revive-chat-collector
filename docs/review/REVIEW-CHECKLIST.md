# ReviveRelay 0.6.1 Torn Review Checklist

This checklist is for the private review candidate. It does not represent Torn approval or completed manual browser acceptance.

## Product / monetization

- [ ] Confirm requester access remains free.
- [ ] Confirm Reviver Pro trial is 7-day and one-time for eligible revivers.
- [ ] Confirm approved review prices: Monthly 10 Xanax / $10,000,000; 6 Months 55 Xanax / $55,000,000; Yearly 100 Xanax / $100,000,000.
- [ ] Confirm `$` means Torn in-game cash.
- [ ] Confirm payment destination is **R4G3RUNN3R [3877028]**.
- [ ] Confirm payment is manual in Torn and ReviveRelay never sends Cash/Xanax automatically.
- [ ] Confirm paid public launch remains awaiting Torn approval.

## Scripting / API boundary

- [ ] Confirm 0.6.1 has no public chat collection and does not scrape unfocused Torn pages.
- [ ] Confirm actual payment/revive/Accept game actions remain manual user actions where applicable.
- [ ] Confirm the userscript has no runtime `@require`, `eval` or remote executable-code loading.
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
- [ ] Confirm `Accept` rechecks requester evidence capability inside the same database transaction before starting the payment window.
- [ ] Confirm reviver queue/Accept continue to require current Torn revive ability and reviver evidence capability.
- [ ] Confirm one request cannot be accepted by two revivers.
- [ ] Confirm payment/refund evidence is idempotent and one Torn evidence reference cannot satisfy multiple obligations.

## Subscription safety

- [ ] Confirm client cannot set price, duration or merchant identity.
- [ ] Confirm invoice matching checks sender, exact currency/asset, exact amount and invoice time window.
- [ ] Confirm one merchant evidence/log ID cannot activate two invoices.
- [ ] Confirm subscription is prepaid and does not auto-renew.

## Explicit Torn question

- [ ] **Please confirm whether ReviveRelay certified-request network notifications are acceptable.** These notifications are created from direct requests submitted to the ReviveRelay server, not from public-chat scraping or background/unfocused Torn-page extraction.

## Human/manual evidence still required

- [ ] Capture the five required UI surfaces listed in `SCREENSHOT-CHECKLIST.md`.
- [ ] Perform requester browser acceptance.
- [ ] Perform non-reviver rejection browser acceptance.
- [ ] Perform eligible reviver queue/Accept browser acceptance.
- [ ] Perform review-mode subscription invoice/payment browser acceptance with controlled test conditions.
- [ ] Record Torn staff review outcome before any public paid promotion.

Public production must remain **0.4.4** until these gates and explicit owner approval are complete.

## 0.6.4 browser acceptance evidence — 2026-09-10

- [x] OWNER browser was running private review 0.6.4 with the Torn sidebar action in READY state.
- [x] One physical click on **ReviveRelay → Revive Me!** produced exactly one `POST /v1/requests` on the isolated review API.
- [x] The review API returned HTTP `201` for that request (`req-92`, 24.5 ms), proving the sidebar activation reached the certified-request endpoint successfully.
- [ ] Confirm the Request tab visibly shows the resulting active certified request before closing requester browser acceptance.

This proves the 0.6.4 capture/delegation sidebar repair in a real Torn browser. It does not by itself complete the remaining Task 12 trial, expired-trial, reviver, subscription, or Torn-review gates.
