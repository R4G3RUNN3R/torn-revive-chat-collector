# ReviveRelay Direct Certified Requests Design

Status: Approved written specification
Date: 2026-08-30
Repository: `R4G3RUNN3R/torn-revive-chat-collector`
Supersedes for future implementation: `2026-08-28-reviverelay-always-on-auto-debug-design.md`

## 1. Purpose

ReviveRelay will stop operating as a public-chat revive-request detector and become a direct revive marketplace.

A requester configures a default revive offer once, then uses a Torn-sidebar action labelled exactly:

`ReviveRelay → Revive Me!`

Clicking that action creates an authenticated ReviveRelay request directly on the ReviveRelay server. The request is immediately visible to connected revivers and is visually marked as a server-certified request.

The production client will not scan Torn chat DOM, classify chat text, intercept WebSockets, scrape minimized chats, or upload public-chat candidates.

## 2. User-approved product decisions

1. Production chat listening is removed.
2. Public-chat candidate collection is removed from the normal product flow.
3. The minimized-chat/WebSocket investigation is no longer required for production ReviveRelay.
4. The primary requester action lives in Torn's left sidebar, not inside the ReviveRelay panel.
5. The visible label is exactly `ReviveRelay → Revive Me!` when the sidebar has room for text.
6. A compact ReviveRelay/revive icon may be used when Torn collapses the sidebar, with the full label retained as the tooltip/accessible label.
7. The requester configures payment method, offer amount, and default request message in ReviveRelay Settings.
8. One click uses the saved preset and creates the request immediately. No confirmation dialog is required.
9. Direct requests are server-certified because they originate from an authenticated ReviveRelay session whose Torn identity was previously verified.
10. Certified requests receive a star/highlight treatment in the reviver feed.
11. Certification means verified request origin and identity. It does not mean payment has already been made or guaranteed.
12. Existing transaction/payment/revive/refund verification remains a separate concern from request certification.
13. Free and Reviver Pro users run the same userscript; Pro is a server-side entitlement, not a separate downloadable client.
14. Free users are requesters. Reviver-side queue/notification/acceptance capabilities require an active Reviver Pro trial or paid entitlement.
15. Reviver Pro launches with a 7-day one-time trial, explicitly activated per verified Torn identity.
16. Launch pricing is 10 Xanax / $10,000,000 Torn cash monthly, 55 Xanax / $55,000,000 for 6 months, and 100 Xanax / $100,000,000 yearly.
17. ReviveRelay uses a fixed Pro conversion of 1 Xanax = $1,000,000 Torn cash rather than live Xanax market pricing.
18. Pro purchase payment is verified from the designated receiving Torn account's incoming logs.
19. A future standard monthly price of 14 Xanax / $14,000,000 may be configured manually after product traction is proven; no automatic price increase is scheduled.

## 3. Product boundary: no chat listening

The following production behaviors are removed or disabled:

- DOM discovery of Torn chat windows;
- reading public chat message bodies;
- minimized-chat probes;
- WebSocket interception for chat discovery;
- revive-message classification;
- chat candidate outbox submission;
- shared public-chat candidate feed;
- public-chat dedupe logic;
- classifier vocabulary such as `rev`, `res`, `med`, `revive`, `resurrection`, or `medic`.

The old classifier and chat modules may remain in repository history during migration, but they are not executed by the production client once the direct-only release is promoted.

No Faction, Company, private, group-private, competition, poker, Hospital, Global, Trade, Jail, Travel, or other chat content is processed by ReviveRelay production code.

## 4. Identity and Torn API usage

### 4.1 Normal requester flow

The sidebar request action does not call the Torn API.

After initial setup, normal ReviveRelay use requires only the opaque ReviveRelay session token.

Clicking `ReviveRelay → Revive Me!` sends the saved offer through the ReviveRelay HTTPS API using that existing session.

### 4.2 One-time identity verification

A trustworthy certified request still requires a trustworthy binding between a ReviveRelay account/session and a Torn player identity.

