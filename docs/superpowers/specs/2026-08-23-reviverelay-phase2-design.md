# ReviveRelay Phase 2 Design

Date: 2026-08-23
Status: Proposed design for user review
Repository: `R4G3RUNN3R/torn-revive-chat-collector`

## 1. Purpose

Phase 2 transforms the existing Torn Revive Chat Collector into **ReviveRelay**, a community revive-request and reviver marketplace system.

ReviveRelay has two distinct inputs:

1. **Direct revive requests** created by hospitalized players through the userscript. These are structured, protected transactions with a defined payment method, acceptance lock, payment verification, revive SLA, refund workflow, dispute handling, and reviver reputation.
2. **Public-chat revive candidates** detected locally by installed userscripts. These are informational leads for Reviver Pro users, not protected marketplace contracts unless the requester also creates a direct ReviveRelay request.

The system must never collect, upload, classify, or pool Faction, Company, private, or other non-public chat content.

## 2. Product name and user roles

The userscript and service will be renamed from **Torn Revive Chat Collector** to **ReviveRelay**.

### 2.1 Requester

A requester is any player using ReviveRelay to request a paid revive.

Requester functionality is free.

### 2.2 Contributor

Any user running ReviveRelay may contribute locally detected revive candidates from public Torn channels that the user can legitimately access while actively using Torn.

Contributors do not receive paid features merely for contributing.

### 2.3 Reviver

A reviver is a user who registers as a reviver, supplies the required minimally scoped Torn API access for verification, and may view ReviveRelay marketplace data.

Reviver marketplace access is governed by Reviver Pro.

### 2.4 Administrator

The service operator has private administrative access to reviver summaries, transaction evidence, reports, disputes, bans, subscription state, and system audit information.

## 3. Hard privacy and collection boundary

### 3.1 Public channels only

The client may process only channels positively identified as public.

Examples include:

- Global
- Trade
- Hospital
- Jail
- New Player
- public travel/location channels such as Mexico, Canada, United Kingdom, Japan, China, South Africa, and other public travel chats exposed by Torn
- future Torn channels only after they are explicitly classified as public in ReviveRelay's allowlist

### 3.2 Permanently excluded channels

The following must never enter the capture/classification/upload pipeline:

- Faction
- Company
- one-to-one private chats
- private/group chats
- competition or other pseudo-private chats unless Torn explicitly classifies them as public and ReviveRelay is deliberately updated to include them

The rule is **allowlist, not blocklist**. Unknown channel types are rejected.

### 3.3 Three-layer enforcement

Privacy enforcement happens at three independent layers:

1. **Discovery layer:** do not attach capture/classification observers to non-public chats.
2. **Client upload layer:** reject any candidate whose channel is not in the public allowlist.
3. **Server ingestion layer:** reject any candidate whose canonical channel type is not public.

A modified or outdated client must not be able to upload Faction, Company, or private content to the production pool.

### 3.4 No raw public-chat archive

The central service does not receive all public chat messages.

Classification occurs locally in the userscript. Only messages assessed as likely revive requests are submitted as candidates.

Non-candidate public messages remain local and are not uploaded.

## 4. Torn active-use constraint and "background" behavior

ReviveRelay's collector engine is independent of whether the ReviveRelay user interface is open.

The **Live Capture** window is a monitor only. Closing or minimizing that ReviveRelay panel does not stop the collector engine.

However, ReviveRelay must not intentionally turn Torn into an unattended/background scraping source. The collector must retain an active-use gate consistent with Torn's current scripting guidance:

- Torn page visible
- Torn tab/window focused
- recent direct user interaction
- collection paused when the page is hidden, minimized, backgrounded, or left unattended beyond the configured active-use window

ReviveRelay will not implement hidden-tab Sendbird/WebSocket harvesting, automated chat cycling, or other mechanisms whose purpose is to bypass Torn's active-view requirements.

## 5. Local public-chat classifier

### 5.1 Objective

Reduce central clutter and data exposure by deciding locally whether a public message is likely to be a revive request.

### 5.2 Classifier shape

Phase 2 uses a deterministic, versioned rules classifier rather than a remote AI model.

Signals include:

