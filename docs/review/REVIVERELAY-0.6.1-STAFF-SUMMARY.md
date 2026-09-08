# ReviveRelay 0.6.1 - Torn Staff Summary

ReviveRelay 0.6.1 is an **immutable private review channel** candidate submitted so Torn staff can inspect the complete direct-request and prepaid Reviver Pro model before any paid public launch.

**Public production remains 0.4.4 and stable 0.4.4 is unchanged.** ReviveRelay 0.6.1 is not public stable/production.

## Review-runtime isolation

The 0.6.1 review userscript talks only to the dedicated review API path:

`https://reviverelay.voidsmithindustries.com/review/v1/`

Stable 0.4.4 continues to use `/v1/`. The review client requires an explicit compatible `review` runtime contract. Missing, malformed, old/stable-channel or incompatible runtime metadata fails closed. It never silently converts missing subscription state to `free`.

## What ReviveRelay does

ReviveRelay provides direct certified revive requests. A requester creates a request through ReviveRelay; an eligible reviver may see the server-certified queue and manually accept it. The 0.6.1 runtime has **no public chat collection** and does not scrape unfocused Torn pages.

Requester access is free. A request can be created immediately, but it is hidden from the reviver queue and cannot be accepted until requester evidence capability is present through ReviveRelay Verification.

Revivers additionally need ReviveRelay Verification, Torn-confirmed permanent revive ability, active reviver registration, and Reviver Pro entitlement when subscription mode is `review` or `live`.

## Trial persistence

The Reviver Pro trial is **7 days and one-time per canonical Torn identity**. Its start/end timestamps are server-authoritative. Reinstalling the userscript, clearing userscript storage, creating a new ReviveRelay session, replacing the verification key, disconnecting/reconnecting, deleting/reactivating the ReviveRelay account, or restarting the application does not reset the trial.

## OWNER entitlement

The canonical payment recipient **R4G3RUNN3R [3877028]** receives server-derived Reviver Pro state `OWNER` with **Lifetime** access and no expiry. OWNER is derived from the authenticated Torn ID plus the trusted canonical merchant configuration. It cannot be supplied by the userscript, request body or local storage.

OWNER requires no trial and cannot create a subscription invoice for itself. OWNER still must satisfy normal authentication, ReviveRelay Verification capability, permanent Torn revive ability, active reviver registration and transaction-safety checks.

## Subscription model under review

Requester access remains free. Normal eligible revivers have the one-time 7-day trial, then these prepaid options:

| Period | Xanax | Torn cash |
| --- | ---: | ---: |
| Monthly | 10 Xanax | $10,000,000 |
| 6 Months | 55 Xanax | $55,000,000 |
| Yearly | 100 Xanax | $100,000,000 |

Payment destination: **R4G3RUNN3R [3877028]**.

`$` means Torn in-game cash. The user sends payment **manually in Torn**. ReviveRelay never initiates Torn cash/item transfers. A dedicated review billing scanner verifies exact incoming evidence using a server-only restricted merchant credential. It is deliberately isolated from the stable 0.4.4 generic worker queue.

Paid public launch is **awaiting Torn approval**. If monetization is not approved, the product can revert to `free` entitlement policy without deleting the billing architecture.

## Torn API / privacy boundary

- One-time identity binding uses Torn identity/key information; the identity key is not stored.
- Requester verification uses Basic + Profile + Revives.
- Reviver/combined verification adds Perks and restricted Money/Items transaction-log evidence.
- Persistent user verification credentials are **encrypted at rest** and never returned plaintext after binding.
- The merchant credential is a separate **restricted merchant** credential and is never exposed to the userscript.
- Diagnostics are **off by default**.
- Users can revoke ReviveRelay Verification and delete operational ReviveRelay account data; minimal payment-reuse/security/audit history is retained where necessary.

## Manual game-action boundary

ReviveRelay does not auto-accept revive requests, automatically revive a player, automatically send Cash/Xanax, bypass CAPTCHA, or make hidden non-API Torn game requests. Payment and the actual revive remain manual Torn actions.

## Explicit question for Torn

Please confirm whether **certified-request network notifications** are acceptable under Torn's scripting rules. These notifications originate from requests submitted directly to the ReviveRelay server and do **not** depend on public-chat scraping or background/unfocused Torn-page extraction.

## Review evidence

The package includes source, immutable review userscript/meta artifacts, privacy/security/API disclosures, endpoint and Torn API inventories, payment-verification flow, build manifest, automated verification report, and screenshot checklist.

Request, Reviver, Activity, Pro and Settings screenshots/manual browser acceptance remain **pending human capture**. This document does not claim Torn approval or completed manual acceptance.