The first implementation retains the existing one-time minimally scoped Torn API identity verification:

1. user supplies the minimal identity key once;
2. ReviveRelay server verifies Torn ID/current name;
3. server creates/binds the ReviveRelay identity and session;
4. identity key is discarded and is not persisted;
5. later direct requests use the ReviveRelay session only.

This is the only Torn API key required merely to create certified requests.

Removing even this one-time verification would require a separate trusted account-link proof mechanism. Reading the current Torn ID/name from the page DOM is not sufficient because a modified userscript can forge client-supplied identity fields.

### 4.3 Transaction-verification credential

The existing encrypted transaction-verification credential is no longer a prerequisite for creating a certified revive request.

It remains relevant only to later protected transaction evidence where required.

Current evidence behavior is preserved initially:

- reviver credential can verify incoming Cash/Xanax payment;
- reviver credential can verify outgoing refunds;
- revive verification currently cross-checks requester and reviver revive evidence and requester hospital status.

Any later move to reviver-only transaction evidence is a separate controlled change and is not required to launch the direct request button.

## 5. Requester preset

Settings contains a `Revive Me preset` card with:

- payment method: `Cash` or `Xanax`;
- default offer amount;
- default request message;
- save action;
- validation/status summary.

Canonical minimums remain server-enforced:

- Cash: at least `$500,000`;
- Xanax: at least `1`;
- amount must be a safe positive whole number;
- message is optional and bounded by the existing request-comment limit.

The preset is convenience data, not authority. The server validates the submitted request again.

The saved preset may live locally in Tampermonkey storage because it contains no credential or secret.

## 6. Torn sidebar action

### 6.1 Placement

ReviveRelay injects one action into Torn's left navigation/sidebar area.

The integration follows Torn's current DOM structure and styling closely enough to look native, but remains namespaced so ReviveRelay cannot collide with Torn controls.

The script must tolerate Torn rebuilding navigation during SPA-style page transitions. A small bounded observer/reconciliation routine ensures one and only one ReviveRelay action exists.

### 6.2 Label and collapsed state

Expanded state:

`ReviveRelay → Revive Me!`

Collapsed/icon-only state:

- ReviveRelay revive/medical icon;
- full tooltip/accessible label `ReviveRelay → Revive Me!`.

### 6.3 Button states

The action has explicit states:

- `READY`: saved valid preset and authenticated ReviveRelay session;
- `SETUP REQUIRED`: missing identity/session or missing/invalid preset;
- `SUBMITTING`: request is being created;
- `ACTIVE`: a certified request already exists;
- `ERROR`: last request attempt failed, with a safe route to the ReviveRelay panel for details.

Repeated clicks while `SUBMITTING` are suppressed client-side. Server active-request/idempotency rules remain authoritative.

## 7. One-click request flow

When the user clicks the ready sidebar action:

1. client reads the saved preset;
2. client confirms the ReviveRelay session exists;
3. client sends `POST /v1/requests` with payment method, offer amount, and optional comment;
4. server derives requester identity from the authenticated session;
5. server validates offer fields;
6. server creates or returns the user's current active request according to existing request-domain rules;
7. server response marks the request origin as direct ReviveRelay;
8. UI switches to active state;
9. reviver queue receives the request immediately through its normal refresh/polling path.

No chat message is posted automatically and no Torn chat page needs to be open.

## 8. Certified request semantics

Certification is server-authoritative.

The browser never submits a trusted boolean such as `certified: true`.

The server derives certification from authenticated request origin.

Canonical meaning:

> A certified request is a revive request deliberately created through ReviveRelay by a Torn identity previously bound to the authenticated ReviveRelay session.

Certification does not assert:

- that payment has already been sent;
- that the offered amount is escrowed;
- that the requester will pay;
- that a revive is guaranteed;
- that the reviver is certified.

The server may expose a safe response field such as:

- `origin: "reviverelay_direct"`;
- `certified: true` derived server-side in response projection.

The database should prefer an origin/source column over storing a client-controlled certification flag.

## 9. Reviver feed UX

The reviver feed becomes a direct-request queue rather than a mixture of chat candidates and marketplace requests.

Each card includes:

- star icon next to requester name;
- `CERTIFIED REQUEST` chip;
- requester Torn name and ID;
- request message/comment;
- offered Cash/Xanax amount;
- request age/server timestamp;
- existing Accept action when the reviver is eligible.

Certified cards receive a subtle highlighted border/background so the distinction is visible without becoming visual clutter.

The old `Shared public chat requests` section is removed.

There is no normal/unverified chat-request card type in the direct-only release.

## 10. Request tab inside ReviveRelay

The main panel remains useful for configuration and management even though the fast action lives in Torn's sidebar.

The Request tab shows:

- current saved preset summary;
- active certified request status;
- offer;
- message;
- elapsed time;
- cancel action while cancellation is allowed;
- transaction state after a reviver accepts.

The panel's existing request form may be reduced to preset editing/management rather than acting as the primary submission path.

## 11. Server changes

### 11.1 `/v1/requests`

The route continues to require ReviveRelay session authentication.

It no longer requires a requester-capable transaction-verification credential merely to create a request.

Identity remains derived exclusively from `request.reviveRelayUser`, never from requester ID/name fields supplied by the browser.

Existing offer validation and write rate limits remain.

### 11.2 Request origin

The persistence model records direct origin server-side.

Preferred migration:

`revive_requests.origin text NOT NULL DEFAULT 'reviverelay_direct'`

with a strict domain/check constraint if practical.

Because chat-origin requests cease to exist in the production system, the initial allowed value may contain only `reviverelay_direct` while preserving room for future non-chat trusted origins.

### 11.3 Queue projection

Reviver queue responses include server-derived certification/origin data needed by the UI.

No client may create an uncertified/alternate origin through request payload fields.

## 12. Diagnostics after removing chat transport work

The large WebSocket Auto-Debug subsystem is no longer justified for production ReviveRelay.

The product keeps lightweight sanitized technical diagnostics for ReviveRelay failures, including:

- initialization failure;
- sidebar injection/reconciliation failure;
- preset validation failure counts where useful;
- request API failures;
- session/auth failures;
- update failures;
- transaction workflow errors.

Diagnostics never include:

- Torn chat content;
- cookies;
- Torn API keys;
- ReviveRelay bearer tokens;
- transaction verification plaintext;
- raw request comments unless they are already part of the legitimate request record itself.

No WebSocket observer, frame parser, chat structure detector, marker mode, or minimized-chat diagnostic pipeline ships in production.

## 13. Migration from current client

The browser-proven 0.4.5-from-0.4.2 line and Control B 0.4.6 work remain useful as startup/packaging safety evidence.

Migration sequence:

1. retain the current known-good startup/panel baseline;
2. remove public-chat discovery and candidate submission from the runtime path;
3. remove `Shared public chat requests` UI;
4. decouple request creation from requester transaction credential;
5. add preset storage/UI;
6. add Torn sidebar action;
7. add server request-origin projection and certified styling;
8. browser-test the direct-only diagnostic build;
9. promote only after real Torn confirmation.

The old Control C/WebSocket tasks are cancelled.

## 14. Testing strategy

### 14.1 Client tests

Tests must prove:

- no chat scanner is started;
- no public candidate submission path is reachable;
- no WebSocket observer exists in production artifact;
- sidebar action inserts once and survives navigation rebuilds without duplicating;
- exact label `ReviveRelay → Revive Me!` exists;
- collapsed state retains accessible label;
- invalid/missing preset produces setup-required state;
- valid preset produces ready state;
- one click submits exactly one request;
- submitting state suppresses duplicate clicks;
- active request changes sidebar state;
- cancellation restores ready state when appropriate;
- saved preset contains no credentials;
- existing known-good startup/panel behavior remains intact.