- direct phrases such as `revive me`, `need a revive`, `need rev`, `can someone revive`, `rev please`, `looking for revive`
- combinations of request language with `revive`, `rev`, `reviver`
- payment hints such as `paying`, `cash`, `xan`, `xanax`
- channel context, especially Hospital
- negative patterns such as `selling revives`, `revive service`, `revive skill`, or general discussion about reviving

The classifier must be covered by a growing test corpus of true positives and false positives gathered during development.

### 5.3 Candidate record

A submitted public-chat candidate contains only the fields needed by the service:

- canonical public channel ID/name
- sender Torn ID when available
- sender display name
- exact candidate message text
- Torn/source message ID when available
- Torn message timestamp when available
- local classifier version
- classifier score/reason metadata
- first local capture timestamp

No Faction/Company/private message content may appear in this schema.

## 6. Global candidate pool and deduplication

Multiple ReviveRelay users may see the same public message. The central service must store it once.

### 6.1 Canonical candidate identity

Preferred identity:

`channel_canonical_id + source_message_id`

Fallback identity when Torn does not expose a stable source message ID:

`channel_canonical_id + sender_id/name + Torn message timestamp + normalized message text`

The fallback must never include local `capturedAt`, because two collectors may see the same message at different times.

The resulting canonical candidate key is hashed with a collision-resistant server/client-compatible hash, preferably SHA-256.

### 6.2 Server guarantee

The candidate table has a database-level unique constraint on the canonical candidate key.

The API uses insert-on-conflict behavior so two simultaneous submissions cannot create duplicate candidate rows.

A duplicate submission may increment non-sensitive aggregate metadata such as:

- `seen_count`
- `first_seen_at`
- `last_seen_at`

The system does not need to publicly reveal which specific contributors observed the message.

## 7. Direct Request Revive workflow

### 7.1 Availability

When ReviveRelay determines that the local player is hospitalized, it presents a **Request Revive** action.

The request action is separate from Torn chat. Submitting it sends a structured request directly to ReviveRelay's backend. It does not post a message to Global, Trade, Hospital, Faction, or any other Torn chat.

### 7.2 Request form

The form offers exactly two payment methods:

#### Cash

- minimum offer: **$500,000 Torn dollars**
- whole Torn-dollar amount
- requester chooses the amount

#### Xanax

- minimum offer: **1 Xanax**
- whole-number quantity
- requester chooses the quantity

There is no `Free` option and no `Other` payment method.

The form includes an optional checkbox:

`Add a comment for the reviver`

When enabled, a free-text comment field becomes visible. The comment is informational only and never changes the machine-verifiable payment contract.

### 7.3 Server validation

The server independently rejects:

- Cash below $500,000
- fractional/invalid cash values
- Xanax below 1
- fractional Xanax values
- unsupported payment methods

Client validation is convenience only; server validation is authoritative.

### 7.4 One active request per requester

A Torn player may have at most one active direct revive request.

Submitting again while an active request exists updates or focuses the current request rather than creating duplicates.

The request remains active until one of the following occurs:

- it is successfully completed
- it is cancelled before payment
- it is closed by a no-refund requester exit
- it is refunded and closed
- it is administratively closed

## 8. Public-chat candidates are leads, not contracts

A public-chat candidate is not automatically a protected ReviveRelay transaction because the original speaker may not use ReviveRelay or may not have accepted ReviveRelay's payment/refund rules.

Reviver Pro users may see public candidates as leads with:

- channel
- sender name/ID
- candidate text
- timestamp
- profile/open-target action

The protected acceptance/payment/SLA/refund system begins only for a **direct ReviveRelay request**.

This prevents ReviveRelay from imposing contractual payment rules on players who merely typed something in Torn public chat.

## 9. Direct request transaction state machine

The authoritative transaction state lives in PostgreSQL.

Primary flow:

`AVAILABLE -> ACCEPTED -> WAITING_FOR_PAYMENT -> PAYMENT_VERIFIED -> WAITING_FOR_REVIVE -> terminal/exception state`

### 9.1 Accept

A Reviver Pro user clicks **Accept**.

The server performs an atomic conditional update/row lock so exactly one reviver can claim the request.

Once accepted, both sides are shown each other's Torn identity.

Requester sees at minimum:

- reviver name
- reviver Torn ID
- Open Profile action
- Copy Player ID action
- agreed payment
- ReviveRelay reputation summary
- payment countdown

Reviver sees at minimum:

- requester name
- requester Torn ID
- profile/target action
- agreed payment
- requester comment, if provided
- transaction state

### 9.2 Payment reservation window

Acceptance starts a **3-minute payment window**.

During the 3 minutes:

- the request is locked to that reviver
- no other reviver can accept it
- requester may pay the agreed amount
- requester may cancel before payment
- reviver waits for verification

If no qualifying payment is verified by the deadline:

- the reservation expires
- the reviver lock is released
- the request returns to AVAILABLE if the requester is still eligible
- neither side receives a penalty

### 9.3 Payment verification

The 5-minute revive timer does **not** start when the request is accepted.

It starts only when ReviveRelay verifies the agreed payment.

The backend records:

- `accepted_at`
- `payment_verified_at`
- `revive_deadline = payment_verified_at + 5 minutes`

For Cash, verification requires an incoming transfer to the assigned reviver from the requester meeting or exceeding the exact agreed amount rules for that transaction.

For Xanax, verification requires an incoming Xanax transfer from the requester to the assigned reviver meeting the agreed quantity.

A client-side `I have paid` action, if provided, merely asks the backend to check sooner. It does not constitute proof of payment.

### 9.4 Five-minute revive SLA

Once payment is verified, the assigned reviver has **5 minutes** to make a revive attempt.

Both requester and reviver see the same server-derived countdown.

A qualifying revive attempt must be evidenced through Torn API data, not merely inferred from hospital status.

## 10. Revive outcomes

### 10.1 Assigned reviver succeeds

State becomes `COMPLETED`.

The transaction is archived as a successful paid revive.

### 10.2 Assigned reviver attempts but fails

A genuine failed revive attempt is not misconduct.

The requester receives two options:

- **Request another attempt**
- **Request refund**

If another attempt is chosen and the assigned reviver agrees, a new 5-minute attempt window begins and a separate attempt record is created.

If the reviver declines the retry, or the requester selects refund, the transaction enters `REFUND_REQUIRED`.

Every attempt is stored separately; failed attempts are never overwritten by later attempts.

### 10.3 Another reviver succeeds first

If Torn evidence shows that a different player successfully revived the requester after payment was verified and before the assigned ReviveRelay reviver completed the service:

- service becomes impossible for the assigned reviver
- transaction enters `REFUND_REQUIRED`
- assigned reviver must return the verified payment

### 10.4 Requester self-exits Hospital

If the requester voluntarily leaves Hospital after payment, without a successful incoming revive from another player, no refund is due.

Examples include using an item or other self-directed method to leave Hospital.

The transaction closes as a requester-caused no-refund exit.

The requester cannot use this state to report the reviver for non-performance.

### 10.5 Hospital timer expires naturally

If the requester's Hospital time naturally expires before the assigned reviver completes the revive, no refund is due.

A requester who chooses to buy a revive with less than five minutes remaining accepts that risk.

The UI should warn when ReviveRelay can reliably determine that fewer than five minutes remain, but the request is not blocked.

### 10.6 No attempt within five minutes

If payment was verified and the assigned reviver has no qualifying revive attempt by the 5-minute deadline:

1. backend performs a final verification pass to account for API propagation delay
2. if no attempt is found, transaction becomes `REPORTABLE_NO_ATTEMPT`
3. requester gains a Report action

The report evidence bundle includes acceptance, payment, deadline, reviver/requester IDs, and absence of a matching attempt.

## 11. Refund workflow

### 11.1 Refund deadline

When a transaction enters `REFUND_REQUIRED`, the reviver has **10 minutes** to return the verified payment.

The backend records:

- `refund_required_at`
- `refund_deadline = refund_required_at + 10 minutes`
- `refund_verified_at`

### 11.2 Refund amount

Refund must match the verified payment:

- Cash payment -> same Cash amount returned
- Xanax payment -> same Xanax quantity returned

### 11.3 Successful refund

Verified refund closes the transaction as `REFUNDED`.

A required refund that is completed correctly is not itself misconduct.

### 11.4 Missing refund

