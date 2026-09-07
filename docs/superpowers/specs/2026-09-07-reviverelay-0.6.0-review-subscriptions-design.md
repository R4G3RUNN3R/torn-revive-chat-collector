# ReviveRelay 0.6.0 Torn Review, Subscription, and Client-Hardening Design

Status: Design approved in chat; written specification awaiting final user review
Date: 2026-09-07
Repository: `R4G3RUNN3R/torn-revive-chat-collector`
Target branch: `feat/reviverelay-auto-debug`
Target review release: `0.6.0`
Current design base: commit `c239262aaeb5af57661ed7caaf66212959a9751f`
Supersedes for this release: the incomplete `0.5.0` diagnostic/review packaging and the boolean-only paid-tier presentation model
Preserves: the direct certified-request architecture, Reviver Verification, live Torn revive-ability revalidation, isolated ReviveRelay PostgreSQL boundary, and server-authoritative Pro enforcement

## 1. Purpose

ReviveRelay 0.6.0 will be the first complete Torn-review candidate for the direct ReviveRelay product. It will combine the currently working 0.5.0 diagnostic line with a completed subscription model, a hardened and simplified userscript, explicit API/privacy disclosure, immutable release metadata, and a reproducible review package.

The build submitted to Torn must show the product as intended to operate if approved. The subscription model therefore remains present and functional in the private review channel. If Torn rejects monetisation, the same codebase will switch to free mode rather than forking or deleting the billing architecture.

Requester functionality remains free. Reviver-side queue, notification, and acceptance capabilities require a valid Reviver Pro entitlement plus all reviver verification and Torn eligibility gates while the product is in review/live subscription mode.

## 2. User-approved product and release decisions

1. The next material review build is `ReviveRelay 0.6.0`, not another mutable `0.5.0` artifact.
2. Every distributed tester-visible or user-visible changed build receives a new semantic version. Released artifacts are immutable.
3. `0.6.0` is initially a private Torn review-channel release. Existing stable production remains untouched until Torn review and explicit user approval for promotion.
4. The subscription model is fully implemented and visible in the Torn review build so Torn staff can review the intended paid product.
5. Supported subscription operating modes are `free`, `review`, and `live`.
6. `review` and `live` execute the real subscription workflow. `free` disables purchase/invoice creation and makes the eligible reviver feature available without paid entitlement according to the free-mode entitlement policy in this specification.
7. If Torn rejects monetisation, ReviveRelay switches to `free`; historical billing records remain protected and the codebase is not forked.
8. Requesting a revive remains free.
9. Reviver Pro launch pricing is:
   - Monthly: 10 Xanax or $10,000,000 Torn cash.
   - 6 Months: 55 Xanax or $55,000,000 Torn cash.
   - Yearly: 100 Xanax or $100,000,000 Torn cash.
10. `$` in ReviveRelay pricing always means Torn in-game cash, never real-world currency.
11. The canonical subscription payment recipient is `R4G3RUNN3R [3877028]`.
12. Subscription payments are made manually by the user inside Torn. ReviveRelay never sends cash or items and never automates a Torn payment action.
13. The 7-day Reviver Pro trial remains one-time per verified Torn identity and does not begin on install, login, or API-key connection.
14. Paid time purchased while trial time remains starts after the remaining trial, preserving unused trial time.
15. Existing active paid time stacks deterministically; a renewal extends from the later of payment time, paid expiry, and trial expiry.
16. The userscript distributed to users is one complete installable `.user.js` artifact built from modular source.
17. Legacy chat collection, public-chat classification, Google Sheets request collection, and chat fingerprinting are not part of the 0.6.0 production/review client.
18. Diagnostics are opt-in and OFF by default.
19. Reviver ability is derived from current Torn evidence, never from a historical local `reviver` role alone.
20. Sensitive authorization remains server-authoritative even if a client is stale or manually modified.

## 3. Current implementation baseline

At the design base commit, the repository already contains substantial subscription infrastructure:

- `server/src/domain/pro-plans.js` with the approved three plans and prices;
- `server/src/routes/pro.js` with Pro status, plan catalogue, trial, invoice creation, and invoice retrieval;
- `server/src/db/migrations/006_reviver_pro.sql` with `pro_entitlements`, `pro_invoices`, and `pro_payment_evidence`;
- `server/src/db/pro-entitlements.js` with one-time trial state and calendar-month paid extension;
- `server/src/db/pro-invoices.js` with one-open-invoice behavior, exact evidence matching, unique Torn-log reuse protection, and atomic paid activation;
- `server/src/worker/subscription-scan.js` with periodic payment reconciliation;
- `server/src/torn/pro-billing-evidence.js` with a tightly restricted merchant/receiver credential model;
- `server/src/config.js` with the legacy `PAID_TIER_ENABLED` boolean and receiver credential settings;
- client Pro UI that can surface plan pricing but currently exposes invoice actions even when the server is configured with the paid tier disabled.

0.6.0 is therefore an audit, completion, cleanup, and release-hardening effort, not a greenfield billing rewrite.

## 4. Subscription operating modes

The boolean-only `PAID_TIER_ENABLED` presentation model is superseded by one explicit server mode:

- `free`
- `review`
- `live`

Canonical server configuration should expose the mode through a non-secret setting such as `SUBSCRIPTION_MODE`.

### 4.1 `review`

`review` is a real payment mode for the private Torn review build:

- plan catalogue visible;
- invoice creation enabled;
- payment instructions show the configured merchant;
- automatic/manual payment verification enabled;
- Pro entitlements activate and expire normally;
- review release channel remains private and separate from stable production.

### 4.2 `live`

`live` uses the same runtime behavior as `review`, but is eligible for public stable promotion after Torn approval and explicit owner approval.

### 4.3 `free`

`free` disables new subscription invoice creation and payment scanning. The client hides paid purchase controls and explains that Reviver Pro payment is not required in free mode. Eligible revivers may use reviver functionality without a paid/trial entitlement, but Reviver Verification, current Torn revive ability, and active reviver registration remain mandatory.

Existing invoices/payment evidence/history are not deleted when switching to free mode.

### 4.4 Client rendering rule

The client never infers paid-tier availability from a failed invoice call. A server capability/status response must explicitly expose the subscription mode and relevant release metadata. The Pro UI renders from that state.

The current failure mode where a visible `Create Pro invoice` action returns `PAID_TIER_DISABLED` is prohibited in 0.6.0.

## 5. Server-owned plan catalogue

The server remains the single source of truth for subscription plans. The client must not contain authoritative duplicate prices.

Canonical plan IDs remain:

- `monthly`
- `six_months`
- `yearly`

Canonical plan values remain:

| Plan | Duration | Xanax | Torn cash |
| --- | ---: | ---: | ---: |
| Monthly | 1 calendar month | 10 | $10,000,000 |
| 6 Months | 6 calendar months | 55 | $55,000,000 |
| Yearly | 12 calendar months | 100 | $100,000,000 |

The server response may include display labels, accepted currencies, and duration metadata. The browser submits only `planId` and payment method/currency when creating an invoice. It never submits a trusted price, duration, merchant identity, or entitlement expiry.

## 6. Merchant identity and payment authority

The canonical payment recipient is:

`R4G3RUNN3R [3877028]`

Merchant identity is server configuration, not client authority. The server must reject startup in `review` or `live` if the required payment-verification configuration is missing or invalid.

The client may display the public merchant name and Torn ID returned by the API, including a Torn profile link, but it cannot override them.

No secret merchant credential is ever returned to the client or stored in release artifacts.

## 7. Payment verification design

### 7.1 Canonical evidence source

The canonical 0.6.0 payment verifier uses the **merchant account's tightly restricted incoming-log credential** on the ReviveRelay server.

This deliberately preserves the current tested `pro-billing-evidence` architecture and supersedes the earlier chat-design discussion that proposed using each subscriber's outgoing logs for subscription matching.