### 14.2 Server tests

Tests must prove:

- authenticated session is required;
- requester identity is derived from session;
- requester transaction credential is not required just to create a request;
- invalid offers remain rejected;
- one active-request invariant remains;
- committed-request protection remains;
- origin is server-derived;
- client-supplied origin/certified fields cannot override server truth;
- reviver queue projects `certified: true`/direct origin correctly;
- existing transaction protections continue to pass.

### 14.3 Browser acceptance

Before automatic promotion, user confirms in real Torn/Tampermonkey:

1. ReviveRelay panel appears;
2. Torn sidebar shows `ReviveRelay → Revive Me!`;
3. sidebar action persists across Torn page navigation;
4. saved preset works;
5. one click creates one active request;
6. request appears on second reviver account/client;
7. card shows star/highlight and `CERTIFIED REQUEST`;
8. no Torn chat needs to be open;
9. no public chat is scanned or uploaded;
10. cancel/request-state behavior works.

## 15. Privacy and security acceptance criteria

The direct-only production release is acceptable only if:

- zero Torn chat text is scraped for revive discovery;
- zero WebSocket chat frames are intercepted for revive discovery;
- no requester Torn ID/name is trusted from request payload fields;
- one-time identity key is not persisted;
- normal sidebar requests use only the ReviveRelay session;
- transaction-verification plaintext remains encrypted/server-side where that feature is used;
- certification is derived server-side;
- server rate limits remain active;
- request presets contain no secrets.

## 16. Out of scope for this release

- chat-based revive discovery;
- `rev`/`res`/`med` classifier expansion;
- minimized-chat capture;
- WebSocket transport reverse engineering;
- public-chat pooling;
- requester/reviver reputation scores;
- `Certified Reviver` status;
- escrow;
- guarantee of requester payment;
- complete elimination of the one-time Torn identity proof;
- redesign of revive-success evidence to reviver-only proof.

## 17. Direct-request success definition

A normal requester installs ReviveRelay, verifies their Torn identity once, saves a preferred Cash/Xanax offer and message, and thereafter can request a revive from anywhere in Torn by clicking `ReviveRelay → Revive Me!` in the left sidebar.

The request reaches ReviveRelay directly, appears immediately to revivers as a server-certified starred request, and requires no Torn chat monitoring at any stage.

## 18. Reviver Pro entitlement model

Reviver Pro is a server-side entitlement attached to the verified ReviveRelay user identity. There is one userscript for all users. Client-side UI state is never authoritative for paid access.

Canonical entitlement states:

- `NONE`: free requester only;
- `TRIAL`: one-time Reviver Pro trial active;
- `ACTIVE`: paid Reviver Pro active;
- `EXPIRED`: trial or paid entitlement ended;
- `REVOKED`: administratively disabled for fraud, abuse, refund/reversal, or another explicit operator reason.

The server stores the entitlement start/end timestamps and source. `/v1/me` exposes only safe entitlement status and expiry needed by the client.

The client may hide/show Pro UI based on the response, but every Pro-only server route independently enforces the entitlement. Modifying Tampermonkey state cannot grant queue access or acceptance capability.

### 18.1 Free requester capabilities

Free users may:

- verify identity;
- configure a `Revive Me` preset;
- use `ReviveRelay → Revive Me!`;
- create and cancel their own certified requests;
- view their own request and transaction state.

Free users do not receive the reviver queue, reviver notifications, or request acceptance capability.

### 18.2 Pro reviver capabilities

An active `TRIAL` or `ACTIVE` entitlement unlocks reviver-side product features, including:

- certified request queue;
- new-request notifications;
- request acceptance UI;
- reviver transaction history/status;
- payment/refund verification UX;
- future reviver analytics that do not change the entitlement contract.

Accepting a protected paid revive still requires whatever restricted reviver transaction-verification credential the transaction system requires. A Pro entitlement proves subscription access, not Torn transaction evidence capability.