If the 10-minute refund deadline expires without qualifying evidence:

1. backend performs a final verification pass
2. transaction becomes reportable
3. reviver is suspended from accepting new jobs pending evidence review

## 12. Reports, disputes, suspension, and bans

### 12.1 Evidence-first design

Users may provide optional screenshots/comments, but the primary evidence should be server-held transaction data and Torn API verification.

A user's claim alone does not automatically create a permanent ban.

### 12.2 Immediate protective suspension

For high-confidence cases such as:

- verified payment + no revive attempt after deadline
- verified refund requirement + no refund after deadline

submitting the report suspends the reviver from accepting new requests while the evidence is reviewed.

### 12.3 Permanent bans

A confirmed violation may permanently ban the Torn player ID from acting as a ReviveRelay reviver.

The ban is server-side and tied to Torn ID, not local installation state. Reinstalling the userscript does not reset reputation, disputes, subscription state, or bans.

### 12.4 Failed revives are not fraud

A verified failed attempt must never be counted as `no attempt` misconduct.

## 13. Reviver reputation

### 13.1 Public requester-visible summary

When a reviver accepts a direct request, the requester sees aggregate reputation including:

- completed/successful revives
- failed legitimate attempts
- success rate
- completed refunds
- verified disputes
- standing
- ReviveRelay member-since date

A failed revive attempt is informational and is not treated like misconduct.

### 13.2 Private administrative profile

The server stores a richer profile keyed by Torn player ID, including:

- total accepted jobs
- successful revives
- failed attempts
- payment-window expiries
- refunds required
- refunds completed
- refunds overdue
- reports received
- reports dismissed
- verified disputes
- late attempts
- no-attempt violations
- Cash-job count
- Xanax-job count
- last transaction
- last active time
- subscription history
- suspension/ban state
- internal administrator notes

### 13.3 Local cache versus authority

The userscript may cache reputation locally for presentation/performance.

Uninstalling clears local data, but authoritative reputation remains on the server and is restored after identity verification.

## 14. Reviver Pro

### 14.1 Free requester tier

The following remain free:

- direct Request Revive form
- Cash/Xanax offer creation
- optional comments
- transaction status
- payment/revive/refund timers
- requester reports
- requester history required to manage their own transactions
- public-channel local candidate contribution

### 14.2 Reviver Pro benefits

Reviver Pro controls access to earning/marketplace functionality including:

- live direct-request queue
- ability to accept paid direct requests
- pooled public-chat candidate leads
- request alerts
- Cash/Xanax filters
- offer-value filters/sorting
- personal earnings/activity history
- detailed personal reputation dashboard
- payment/revive/refund transaction workflow
- lead/request history

Basic reputation shown to a requester after a reviver accepts is never hidden behind a paywall.

### 14.3 Trial and pricing

- Reviver Pro trial: **7 days**
- **2 Xanax = 30 days**
- **20 Xanax = 365 days**
- yearly purchases scale by multiples: 40 Xanax = 730 days, 60 Xanax = 1,095 days, etc.

Subscription time stacks from the later of `now` or the current expiry date.

For automatic crediting:

1. if quantity is a positive multiple of 20, apply the yearly rate first: `365 * (quantity / 20)` days
2. otherwise, if quantity is a positive multiple of 2, apply the monthly rate: `30 * (quantity / 2)` days
3. unsupported quantities are not silently converted and require manual/admin handling if they were intended as subscription payment

This ensures 20 Xanax receives the yearly discount rather than being interpreted as ten 30-day purchases.

No per-job commission and no paid queue priority are planned for Phase 2.

### 14.4 Subscription verification

Subscription payments are sent to the configured operator Torn account.

The backend verifies incoming Xanax transfers using an operator-owned, minimally scoped Torn API key kept only in server secrets.

The API key and operator player ID are configuration values and never hard-coded into the public userscript.

### 14.5 Launch compliance gate

Before public launch of paid Reviver Pro, obtain/record any Torn approval or clarification required by the then-current Torn API/tool monetization rules.

Greasy Fork publication must accurately declare any required payment/tracking antifeatures and clearly describe server communication.

## 15. Torn identity and API verification model

### 15.1 User identity

ReviveRelay must not trust a Torn player ID supplied only by modified client JavaScript.

