# ReviveRelay 0.6.1 Review Runtime, Trial Persistence, and Owner Pro Design

**Date:** 7 September 2026  
**Status:** APPROVED by owner on 7 September 2026

## 1. Purpose

ReviveRelay 0.6.0 exposed a review/stable compatibility defect: the 0.6.0 review userscript can talk to the older stable 0.4.4 backend, and when the expected 0.6.x `subscription` object is absent the client currently defaults the subscription mode to `free`. That fails open and can make paid/trial gating appear to reset or disappear after reinstall/session changes.

0.6.1 separates the review runtime from stable production, makes missing subscription/runtime metadata fail closed, formally verifies one-time trial persistence across reinstall/session/account lifecycle events, and grants indefinite Pro access to the canonical payment-recipient Torn identity.

## 2. Locked product decisions

1. 0.6.1 is an immutable private Torn review release. It does not overwrite 0.6.0 bytes.
2. Stable production remains 0.4.4 until a separate explicit production-promotion decision.
3. Review and stable clients must not share an application runtime endpoint that can silently downgrade subscription policy.
4. The review client uses a dedicated review API runtime.
5. Missing, malformed, incompatible, or cross-channel subscription/runtime metadata fails closed.
6. The Reviver Pro trial is exactly seven days and one-time per canonical Torn identity.
7. Reinstalling the userscript, clearing userscript storage, creating a new ReviveRelay session, replacing a verification key, disconnecting/reconnecting, deleting/reactivating the ReviveRelay account, or restarting the review service must not reset trial start, end, or used state.
8. The canonical payment recipient, currently **R4G3RUNN3R [3877028]**, receives indefinite Reviver Pro access.
9. Owner Pro remains subject to reviver verification, permanent Torn revive ability, and reviver registration checks. Owner status bypasses only the trial/paid entitlement requirement.
10. The owner does not need, and must not be prompted, to activate a trial or purchase a subscription.

## 3. Runtime separation

Stable continues to use:

```text
https://reviverelay.voidsmithindustries.com/v1/...
        -> existing stable 0.4.4 API runtime
```

Review uses:

```text
https://reviverelay.voidsmithindustries.com/review/v1/...
        -> dedicated 0.6.1 review API runtime
```

The review userscript sets its API base to the review path. Caddy routes the review path to a dedicated review API container/service on a separate localhost port. The stable `/v1/*` reverse proxy remains unchanged.

The review API may use the existing isolated ReviveRelay PostgreSQL database because identity, entitlement, invoice, and security records belong to ReviveRelay rather than to a release channel. Review migrations must remain backward-compatible with the stable runtime. No Nexis or DungeonMasterOS database is involved.

While the stable 0.4.4 worker remains active, review-only subscription billing scans must not be enqueued into the shared generic `jobs` queue. The stable worker knows the historical `subscription.scan` job type but, with its paid tier disabled, can claim such a row without a live billing handler. Therefore 0.6.1 uses a dedicated review subscription-scan process that calls the existing tested scan handler directly on its one-minute cadence. Stable API and stable worker code remain untouched.

## 4. Review runtime contract

The review backend returns explicit runtime metadata to authenticated clients, including at minimum:

- `serverVersion`;
- `minimumClientVersion`;
- `releaseChannel`;
- `subscription.mode`;
- payment-enabled state;
- canonical merchant identity;
- server-owned plan catalogue.

The review client requires:

- `releaseChannel === "review"`;
- a known subscription mode (`review`, `live`, or explicitly supported `free` where appropriate);
- a compatible server/client version relationship.

If these conditions are missing or invalid, the client enters a clear incompatible/unavailable state. It must not infer `free`.

## 5. Fail-closed client behavior

The current fallback:

```js
state.subscription?.mode || 'free'
```

is prohibited for 0.6.1.

The client instead treats absent subscription metadata as `unknown`/incompatible. In this state:

- reviver queue polling is disabled;
- reviver notifications are disabled;
- registration/Accept are disabled;
- trial activation is disabled;
- invoice creation is disabled;
- the Pro page shows a review-backend compatibility error;
- requester-safe functionality may remain available only where the server contract proves it is compatible and no paid/reviver authorization is being bypassed.

No client-side fallback can grant Pro access.

## 6. Canonical one-time trial model

The existing server entitlement design remains authoritative:

- Torn identity is unique in `users.torn_id`;
- `pro_entitlements.user_id` belongs to that canonical user;
- `trial_started_at` and `trial_ends_at` are stored server-side;
- `startTrial()` rejects a row with prior `trial_started_at` as `TRIAL_ALREADY_USED`;
- paid or revoked identities are also ineligible as already defined.

ReviveRelay account deletion does not delete the canonical user row or entitlement history. It marks the account deleted and removes credentials/sessions/current reviver registration while retaining the historical record required for billing/security/reuse prevention. Reconnecting the same Torn ID reactivates that same identity.

### 6.1 Required regression sequence

Automated integration coverage must prove the following against PostgreSQL:

1. Torn ID starts a trial at T0.
2. Capture exact `trial_started_at` and `trial_ends_at`.
3. Destroy all ReviveRelay sessions for that user.
4. Simulate userscript uninstall/reinstall by creating a new client/session state.
5. Replace/rebind the verification credential.
6. Reconnect the same Torn identity.
7. Attempt to start the trial again.
8. Server rejects with `TRIAL_ALREADY_USED` or an equivalent non-eligible response.
9. Original trial timestamps remain unchanged.
10. Advance time beyond seven days and assert `EXPIRED`, never fresh `TRIAL`.
11. Delete the ReviveRelay account through the supported deletion flow, reconnect the same Torn ID, and assert the trial remains used.
12. Restart/recreate the review application runtime and assert the same persisted state remains.