## 19. Reviver Pro trial

The launch trial is 7 days.

Rules:

1. Trial does not begin automatically on install or identity verification.
2. The verified user explicitly chooses `Start 7-day Reviver Pro trial`.
3. Trial may be activated once per verified Torn identity, enforced server-side.
4. Trial is available only before that Torn identity has ever activated a paid Reviver Pro entitlement. A previously paid user cannot save the trial for later.
5. Reinstalling the userscript, clearing Tampermonkey storage, or creating a new ReviveRelay session does not reset trial eligibility.
6. Trial start/end timestamps are server-authoritative.
7. Trial grants the same product feature entitlement as paid Pro for the trial period, subject to transaction-verification requirements for protected actions.
8. On expiry, the account returns to free requester capability unless a paid entitlement is active.

## 20. Reviver Pro launch pricing

Launch plans are fixed server-side product definitions:

| Plan | Xanax | Torn cash | Entitlement extension |
| --- | ---: | ---: | --- |
| Monthly | 10 | $10,000,000 | 1 month |
| 6 Months | 55 | $55,000,000 | 6 months |
| Yearly | 100 | $100,000,000 | 12 months |

The canonical cash conversion for Pro pricing is exactly:

`1 Xanax = $1,000,000 Torn cash`

This is a ReviveRelay commercial conversion, not a claim about the live Torn market price.

A future standard monthly price of 14 Xanax / $14,000,000 may be introduced manually after real usage/revenue data is reviewed. The initial release contains no date-triggered or automatic price increase and no unapproved grandfathering rule.

Plan definitions are server-controlled so a modified client cannot request a cheaper amount or longer duration.

## 21. Pro purchase invoice and payment verification

### 21.1 Invoice creation

A verified user selects:

- plan: monthly, 6 months, or yearly;
- payment currency: Xanax or Torn cash.

The server creates a pending invoice containing:

- invoice UUID;
- ReviveRelay user UUID / verified Torn ID relationship;
- selected plan identifier;
- selected payment currency;
- exact expected amount;
- created timestamp;
- expiry timestamp, exactly 24 hours after invoice creation;
- state;
- matched Torn log ID when paid.

The client cannot submit its own price or entitlement duration. It submits only the selected server-known plan and currency identifiers.

Only one open Pro invoice per user is required initially. Creating a replacement invoice safely expires/supersedes the previous unpaid invoice. A Pro invoice is valid for exactly 24 hours from server-side creation.

### 21.2 Designated receiving account

ReviveRelay uses one explicitly configured Torn receiving account for Pro subscription payments.

The receiving account has a restricted server-side Torn API credential capable only of the incoming-log evidence needed to verify:

- incoming money;
- incoming items/Xanax.

That credential is a server secret. It is never sent to clients and is isolated from requester/reviver credentials.

### 21.3 Payment matching

The server verifies the designated receiving account's incoming Torn logs and matches a payment only when all required evidence agrees:

- sender Torn ID equals the invoice owner's verified Torn ID;
- payment type matches the selected invoice currency;
- Xanax item identity is the canonical Xanax item;
- quantity/cash amount equals the invoice's exact expected amount;
- Torn log timestamp is at or after invoice creation and no later than the 24-hour invoice expiry;
- Torn log ID has not already been consumed by another invoice.

A matched Torn log ID is unique in ReviveRelay billing records so one transfer cannot activate multiple subscriptions.

The buyer does not need to retain or expose a Torn API key for Pro payment verification. Verification comes from the receiving account's evidence.

### 21.4 Entitlement activation and renewal

After an invoice becomes `PAID`, the server grants or extends `REVIVER_PRO`.

The purchased duration is appended to the latest applicable entitlement boundary so existing value is never discarded:

- if a trial is active, paid time begins after the trial expiry;
- if paid Pro is active, renewal begins after the existing paid expiry;
- otherwise paid time begins at payment verification time.