Registration/identity binding uses a minimally scoped Torn custom API key submitted over TLS to the backend for verification through Torn's `key/info` data.

After successful verification, the backend issues its own ReviveRelay session/installation credential bound to that Torn ID.

### 15.2 Requester verification scope

A requester using protected direct transactions must provide enough Torn API permission for ReviveRelay to verify identity and incoming revive evidence needed to distinguish a successful third-party revive from a requester self/natural exit.

The implementation should use the narrowest available Torn selections, centered on:

- key identity information
- the requester's incoming revive history during an active transaction
- public/basic status data as required to determine hospitalization/exit state

ReviveRelay must not request unrelated battle stats, messages, inventory, faction data, or other unnecessary data.

### 15.3 Reviver verification scope

A registered reviver provides the narrowest custom key needed for:

- outgoing revive verification
- incoming Cash payment verification
- incoming item/Xanax payment verification
- outgoing Cash refund verification
- outgoing item/Xanax refund verification

Where Torn custom log-category restrictions are available, keys must be limited to the exact relevant categories/types rather than unrestricted `user/log` access.

### 15.4 Key handling

- API keys are never written to Google Sheets
- API keys are never logged
- server-stored keys are encrypted at rest using an application encryption key held outside PostgreSQL
- only backend verification services may decrypt them
- users can revoke/rebind their key
- key access is audited without logging the key value

## 16. Backend technology

The authoritative backend will use:

- Node.js on the new Voidsmith VPS
- PostgreSQL as the authoritative datastore
- a versioned HTTPS JSON API
- server-side background jobs/timers for verification and state transitions
- database transactions/constraints for concurrency safety

Google Sheets is not the transactional database.

## 17. Mandatory VPS isolation

ReviveRelay must be deployed on the user's **new VPS server** under the Voidsmith project structure, but it must not share or interact with DungeonMasterOS, Nexis, or other application databases.

Recommended layout:

```text
/srv/voidsmith/
├── dungeonmasteros/
├── nexis/
└── reviverelay/
    ├── app/
    ├── config/
    ├── data/postgres/
    ├── backups/
    ├── logs/
    └── docker-compose.yml
```

### 17.1 Dedicated PostgreSQL instance

ReviveRelay receives its own PostgreSQL container/process, not merely another database inside an existing DungeonMasterOS/Nexis PostgreSQL instance.

It must have:

- dedicated PostgreSQL container/service
- dedicated database: `reviverelay`
- dedicated DB user, e.g. `reviverelay_app`
- dedicated strong password
- dedicated persistent storage path/volume
- dedicated private container network
- separate migration history
- separate backups
- separate restore procedure
- separate logs

### 17.2 Network isolation

The ReviveRelay PostgreSQL port must not be publicly exposed.

Prefer no host-published PostgreSQL port at all. The API reaches PostgreSQL only through the private ReviveRelay container network.

DungeonMasterOS and Nexis services are not members of the ReviveRelay DB network, and ReviveRelay receives no credentials for their databases.

### 17.3 Failure containment

A ReviveRelay database migration, restore, accidental destructive query, restart, or upgrade must be incapable of modifying DungeonMasterOS or Nexis data because it has neither their credentials nor a DB/network connection to their database instances.

## 18. Google Sheets as a one-way admin mirror

Google Sheets remains useful for the operator but is not authoritative.

Data flow is one-way:

`ReviveRelay PostgreSQL -> admin mirror/export -> Google Sheets`

Editing a Google Sheet must never mutate transaction state, reputation, bans, subscriptions, payments, or refunds in PostgreSQL.

Suggested private tabs include:

### Revivers

One summary row per Torn reviver ID with aggregate standing/statistics.

### Transactions

Administrative transaction summaries without API keys/secrets.

### Disputes

Administrative dispute summaries and internal status references.

### Subscriptions

Subscription state/payment summary.

Raw API credentials and secret evidence tokens are never mirrored.

## 19. Live Capture and options UI

ReviveRelay includes an Options area with a **Live Capture** view.

The Live Capture view shows local processing in real time without controlling whether the collector engine itself is running.

Example information:

