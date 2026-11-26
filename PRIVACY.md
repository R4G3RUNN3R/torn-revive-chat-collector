# ReviveRelay Privacy

This document describes the implemented ReviveRelay 1.0.1 review candidate. Public Stable remains 0.4.4; Beta/Review distribution is tracked separately.

## Data Storage

ReviveRelay stores only service data needed to operate direct certified revive requests, reviver eligibility, transaction evidence, subscriptions, security controls and supportable audit history. This can include Torn user ID and current display name, ReviveRelay sessions, request/transaction state, reviver registration, subscription/invoice records, payment/refund evidence references and audit events.

ReviveRelay uses one Torn API key per account. The same Torn API key submitted to `/v1/auth/bind` to resolve identity is also submitted to `/v1/verification-credential` to establish the persistent ReviveRelay Verification credential used for later evidence checks; no second key is requested. That credential is encrypted at rest with AES-GCM using server-side key material held outside PostgreSQL. Plaintext Torn API keys are not returned to the userscript after binding.

From ReviveRelay 1.0 the server also stores:

- **Last seen:** the time each ReviveRelay session last made an authenticated request, updated at most once per minute. It is used only to count how many revivers are online. It is deleted with the session (including on account deletion).
- **Waiting-request status:** for a request that is waiting for a reviver, the requester's hospital-until time, whether they are hospitalised abroad, and when that was last checked. It is read from the requester's own Torn profile (see `TORN-API-DISCLOSURE.md`) and kept on the request record with the rest of that request's history.

On TornPDA 3.15+, ReviveRelay prefers TornPDA's per-script `PDA_storage` for client-side session/UI preferences because it survives browser-cache clearing and is isolated by script namespace. If native storage is unavailable or a write fails, ReviveRelay degrades to the existing GM-compatible storage path rather than silently becoming memory-only. ReviveRelay does not automatically consume TornPDA's global Torn API key.

## Data Sharing

ReviveRelay does not sell user data and does not share stored user data with advertisers or unrelated third parties.

Within ReviveRelay, from 1.0:

- revivers who can see the request queue also see a waiting requester's hospital time remaining and whether they are abroad;
- any logged-in user sees only the **number** of revivers online, never who they are;
- any logged-in user can check whether a given Torn ID is a verified ReviveRelay requester and/or reviver (the profile badge). Nothing else about that account is shown. The backend sends only the requests required to the official Torn API to perform the user-authorized identity, eligibility and evidence checks described in `TORN-API-DISCLOSURE.md`.
- from 1.0.1, while you are signed in and a Torn profile page is visible, the client automatically sends that profile's Torn ID to ReviveRelay to look up its badge (opt out in Settings → Notifications). The result is cached in your browser for 10 minutes.

## Purpose of Use

Stored information is used to:

- bind a Torn identity to an opaque ReviveRelay session;
- create and manage direct certified revive requests;
- show revivers a waiting requester's hospital time and abroad status, show requesters how many revivers are online, and show verification badges;
- verify requester evidence capability before a request may be accepted;
- confirm permanent reviver ability and reviver eligibility;
- reconcile revive, Cash/Xanax payment and refund evidence;
- prevent duplicate transaction/payment evidence use;
- operate the 7-day Reviver Pro trial and prepaid subscription entitlement;
- protect the service from abuse and retain a bounded audit trail.

ReviveRelay 1.0.1 does **not scrape public chat** and performs no public chat collection.

## Diagnostics

ReviveRelay 1.0.1 sends **no client diagnostics**. The Diagnostics option of clients before 1.0.1, which was off by default, is removed; the server keeps accepting bounded, sanitized envelopes from older clients that still have it enabled.

If an older client queued diagnostics in your userscript manager's storage, 1.0.1 never sends them; they stay in your browser and are cleared when you delete your ReviveRelay account.

Raw telemetry occurrences are deleted by the implemented retention job after 30 days. Aggregate error fingerprints/version statistics may be retained for regression analysis.

## Revocation

Users can revoke ReviveRelay Verification from Settings. Revoking it removes ReviveRelay's active use of that stored credential. To invalidate the key at Torn as well, the user must also delete that key in Torn API settings.

## Account deletion

The implemented account deletion flow:

- cancels still-available requests;
- cancels pending Pro invoices;
- deletes ReviveRelay Verification credentials;
- deletes active ReviveRelay sessions;
- deletes active reviver registration;
- deletes user-linked raw error occurrences;
- changes the account state to deleted and replaces the current display name with a deleted-account marker.

Minimal historical records are intentionally retained where necessary for **billing history, payment reuse protection and security audit history**. This prevents a previously consumed Torn payment event from being reused and preserves evidence required for refunds, disputes and service integrity.

## Payment information

Where the review/live subscription mode is enabled, subscription payment is made manually in Torn to **R4G3RUNN3R [3877028]**. ReviveRelay does not process real-world card or bank data. `$` prices in the UI mean Torn in-game cash.

## Contact / review status

ReviveRelay 1.0.1 is a review candidate. Paid public launch is awaiting Torn approval and explicit owner promotion. The review package intentionally does not claim that manual browser acceptance or Torn approval has already occurred.