Reasons:

1. the receiver is the authoritative destination for the payment;
2. users do not need extra outgoing transaction-log permissions solely for subscription purchase verification;
3. payment matching continues even if a subscriber later revokes their Reviver Verification credential;
4. one server-side restricted credential can be validated against an explicit allow-list;
5. the existing code already rejects broad merchant credentials, private namespaces, and unrelated log categories;
6. it better follows least-privilege for subscriber keys.

The merchant credential must be custom/restricted to the minimal incoming-money and incoming-item evidence needed by the verifier. Full Access or unrelated private namespaces are forbidden for the merchant credential.

### 7.2 Manual user action

ReviveRelay never sends the payment. The user manually sends the exact requested Xanax quantity or Torn cash amount to R4G3RUNN3R [3877028] in Torn.

### 7.3 Exact match requirements

A Torn payment event can satisfy an invoice only when all applicable fields match:

- invoice is still pending/open;
- sender Torn ID equals the invoice purchaser Torn ID;
- destination is the configured merchant account by virtue of being present in the merchant's incoming evidence;
- payment method matches invoice currency (`xanax` or `cash`);
- amount exactly equals the server-generated expected amount;
- event timestamp is at or after invoice creation;
- event timestamp is at or before invoice expiry;
- Torn log/evidence ID has never been consumed by another invoice.

Overpayments and underpayments do not auto-match. They require administrative review rather than guesswork or implicit credit creation.

### 7.4 Xanax

Xanax payment evidence must identify Torn item ID 206 and the exact expected quantity.

### 7.5 Torn cash

Cash payment evidence must identify the exact expected incoming amount.

### 7.6 Atomic completion

Invoice payment completion is one database transaction:

1. lock invoice;
2. verify it remains pending;
3. verify evidence matches;
4. reserve/store unique Torn evidence ID;
5. mark invoice paid;
6. extend entitlement;
7. write audit event;
8. commit.

Two workers or repeated user checks cannot activate the same payment twice.

## 8. Invoice lifecycle

Canonical invoice states remain compatible with the existing schema:

- `PENDING`
- `PAID`
- `EXPIRED`
- `CANCELLED`
- `REJECTED`

The public UI may use friendlier labels such as Open, Paid, Expired, Cancelled, or Invalid without changing the database domain unnecessarily.

Rules:

- only one pending invoice per user;
- creating a new invoice cancels the previous pending invoice atomically;
- invoice lifetime remains 24 hours unless a later approved change explicitly alters it;
- expired/cancelled/rejected invoices never activate entitlement;
- paid invoices are immutable financial history;
- invoice prices and duration snapshots are immutable even if future catalogue prices change.

A prepaid Reviver Pro entitlement is not a recurring direct-debit subscription, so there is no user-facing auto-renew cancellation state. Users simply let entitlement expire or buy more time. Administrative revocation/refund is a separate action.

## 9. Pro entitlement model

The existing `pro_entitlements` record remains the current entitlement projection. An entitlement service becomes the only policy boundary used by protected routes.

Canonical public states are:

- `NONE`
- `TRIAL`
- `ACTIVE`
- `EXPIRED`
- `REVOKED` when an operator/security action has explicitly revoked access

Entitlement source is separately derived/audited as:

- trial;
- paid invoice;
- complimentary/manual grant;
- administrative correction.

Protected route policy calls a shared entitlement decision rather than reimplementing checks route-by-route.

### 9.1 Trial

The 7-day trial is one-time per verified Torn identity.

It begins only after:

1. Reviver Verification is connected;
2. Torn currently confirms permanent revive ability; and
3. the user deliberately chooses the Start 7-day trial/activate reviver action.

It never begins on script install, normal login, requester account creation, or key binding alone.

### 9.2 Paid extension

For a paid invoice, the extension base is the latest of:

- payment confirmation time;
- current paid expiry;
- current trial expiry.

The selected plan's calendar-month duration extends from that base.

### 9.3 Free mode