- current collection state
- public channel detected
- candidate text
- classifier decision/score
- submitted/new/duplicate result
- local queue count
- pool connectivity
- candidate submission count
- duplicate count

Suggested filters:

- All candidates
- likely revive requests
- Global
- Trade
- Hospital
- Jail
- Travel

Faction, Company, private, and group-private filters do not exist because those channels are not processed.

Closing or minimizing Live Capture does not stop eligible collection.

## 20. Core database model

The schema should use immutable IDs and audit-friendly records rather than rewriting history.

Minimum logical entities:

### users

- Torn player identity
- current display name
- registration timestamps
- account state

### revivers

- Torn player ID
- Reviver Pro status
- trial/subscription dates
- standing/suspension/ban state
- aggregate reputation fields or materialized summaries

### public_chat_candidates

- canonical candidate key
- public channel
- sender identity
- message
- message timestamp/source ID
- classifier metadata
- first/last seen
- seen count

### revive_requests

- requester ID
- payment type
- payment amount/quantity
- optional comment
- state
- created/cancelled/closed timestamps

### transactions

- request ID
- assigned reviver ID
- acceptance timestamp
- payment deadline
- payment verified timestamp
- revive deadline
- refund-required timestamp/deadline
- terminal state

### payments

- transaction ID
- method
- expected amount
- verified amount
- Torn evidence/log identifier
- verified timestamp

### revive_attempts

- transaction ID
- reviver ID
- Torn revive ID/evidence
- attempt timestamp
- success/failure
- attempt sequence number

### refunds

- transaction ID
- required amount
- Torn evidence/log identifier
- required/deadline/verified timestamps

### disputes

- transaction ID
- reporter ID
- reason
- state
- evidence snapshot references
- reviewer/admin state
- outcome

### bans

- reviver ID
- reason
- source dispute/transaction
- created timestamp
- active/revoked state

### subscriptions

- reviver ID
- source payment evidence
- Xanax quantity
- credited days
- start/expiry timestamps

### audit_events

- actor/system
- entity
- state transition/action
- timestamp
- non-secret details

## 21. Concurrency and correctness requirements

The backend must guarantee:

- exactly one active direct request per requester
- exactly one assigned reviver per accepted request
- atomic request acceptance
- idempotent payment verification
- idempotent revive-attempt ingestion
- idempotent refund verification
- globally unique public-chat candidate keys
- state transitions validated server-side
- client cannot skip required states by submitting arbitrary status values
- timers are server-derived, never trusted from client clocks

## 22. API error handling

The client must distinguish:

- authentication failure
- revoked/invalid Torn API key
- subscription expired
- request already accepted by another reviver
- duplicate candidate
- payment not yet found
- Torn API temporarily unavailable
- backend temporarily unavailable
- rate limited
- invalid request state

Transient verification failures must not automatically penalize either player.

A timeout or Torn API outage pauses/retries verification and records the service condition rather than declaring fraud.

## 23. Security requirements

- HTTPS required for all client/backend communication
- secrets only through server environment/secret files with restrictive permissions
- PostgreSQL not public
- parameterized SQL only
- schema validation on every API request
- rate limits for candidate ingestion, request creation, accept attempts, reports, and auth
- server-side authorization by Torn ID and role
- API keys encrypted at rest and redacted from logs/errors
- audit important state transitions
- administrative actions authenticated separately from userscript sessions
- backup encryption where practical
- routine restore test for ReviveRelay backup only

## 24. Disclosure and consent

Onboarding must clearly explain that ReviveRelay:

- provides a community paid-revive service
- locally inspects supported public Torn chat channels for likely revive requests
- uploads only likely public-channel revive candidates, not all public chat traffic
- never processes/uploads Faction, Company, or private chat messages
- sends direct revive requests to the ReviveRelay backend
- uses Torn API access for identity/payment/revive/refund verification with explicitly stated scopes
- stores transaction/reputation data server-side tied to Torn player ID
- may suspend/ban revivers based on verified transaction misconduct
- offers paid Reviver Pro access using Xanax

Consent/disclosure text should be available again in Options after onboarding.

## 25. Testing strategy

Implementation follows TDD and requires automated coverage for the high-risk rules.

### 25.1 Privacy tests

