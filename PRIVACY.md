# ReviveRelay Privacy

This document describes the implemented ReviveRelay 0.6.1 review candidate. Public production remains 0.4.4.

## Data Storage

ReviveRelay stores only service data needed to operate direct certified revive requests, reviver eligibility, transaction evidence, subscriptions, security controls and supportable audit history. This can include Torn user ID and current display name, ReviveRelay sessions, request/transaction state, reviver registration, subscription/invoice records, payment/refund evidence references and audit events.

The one-time Torn identity key submitted to `/v1/auth/bind` is used to resolve identity and is not persisted by ReviveRelay. A separate **ReviveRelay Verification** key may be stored for later evidence checks. That credential is encrypted at rest with AES-GCM using server-side key material held outside PostgreSQL. Plaintext verification credentials are not returned to the userscript after binding.

## Data Sharing

ReviveRelay does not sell user data and does not share stored user data with advertisers or unrelated third parties. The backend sends only the requests required to the official Torn API to perform the user-authorized identity, eligibility and evidence checks described in `TORN-API-DISCLOSURE.md`.

## Purpose of Use

Stored information is used to:

- bind a Torn identity to an opaque ReviveRelay session;
- create and manage direct certified revive requests;
- verify requester evidence capability before a request may be accepted;
- confirm permanent reviver ability and reviver eligibility;
- reconcile revive, Cash/Xanax payment and refund evidence;
- prevent duplicate transaction/payment evidence use;
- operate the 7-day Reviver Pro trial and prepaid subscription entitlement;
- protect the service from abuse and retain a bounded audit trail.

ReviveRelay 0.6.1 does **not scrape public chat** and performs no public chat collection.

## Diagnostics

Sanitized client diagnostics are **off by default** and are sent only after the user enables the Diagnostics option. Diagnostic envelopes are bounded and sanitized. They exclude Torn API keys, ReviveRelay bearer/session tokens, merchant credentials, raw Torn API responses, request bodies and public chat content.

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

ReviveRelay 0.6.1 is a private review candidate. Paid public launch is awaiting Torn approval and explicit owner promotion. The review package intentionally does not claim that manual browser acceptance or Torn approval has already occurred.
