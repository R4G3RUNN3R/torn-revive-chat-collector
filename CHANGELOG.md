# Changelog

## 0.6.0 - Torn review candidate

### Added

- Server subscription modes: `free`, `review`, `live`.
- Full Reviver Pro prepaid plan catalogue and private review-channel billing flow.
- Monthly 10 Xanax / $10,000,000, 6 Months 55 Xanax / $55,000,000, Yearly 100 Xanax / $100,000,000.
- Canonical subscription payment recipient **R4G3RUNN3R [3877028]**.
- Restricted merchant incoming-payment verification and payment-evidence replay protection.
- 7-day Reviver Pro trial with server-authoritative entitlement.
- Separate immutable review/stable update channels.
- About & Privacy, account deletion, verification revocation and diagnostics disclosures.
- Requester-specific ReviveRelay Verification helper using Basic + Profile + Revives.
- Reviver/combined verification helper adding Perks and restricted Money/Items logs.
- Server-side requester verification gate before a request can enter the reviver queue or be accepted.
- Static Torn review release audit and review-package evidence documents.

### Changed

- 0.6.0 runtime is direct certified-request only; no public chat collection is required.
- Reviver Verification is now presented as role-aware **ReviveRelay Verification**.
- Subscription plan pricing and merchant identity are rendered from server state rather than duplicated as authoritative client constants.
- Reviver access in `free` mode no longer requires a paid entitlement, while eligibility/credential/ability gates remain enforced.
- Client polling/mutations use single-flight and in-flight guards to reduce duplicate work.
- Optional notifications fail safely when `GM_notification` is unavailable.
- Diagnostics are off by default.
- User-facing server error codes are translated into bounded explanatory messages.

### Security

- Request acceptance rechecks requester evidence capability inside the same database transaction that creates the assignment/payment window.
- Unverified requester requests are hidden from the reviver queue.
- Reviver queue/Accept continue to revalidate current Torn revive ability.
- Persistent user verification keys are encrypted at rest and never returned plaintext after binding.
- Subscription invoice amount, duration, merchant and entitlement activation remain server-authoritative.
- Review artifacts are pinned to an immutable Git commit and reject review/stable channel crossing.

### Review status

0.6.0 is for the **private review channel only**. Public production remains 0.4.4. Paid public launch is awaiting Torn approval and manual browser acceptance evidence remains pending.