- Global/Trade/Hospital/Travel accepted
- Faction rejected
- Company rejected
- private rejected
- unknown channel rejected
- server rejects forbidden channel records even from a modified client

### 25.2 Classifier tests

- strong revive requests accepted
- terse Hospital requests handled
- revive-service advertisements rejected
- revive-skill/general discussion rejected
- classifier behavior versioned and regression-tested

### 25.3 Candidate pool tests

- identical source message submitted concurrently stores one row
- fallback fingerprint is identical across different local capture times
- `capturedAt` cannot affect canonical identity

### 25.4 Direct request tests

- Cash below $500,000 rejected
- Xanax below 1 rejected
- one active request per requester
- accept race assigns exactly one reviver
- 3-minute payment timeout unlocks cleanly
- 5-minute timer begins only at payment verification

### 25.5 Outcome tests

- assigned success -> completed
- assigned failure -> retry/refund choice
- successful other reviver -> refund required
- requester self-exit -> no refund
- natural hospital expiry -> no refund
- no attempt after deadline -> reportable after verification pass

### 25.6 Refund/dispute tests

- exact Cash refund accepted
- exact Xanax refund accepted
- missing refund after 10 minutes -> reportable/suspension path
- failed revive is never mislabeled no-attempt fraud

### 25.7 Subscription tests

- trial lasts 7 days
- 2 Xanax -> 30 days
- 4 Xanax -> 60 days
- 20 Xanax -> 365 days
- 40 Xanax -> 730 days
- yearly rate takes priority for multiples of 20
- unsupported quantities are not silently credited
- early renewals stack from current expiry

### 25.8 Infrastructure tests/checks

- ReviveRelay DB has no public port
- API can reach only its own DB using provided credentials
- ReviveRelay secrets contain no DungeonMasterOS/Nexis DB credentials
- backup/restore test targets only ReviveRelay storage

## 26. Delivery stages

### Stage 1: Backend foundation

- isolated VPS project/container structure
- dedicated PostgreSQL
- migrations/schema
- API/auth foundation
- user/reviver identity binding
- public candidate ingestion/deduplication
- direct request state machine
- automated tests

### Stage 2: ReviveRelay client

- rename existing userscript
- public-only discovery
- local classifier
- candidate submission
- Live Capture
- direct Request Revive form
- requester status UI

### Stage 3: Marketplace verification

- reviver queue
- atomic Accept
- 3-minute payment window
- payment verification
- 5-minute revive SLA
- revive attempt verification
- retry/refund logic
- 10-minute refund workflow

### Stage 4: Trust and administration

- reputation
- reports/evidence
- suspension/ban workflow
- admin endpoints/tools
- one-way Google Sheets mirror

### Stage 5: Reviver Pro

- 7-day trial
- subscription state
- operator Xanax-payment verification
- 2 Xanax/30-day logic
- 20 Xanax/year and annual multiples
- paid-feature gating
- launch disclosure/compliance checklist

## 27. Explicit non-goals for Phase 2

To keep the first production version controllable, Phase 2 will not include:

- Faction/Company/private chat capture
- unattended hidden-tab Torn scraping
- automatic chat opening/cycling
- AI/LLM classification service
- real-money billing
- per-job commission
- paid queue priority
- faction-wide Reviver Pro subscriptions
- automatic Torn revive execution without direct reviver action
- Google Sheets as an authoritative transaction database

## 28. Success criteria

Phase 2 is successful when:

1. a hospitalized free user can create a paid Cash/Xanax revive request without posting to chat
2. an eligible Reviver Pro user can atomically accept it
3. payment is verified before the five-minute revive clock starts
4. success, legitimate failure, other-reviver success, requester exit, natural expiry, and no-attempt cases resolve according to the rules above
5. required refunds are verified within the ten-minute policy
6. disputes and bans are evidence-backed and survive reinstall
7. reputation remains tied to Torn ID
8. public-chat candidates are detected locally and globally deduplicated
9. no Faction, Company, or private content reaches the backend
10. ReviveRelay PostgreSQL is physically/logically isolated from DungeonMasterOS, Nexis, and other Voidsmith databases
11. Reviver Pro subscription duration is correctly credited from verified Xanax payments
12. Google Sheets functions only as a one-way private administrative mirror