In `free` mode the server entitlement policy bypasses trial/paid requirements for reviver access while preserving all verification, eligibility, registration, and abuse/security checks.

## 10. Reviver authorization chain

In `review` and `live`, access to certified reviver queue/notifications/acceptance requires all of:

1. authenticated ReviveRelay session;
2. active trial, paid, or complimentary Pro entitlement;
3. usable encrypted Reviver Verification credential;
4. required verification-key capabilities;
5. current Torn permanent `Ability to revive` confirmation;
6. active ReviveRelay reviver registration.

In `free`, requirement 2 is waived. All others remain.

The server revalidates sensitive conditions for queue and Accept. A stored `reviver` role or stale browser state never substitutes for current Torn eligibility.

## 11. Reviver Verification and API-key policy

Reviver Verification remains a separate credential from the server-side merchant billing credential.

Recommended user key scope remains limited to the capabilities actually needed by current ReviveRelay verification/transaction functions. Broad/full user keys may be accepted when deliberately supplied, but the UI warns that they grant unnecessary access and recommends replacement with the restricted key.

The key is encrypted at rest server-side, decrypted only for authorized Torn API calls, never returned after binding, never included in ordinary logs, and never included in diagnostic telemetry.

Revoking Reviver Verification:

1. deletes the encrypted ReviveRelay credential;
2. invalidates verification state;
3. blocks reviver-only API use until reverified;
4. does not erase legitimate historical transaction/billing records;
5. provides a link/instruction to Torn API settings so the user can also delete the key at Torn itself.

## 12. Unified userscript architecture

The repository may retain modular source, but the user receives one complete built artifact:

`ReviveRelay-0.6.0.user.js`

Logical client modules:

- bootstrap/core state;
- release/version compatibility;
- unified ReviveRelay API transport;
- local storage/session adapter;
- sidebar integration;
- requester/preset/direct request;
- reviver verification and eligibility;
- reviver queue/Accept;
- active transaction/activity;
- Pro/subscription/invoice;
- settings/privacy;
- notifications;
- opt-in diagnostics.

The generated userscript contains no legacy public-chat collector runtime.

## 13. Unified API transport

0.6.0 consolidates duplicate direct/Pro HTTP behavior behind one API transport abstraction.

The shared transport owns:

- API base URL;
- session authorization header;
- client version header;
- release-channel header;
- JSON encode/decode;
- request timeout behavior;
- safe network error normalization;
- HTTP/error-code preservation;
- compatibility/update-required handling.

Domain modules expose focused methods over the transport rather than implementing separate fetch/GM request stacks.

A failure in Pro-plan loading must not prevent requester state from loading. Telemetry failure must never break normal product behavior.

## 14. Polling and UI state discipline

Routine polling must not rerender unrelated forms or overwrite unsaved input.

Each subsystem updates only its own view/state:

- request refresh -> request state/card;
- queue refresh -> queue only;
- eligibility refresh -> eligibility only;
- Pro status/invoice refresh -> Pro status/invoice only;
- active transaction refresh -> active transaction only.

Each poller is single-flight. A new poll for the same resource cannot start while the previous call remains in progress.

Important mutation buttons are disabled while their request is in flight and protected from double-click submission.

## 15. Error handling and user messages

Server error codes remain available for Diagnostics, but ordinary UI maps them to actionable prose.

Examples:

- `REVIVE_ABILITY_NOT_UNLOCKED` -> Torn account does not currently have permanent revive ability.
- `REVIVE_ABILITY_PERMISSION_REQUIRED` -> Reviver Verification key must be updated to allow the required check.
- `INVOICE_NOT_FOUND` -> invoice is unavailable for this account.
- `INVOICE_EXPIRED` or expired state -> create a new invoice.
- payment not yet detected -> remain pending; do not imply failure.
- `CLIENT_UPDATE_REQUIRED` -> update ReviveRelay before continuing.
- temporary Torn/API unavailability -> retry safely without declaring a credential invalid.

Torn API error 16 remains permission/availability-context sensitive and is not automatically treated as a bad key.