The invariant is: **one Torn identity can consume at most one seven-day Reviver Pro trial for the lifetime of the retained ReviveRelay identity/billing record.**

## 7. Owner Pro entitlement

### 7.1 Identity source

Owner Pro is server-authoritative and is derived from the authenticated Torn ID matching the canonical payment-recipient identity configured by the review/live server.

Current canonical owner/payment recipient:

- Name: `R4G3RUNN3R`
- Torn ID: `3877028`

No owner identity is trusted from userscript storage, request bodies, URL parameters, headers supplied by the userscript, or client-rendered state.

### 7.2 Public entitlement state

The server exposes a distinct Pro state:

```text
OWNER
```

Semantics:

- Pro access: active indefinitely;
- `validUntil`: `null` (represented in UI as `Lifetime` / `No expiry`);
- `trialEligible`: `false`;
- payment required: no;
- purchase controls: hidden/disabled;
- trial controls: hidden/disabled.

OWNER is accepted anywhere the entitlement policy accepts `TRIAL` or `ACTIVE` for reviver-side Pro access.

### 7.3 Security boundaries

OWNER bypasses only paid/trial entitlement checks. It does not bypass:

- authentication;
- verification-credential capability checks;
- Torn permanent `Ability to revive` verification;
- active reviver registration;
- requester evidence requirements;
- transaction/payment/refund safety checks;
- rate limits;
- stale-client/release-channel checks.

### 7.4 Configuration consistency

In review/live mode, the runtime validates the canonical payment recipient before enabling payment verification. Owner resolution uses that same trusted server configuration, preventing client-side drift between "merchant" and "owner" identities.

If the payment-recipient identity is deliberately changed in the future, owner entitlement follows the canonical configured recipient after the configuration passes the existing merchant-identity safety checks.

## 8. UI changes

The Pro page for a normal eligible reviver shows one-time trial or paid plans according to server status.

For the owner account it shows, for example:

```text
Reviver Pro: OWNER
Access: Lifetime
Payment recipient account
```

It does not render Start Trial, Create Invoice, or payment-purchase controls for OWNER.

If review runtime metadata is unavailable/incompatible, the UI shows an explicit error rather than a free-mode entitlement.

## 9. Server-side authorization

A single entitlement-policy function/service determines whether reviver Pro requirements are satisfied. Accepted states in review/live are:

- `TRIAL`
- `ACTIVE`
- `OWNER`

`NONE`, `EXPIRED`, `REVOKED`, and unknown states fail closed.

In free mode, only the paid/trial/owner entitlement requirement is waived; all existing reviver eligibility and verification checks remain.

Protected routes continue to authorize server-side independently of what the UI displays.

## 10. Version and artifact discipline

0.6.0 remains immutable at its existing public review URL and hash.

0.6.1 receives new immutable review artifacts and metadata under:

```text
/releases/review/0.6.1/ReviveRelay-0.6.1.user.js
/releases/review/0.6.1/ReviveRelay-0.6.1.meta.js
```

The generated userscript must embed the exact source commit used to build it. Review documentation records the exact SHA-256.

## 11. Deployment sequence

1. Implement/test 0.6.1 in the isolated feature worktree.
2. Create the dedicated review API service using 0.6.1 server code.
3. Run migrations against the isolated ReviveRelay database only after backward-compatibility verification.
4. Keep stable API container and `/v1/*` routing untouched.
5. Add `/review/v1/*` reverse proxy to the review API localhost port.
6. Verify review `/health` and runtime/version contract.
7. Publish the immutable 0.6.1 review userscript/meta files.
8. Install 0.6.1 manually and execute browser acceptance for normal user, expired-trial user, and OWNER identity.
9. Confirm stable 0.4.4 still serves from the stable path and current production manifest/symlink is unchanged.

## 12. Test gates

Automated tests must cover at minimum:

- reinstall/new-session trial persistence;
- credential replacement does not reset trial;
- account delete/reactivate does not reset trial;
- trial expires exactly from original start time;
- cross-channel/missing subscription metadata fails closed;
- review client rejects stable backend contract;
- OWNER derived only from trusted Torn identity/server merchant configuration;
- OWNER has no expiry and no trial/invoice eligibility;
- non-owner cannot spoof OWNER using request/client data;
- OWNER still needs reviver verification/ability/registration;
- normal TRIAL/ACTIVE/EXPIRED/REVOKED behavior remains correct;
- stable 0.4.4 route/runtime remains unchanged.

Full client/server regression, static review audit, userscript syntax/provenance, and disposable PostgreSQL verification are required before handoff.

## 13. Rollback

If the review runtime has problems:

- do not alter stable production;
- remove/disable the review proxy/service;
- leave existing immutable review artifacts available for forensic comparison if desired;
- correct the issue in a new immutable review version rather than rewriting 0.6.1 bytes.

No rollback path may convert unknown review runtime metadata into free entitlement.

## 14. Definition of done

0.6.1 is ready for owner/browser review when:

- the dedicated review runtime is live and isolated from stable routing;
- missing/incompatible subscription metadata fails closed;
- the reinstall/session/account lifecycle trial exploit test is green;
- R4G3RUNN3R [3877028] receives OWNER/Lifetime Pro from the server;
- OWNER cannot be spoofed and still obeys reviver safety requirements;
- all automated suites/audits pass;
- exact review artifact hash/provenance are recorded;
- stable public production remains 0.4.4.
