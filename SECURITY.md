# ReviveRelay Security

This document describes security controls implemented for the ReviveRelay 0.6.1 Torn review candidate.

## Trust boundary

The userscript is an untrusted client. The server is authoritative for request acceptance, reviver eligibility, subscription entitlement, plan pricing, merchant identity, invoice state, payment/refund evidence, deadlines and transaction state. Client-supplied price, duration, merchant or arbitrary transaction state is not trusted.

The 0.6.1 review client uses `/review/v1/` and requires an explicit compatible `review` runtime contract. Missing, malformed, stable-channel or incompatible runtime/subscription metadata fails closed. The client never interprets missing subscription state as `free`.

## Credentials

The one-time identity key is used only to resolve Torn identity and is not stored. Persistent **ReviveRelay Verification** credentials are encrypted at rest with AES-GCM. The encryption secret is configured outside PostgreSQL. Plaintext credentials are not returned after binding and are excluded from normal telemetry/logging.

Recommended restricted access is role-specific:

- requester: Basic, Profile, Revives;
- reviver/combined: requester access plus Perks and the restricted Money/Items transaction-log categories needed for revive payment/refund evidence;
- subscription merchant: a separate restricted merchant credential limited to the canonical receiving account and incoming Money/Items evidence required for Pro payment verification.

Broad/Full user keys may be accepted where required evidence is available, but ReviveRelay marks them as broader than recommended. The restricted merchant credential is validated more strictly and must belong to the configured merchant identity.

## Request acceptance invariant

A requester can create a free certified request without first storing a persistent verification credential. Before any reviver can see or accept that request, however, the database must contain a usable requester-capable ReviveRelay Verification credential. The same condition is rechecked inside the atomic `Accept` database transaction. Failure returns `REQUESTER_VERIFICATION_REQUIRED` and no transaction or payment window starts.

This protects later outcome determination, including assigned revive, third-party revive and requester hospital-state evidence.

## Reviver authorization

Protected reviver operations fail closed unless the server confirms the relevant combination of:

- active Reviver Pro trial/subscription when the configured mode requires it;
- reviver registration/standing;
- usable reviver-capable verification credential;
- current Torn permanent revive ability.

`free` subscription mode waives only the Pro entitlement requirement. It does not waive reviver identity, credential or Torn ability checks.

The 7-day trial is **one-time per canonical Torn identity** and its timestamps remain server-side across reinstall, session replacement, verification-key replacement and account delete/reactivate cycles.

The canonical merchant identity **R4G3RUNN3R [3877028]** is the only identity that can be server-derived as `OWNER`. OWNER has **Lifetime** Pro access and bypasses only the paid/trial entitlement requirement. It cannot be spoofed from a client-supplied field and still requires verification capability, permanent Torn revive ability and reviver registration.

## Billing and evidence replay protection

Reviver Pro invoices are server-created from the immutable plan catalogue. The client supplies only a plan ID and currency. Payment recipient is server configuration: **R4G3RUNN3R [3877028]**.

The user sends payment manually in Torn. ReviveRelay verifies the canonical merchant's restricted incoming payment evidence. A Torn payment evidence ID is globally idempotent and cannot activate two invoices. Invoice ownership, exact amount/currency, sender, merchant recipient and invoice time window are validated server-side.

The approved review pricing is Monthly 10 Xanax / $10,000,000, 6 Months 55 Xanax / $55,000,000, and Yearly 100 Xanax / $100,000,000. `$` is Torn cash.

## Release security

0.6.1 uses separate immutable `review` and `stable` channels. The private review artifact embeds its exact Git commit and build timestamp. Channel-specific metadata prevents review/stable crossing. Runtime `@require`, `eval` and remote executable-code loading are not permitted in the review artifact.

The Task 12 review audit also checks for unexpected `@connect` hosts, excessive userscript grants, secret-like literals, legacy chat runtime dependencies, unsafe unreviewed HTML sinks and stale release metadata.

## Diagnostics and deletion

Sanitized diagnostics are **off by default**. User-linked raw telemetry occurrences are removed during account deletion, and the scheduled telemetry retention job deletes raw occurrences after 30 days.

Account deletion removes credentials, sessions and active reviver registration, closes/cancels still-open safe-to-cancel operational state, and marks the account deleted. Minimal billing/payment reuse and security/audit history is retained intentionally.

## Scripting boundary

The 0.6.1 runtime is direct-only. It does **not scrape** unfocused Torn pages and performs no public chat collection. ReviveRelay does not automatically send Torn cash/items, accept revives, or execute Torn game actions. Payment and the actual revive remain user actions in Torn.

Torn staff are explicitly asked in the review package to confirm whether ReviveRelay's **certified-request network notifications**, generated from ReviveRelay server-originated requests rather than background Torn-page scraping, are acceptable.