## 16. Dynamic-content safety

All user-controlled or external text is treated as untrusted:

- Torn names;
- request comments;
- API error messages;
- plan labels;
- invoice status text;
- merchant display name;
- activity/dispute text.

Dynamic strings must be escaped before HTML insertion or preferably inserted with DOM/text APIs. No remote `eval`, remote executable code, or arbitrary HTML from API responses is permitted.

## 17. TornPDA/userscript-host compatibility

Optional userscript APIs such as notifications are feature-detected rather than assumed.

Failure or absence of optional GM functions cannot break core ReviveRelay behavior. HTTP and storage adapters remain isolated so Tampermonkey and TornPDA differences can be handled without forking product logic.

No WebSocket dependency is introduced for ReviveRelay request delivery.

## 18. Diagnostics and telemetry

Diagnostics are OFF by default.

An explicit Settings control may enable sanitized ReviveRelay diagnostics. Allowed telemetry includes only bounded operational data such as:

- ReviveRelay version/channel;
- internal endpoint/operation name;
- safe internal error code;
- HTTP status;
- userscript/browser environment category;
- timestamp.

Telemetry must not include:

- Torn API keys;
- ReviveRelay session tokens;
- authorization headers;
- passwords;
- raw Torn API responses;
- raw payment logs;
- chat messages;
- arbitrary Torn page content.

Target retention:

- sanitized telemetry: 30 days;
- security logs: 90 days;
- operational account data: until account deletion, subject to the billing/audit retention below;
- invoice/payment/refund evidence needed to prevent transaction reuse and resolve disputes: retained while ReviveRelay operates unless legal/platform requirements demand a shorter period.

## 19. Privacy and API disclosure

Settings includes an `About & Privacy` area with:

- version and release channel;
- API usage/purpose;
- data stored;
- key storage statement;
- recommended key permissions;
- broad-key warning;
- subscription terms;
- payment destination;
- diagnostics consent;
- Revoke Reviver Verification;
- Delete ReviveRelay account/data;
- links to the review documentation/privacy documents.

Canonical disclosure principles:

- no Torn password is requested;
- user verification key is encrypted at rest;
- credentials are not sold/shared with advertisers or unrelated third parties;
- retrieved data is used only for operating ReviveRelay, verification, transaction/payment evidence, abuse prevention, and entitlement;
- plaintext credentials are never returned after binding.

## 20. Account/data deletion

The user-facing delete-account flow removes or invalidates immediately where safe:

- encrypted user verification credential;
- active sessions/tokens;
- notification preferences;
- request preset/service preferences;
- active reviver registration;
- directly account-bound optional diagnostics where practical.

Minimal financial/security history may be retained when needed to prevent payment evidence reuse, support refunds/disputes, or preserve an audit trail. Raw Torn API payloads are not retained merely for convenience.

The deletion UI must explain this distinction before confirmation.

## 21. Refunds and billing adjustments

0.6.0 supports durable administrative records for Pro refunds or entitlement corrections.

A full refund may revoke/reduce the corresponding paid entitlement through an audited administrative action. Partial automatic prorating is explicitly out of scope for 0.6.0; partial cases require an operator-recorded decision.

Billing/refund records include the invoice reference, amount/value, reason, timestamp, actor, and resulting entitlement change without storing unnecessary raw Torn responses.

## 22. Versioning and compatibility

Every distributed build carries:

- semantic version;
- Git commit SHA;
- build timestamp;
- release channel (`review` or `stable`);
- SHA-256 in the release manifest;
- API compatibility metadata.

Once distributed, the bytes associated with a version are immutable.

The server exposes enough safe release/capability metadata for the client to determine:

- server/application version;
- minimum supported client version;
- release channel;
- subscription mode.

An obsolete incompatible client receives a clear update-required response instead of failing unpredictably.

## 23. Review and stable update channels

Review and stable installers/manifests are separate. A review build updates only within the review channel. A stable build updates only within stable.