Plan durations use UTC calendar arithmetic: monthly adds 1 calendar month, 6 Months adds 6 calendar months, and Yearly adds 12 calendar months.

A paid subscription may therefore be purchased during a trial without losing the remaining trial period or any purchased duration.

Invoice processing must be idempotent: re-reading the same Torn log cannot extend the entitlement twice.

### 21.5 Invoice states

Initial invoice states:

- `PENDING`;
- `PAID`;
- `EXPIRED`;
- `CANCELLED`;
- `REJECTED` for evidence that cannot legitimately satisfy the invoice.

No automatic entitlement is granted from a client-side success screen. Only server-verified payment transitions an invoice to `PAID`.

## 22. Pro route enforcement

At minimum, the following reviver-side operations require an active `TRIAL` or `ACTIVE` entitlement:

- read reviver certified-request queue;
- receive server-backed reviver notifications;
- register/operate as a Reviver Pro participant where registration remains part of the existing model;
- accept a revive request.

Protected transaction actions may additionally require the existing reviver verification credential/capabilities.

Request creation remains free. No Pro entitlement is required for `ReviveRelay → Revive Me!`.

Server authorization must fail closed even if the client exposes hidden Pro controls.

## 23. Pro billing/admin controls

The server should support an auditable operator action for exceptional entitlement management without directly editing database rows. Initial administrative operations may include:

- grant a bounded Pro period;
- revoke Pro with a reason;
- inspect invoice/payment evidence metadata;
- correct an entitlement after a verified operational error.

Every manual entitlement change records operator, reason, previous expiry/state, new expiry/state, and timestamp.

Manual admin controls are a fallback, not the normal payment path.

## 24. Additional Pro testing requirements

### 24.1 Entitlement tests

Tests must prove:

- free users cannot access Pro-only server routes;
- client-side forged Pro state cannot bypass the server;
- trial activates once per Torn identity and is unavailable after that identity has ever activated paid Pro;
- reinstall/session replacement does not reset trial eligibility;
- trial expires server-side;
- paid entitlement supersedes/extends trial correctly;
- paid renewal extends remaining paid time rather than replacing it.

### 24.2 Billing tests

Tests must prove:

- plan price and duration come from server definitions;
- monthly Xanax invoice expects 10 Xanax;
- monthly cash invoice expects $10,000,000;
- 6-month invoices expect 55 Xanax or $55,000,000;
- yearly invoices expect 100 Xanax or $100,000,000;
- sender Torn ID must match the verified purchaser;
- wrong amount/currency does not activate Pro;
- reused Torn log ID cannot pay two invoices;
- duplicate verification is idempotent;
- invoice expires exactly 24 hours after creation and expired/cancelled invoice does not activate Pro;
- receiving-account Torn credential never appears in client responses/loggable payloads.

### 24.3 Browser acceptance

In real Torn/Tampermonkey, acceptance must prove:

1. free requester sees `ReviveRelay → Revive Me!`;
2. free requester cannot open/use Pro reviver queue;
3. eligible account can explicitly start the 7-day trial;
4. trial immediately unlocks Pro UI after server confirmation;
5. plan selector displays the exact launch pricing;
6. a verified Xanax or cash test payment activates/extends Pro;
7. Pro expiry/state displayed by the client matches server state;
8. Pro reviver can see and accept certified requests subject to transaction credential requirements.

## 25. Revised success definition

ReviveRelay ships as one direct-request userscript with two server-authorized product tiers:

- **Free requester:** one-time Torn identity verification, saved revive preset, `ReviveRelay → Revive Me!`, certified request creation/management;
- **Reviver Pro:** one-time 7-day trial or paid entitlement, certified request queue/notifications/acceptance, with protected transaction actions still governed by restricted Torn verification evidence.

Pro purchase uses either Xanax or Torn cash at the approved launch rates. Payment is verified automatically from the designated receiving Torn account's incoming logs, and entitlement is granted only by the server. No Torn chat listening is required anywhere in the product.

