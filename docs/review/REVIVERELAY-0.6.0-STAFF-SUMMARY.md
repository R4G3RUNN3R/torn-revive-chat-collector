# ReviveRelay 0.6.0 - Torn Staff Summary

ReviveRelay 0.6.0 is a **private review channel** candidate submitted so Torn staff can inspect the intended feature set, including the prepaid Reviver Pro model, before any paid public launch.

**Public production remains 0.4.4.** Version 0.6.0 has not been promoted to public stable/production.

## What ReviveRelay does

ReviveRelay provides direct certified revive requests. A requester creates a request through ReviveRelay; an eligible reviver may see the server-certified queue and manually accept a request. The 0.6.0 runtime has **no public chat collection** and does not scrape unfocused Torn pages.

Requester access is free. A request may be created immediately, but it is hidden from the reviver queue and cannot be accepted until the requester has a narrowly scoped ReviveRelay Verification credential capable of later profile/revive evidence checks.

Revivers additionally need ReviveRelay Verification, Torn-confirmed permanent revive ability, active reviver registration, and an active Reviver Pro entitlement when the server is in `review` or `live` subscription mode.

## Torn API access

- One-time identity binding: `/key/info` and `/user/basic`; the submitted identity key is not stored.
- Requester verification: Basic + Profile + Revives.
- Reviver/combined verification: requester scope plus Perks and restricted Money/Items log evidence.
- Persistent user verification credentials are **encrypted at rest** and never returned plaintext after binding.
- Subscription receipt verification uses a separate **restricted merchant** incoming-payment credential on the canonical receiving account. It is not exposed to the userscript.

## Subscription model under review

Requester access remains free. Eligible revivers have a one-time **7-day** Reviver Pro trial.

| Period | Xanax | Torn cash |
| --- | ---: | ---: |
| Monthly | 10 Xanax | $10,000,000 |
| 6 Months | 55 Xanax | $55,000,000 |
| Yearly | 100 Xanax | $100,000,000 |

Payment destination: **R4G3RUNN3R [3877028]**.

The `$` amounts are Torn in-game cash. Payment is sent **manually in Torn** by the user. ReviveRelay does not initiate Torn cash/item transfers. The server verifies exact incoming merchant evidence and prevents one Torn payment event from activating multiple invoices.

Paid public launch is **awaiting Torn approval**. If monetization is not approved, the same backend can operate in `free` mode without requiring subscription payments.

## Privacy / user control

- Diagnostics are **off by default**.
- Users can revoke ReviveRelay Verification and separately delete the key in Torn API settings.
- Users can delete ReviveRelay account data. Credentials, sessions, active reviver registration and user-linked raw telemetry are removed; minimal billing/payment-reuse and security/audit history is retained where necessary.
- ReviveRelay does not ask for a Torn password.

## Manual game-action boundary

ReviveRelay does not auto-accept revive requests, automatically revive a player, automatically send Cash/Xanax, bypass CAPTCHA, or make hidden non-API Torn game requests. The actual payment and revive remain manual Torn actions.

## Explicit question for Torn

Please confirm whether **certified-request network notifications** are acceptable under Torn's scripting rules. These notifications are generated from requests submitted directly to the ReviveRelay server by ReviveRelay users. They do **not** depend on public-chat scraping or background/unfocused Torn-page extraction.

## Review evidence

The package includes source, the exact self-contained review userscript, privacy/security/API disclosures, endpoint and Torn API inventories, payment-verification flow, build manifest, automated test/audit report, and a screenshot checklist.

Request, Reviver, Activity, Pro and Settings screenshots/manual browser acceptance are intentionally marked **pending human capture**. This document does not claim Torn approval or manual acceptance has already occurred.