0.6.0 is initially published only to the private review channel. The public production client remains on its currently approved stable version until Torn review completes and the owner explicitly approves promotion.

No partial/hotfix deployment may falsely update a whole-app deployed-commit marker unless the deployed snapshot actually matches that commit.

## 24. Torn review package

The Torn submission package contains the exact build being reviewed plus human-readable source and evidence:

1. `ReviveRelay-0.6.0.user.js` review artifact;
2. modular source code;
3. `README.md`;
4. `PRIVACY.md`;
5. `SECURITY.md`;
6. `TORN-API-DISCLOSURE.md`;
7. `SUBSCRIPTION-MODEL.md`;
8. `CHANGELOG.md`;
9. endpoint inventory for ReviveRelay API calls;
10. Torn API selection/permission inventory and purpose;
11. payment-verification flow;
12. prices and merchant `R4G3RUNN3R [3877028]`;
13. explanation of encrypted user key storage and restricted merchant key storage;
14. explanation that Torn game actions/payment sending remain manual;
15. key revocation/account deletion procedure;
16. Request, Reviver, Activity, Pro, and Settings screenshots;
17. build manifest with commit/version/SHA-256;
18. automated test/security report;
19. concise one-page staff summary.

The submission explicitly states that paid public launch is awaiting Torn approval.

The submission also explicitly asks Torn to confirm that ReviveRelay's own certified-request network notifications are acceptable because they originate from ReviveRelay server data and do not scrape unfocused Torn chat/page content.

## 25. Torn compliance boundary

0.6.0 does not:

- automate non-API Torn HTTP requests;
- scrape Torn pages the user is not actively viewing;
- monitor public/Faction/Company/private chat for revive requests;
- intercept Torn WebSockets for chat collection;
- interact with CAPTCHA;
- automatically send Xanax/cash;
- automatically perform a Torn revive or other game action;
- ask for a Torn password.

ReviveRelay uses its own HTTPS API plus approved Torn API access for the bounded evidence/identity checks documented in the review package.

## 26. Database/concurrency rules

The existing isolated ReviveRelay PostgreSQL database remains authoritative. No Nexis or DungeonMasterOS database is shared.

Required invariants include:

- one pending Pro invoice per user;
- one Torn payment evidence ID can be consumed only once;
- payment evidence and entitlement activation commit atomically;
- only one reviver can accept a given request;
- duplicate invoice/check-payment/accept requests are safe under concurrency;
- server-generated plan price/duration cannot be overridden by the browser.

Database constraints and transactions are the final protection. Client button disabling is only UX.

## 27. Rate limiting

Specific limits remain or are added for:

- request creation;
- reviver registration/eligibility validation;
- queue Accept;
- invoice creation;
- invoice/payment checks;
- account/key mutation endpoints.

Responses expose a safe retry interval when practical. Payment polling must not hammer Torn's API.

## 28. Automated verification gate

Before 0.6.0 is handed to the owner or Torn, verification must run against the exact candidate commit and generated artifact.

### 28.1 Client tests

Cover at least:

- unified API error mapping;
- subscription mode rendering;
- server-owned plan rendering;
- invoice UI states;
- eligibility/registered-role regression;
- no full-form rerender during background refresh;
- single-flight pollers;
- button double-submit protection;
- dynamic text escaping;
- optional GM feature detection;
- review/stable version metadata.

### 28.2 Server/domain tests

Cover at least:

- plan prices/durations;
- trial one-time rules;
- entitlement stacking;
- free/review/live policy;
- invoice creation/cancellation/expiry;
- exact Xanax match;
- exact cash match;
- wrong sender;
- wrong amount;
- wrong currency;
- before-window/after-window evidence;
- duplicate Torn evidence;
- concurrent payment processing;
- merchant credential least-privilege validation;
- reviver eligibility fail-closed behavior;
- refund/admin adjustment audit.

### 28.3 Integration tests

Use an isolated disposable PostgreSQL instance and exercise authenticated API flows end-to-end without touching production business data.

### 28.4 Generated userscript smoke test

Load the generated `.user.js` in a simulated userscript/browser environment and prove:

- valid userscript metadata;
- correct 0.6.0 version/channel;
- bootstrap succeeds;
- required bundled modules/globals exist;
- no missing core-global regression;
- sidebar integration boot path succeeds;
- no legacy chat collector runtime dependency;
- no syntax error.

### 28.5 Static release audit

Search the exact generated artifact/review bundle for:

- accidentally embedded secrets/tokens/keys;
- unexpected API hosts;
- `eval`/remote executable code;
- unsafe HTML sinks;
- excessive GM permissions;
- legacy chat collector identifiers/dependencies;
- stale `0.5.0` metadata.

## 29. Manual browser acceptance gate

Automated verification is necessary but not sufficient before Torn submission.

Required manual scenarios:

### Requester

- install review build;
- authenticate;
- save/edit preset;
- create request;
- see active state;
- cancel and create again;
- verify background polling does not reset unsaved form input.

### Non-reviver

- connect verification;
- Torn reports no permanent revive ability;
- cannot register/view queue/Accept;
- UI reports the actual eligibility state.

### Eligible reviver

- connect restricted verification key;
- confirm revive ability;
- deliberately start trial/activate reviver;
- register;
- view queue;
- Accept a certified request.

### Subscription review

- inspect server-provided plans;
- create Xanax invoice;
- create Torn-cash invoice (cancelling prior open invoice);
- verify recipient `R4G3RUNN3R [3877028]`;
- verify manual payment instructions;
- detect a real approved review payment or controlled Torn review evidence;
- activate/extend entitlement;
- reload and confirm persistence;
- verify expiry/history states.

No public production promotion occurs until these checks pass and the owner explicitly approves it.

## 30. Online comparison findings incorporated into 0.6.0

The audit of comparable Torn userscripts/tools informed these practices:

- conventional immutable userscript `@version` and channel-aware update metadata instead of redistributing changed bytes under one version;
- feature detection for optional GM APIs to improve Tampermonkey/TornPDA compatibility;
- no remote executable-code loading/eval;
- clear Torn API privacy/permission disclosure where keys are supplied/stored;
- server/API-driven identity and evidence rather than cookie-based identity or background Torn-page scraping;
- explicit separation between ReviveRelay network data and Torn page/chat extraction.

Reference families reviewed during design include Torn's current API/scripting guidance, TornPDA userscript compatibility guidance, active Torn revive/payment helper scripts, and the historical Nuke `REVIVE ME` concept.

## 31. Self-review reconciliations

The written specification deliberately resolves three issues discovered while reconciling the approved chat design with the actual repository:

1. **Payment evidence source:** earlier Section 2 discussion proposed subscriber outgoing-log verification, but the existing repository and the earlier direct-request approved spec already use the designated receiver's incoming logs. 0.6.0 standardizes on the restricted receiver credential because it is already tested, survives subscriber-key revocation, and reduces subscriber permission requirements.
2. **Cancellation semantics:** Reviver Pro is prepaid and does not auto-renew. Therefore invoice cancellation and entitlement revocation/refund are real states/actions; a recurring-subscription `cancelled` state is unnecessary.
3. **Billing model reuse:** the repository already has `pro_entitlements`, `pro_invoices`, `pro_payment_evidence`, atomic activation, and one-open-invoice constraints. 0.6.0 extends/hardens these structures rather than replacing them with a parallel billing subsystem.

These reconciliations are part of the written-spec review and require user acceptance before implementation planning begins.

## 32. Definition of done for the design phase

This design is ready to transition to implementation planning only when:

- the owner approves this written specification, including the self-review reconciliations;
- the file is committed on the ReviveRelay feature branch;
- no unresolved placeholders or contradictory requirements remain;
- the Voidsmith Source of Truth records the approved 0.6.0 review/subscription decisions without secret values.

Implementation planning will then decompose the work into TDD-first, reviewable steps while keeping production 0.4.4 untouched until the review candidate passes all gates and receives explicit promotion approval.
