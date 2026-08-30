> **SUPERSEDED 2026-08-30:** Production ReviveRelay is moving to direct certified requests with no chat listening. See `2026-08-30-reviverelay-direct-certified-requests-design.md`. Historical evidence and completed Control B work remain useful.

# ReviveRelay Always-On Auto-Debug Architecture Design

Date: 2026-08-28
Status: Approved written specification
Repository: `R4G3RUNN3R/torn-revive-chat-collector`
Spec branch: `spec/reviverelay-auto-debug`
Server baseline: current `main` at `b9c8017cc95d612ebe03a578040d00f56f7580eb`
Proven client baseline: diagnostic `0.4.5-from-0.4.2`, derived from `90dc48071f7fa65e2baa156159b6e969659ac125`
Proven client artifact SHA-256: `fbfc6a27395b5d3cfa7bd0b3ebcab96e4be856d71d9772881e127eebb848fee9`

## 1. Purpose

ReviveRelay needs permanent, low-volume, privacy-bounded diagnostics that run for every installed client so client regressions, Torn transport changes, DOM changes and server communication failures can be diagnosed from server-side evidence without asking users to copy console logs or manually paste diagnostic reports.

The same early transport observer is also required to determine whether allowlisted public Torn chat messages, especially Hospital chat, remain available to the browser transport while the visible chat component is minimized.

This design adds one integrated Auto-Debug subsystem to the normal ReviveRelay userscript. The subsystem:

- starts as early as Tampermonkey can execute the script;
- passively observes Torn WebSocket traffic without modifying it;
- sanitizes data in the browser before anything can be queued or uploaded;
- sends compact, structured diagnostics automatically to the ReviveRelay VPS;
- stores detailed sanitized occurrences for 30 days;
- retains long-lived aggregate fingerprints/counters without retaining chat text;
- exposes a Debug Console from Settings while continuing to run when that console is closed;
- remains operationally isolated from DungeonMasterOS, Nexis, CIEL and every other Voidsmith product.

Auto-Debug is always enabled for every ReviveRelay user. It is not an opt-in setting.

## 2. User-approved product decisions

The following decisions are locked by explicit user approval:

1. Auto-Debug is integrated into the actual ReviveRelay userscript rather than installed as a second permanent probe.
2. Auto-Debug runs in the background for every ReviveRelay user.
3. Settings exposes a Diagnostics area and an `Open Debug Console` action.
4. Closing or minimizing the Debug Console does not stop background diagnostics.
5. Sanitized detailed diagnostic occurrences are retained for 30 days.
6. Long-lived aggregate diagnostic groups/counters may remain after detailed occurrences expire.
7. Raw WebSocket frames and normal chat text are not retained or uploaded as diagnostics.
8. The first integrated transport observer is diagnostic only. Production minimized-chat candidate extraction is a later controlled change after the transport payload has been proven in real Torn sessions.

## 3. Evidence and current state

### 3.1 Known-good real-browser client

The user has confirmed in a real Torn/Tampermonkey browser that `0.4.5-from-0.4.2`:

- displays the ReviveRelay panel;
- connects normally;
- preserves the 0.4.2 support-module implementation;
- reads the shared public candidate feed through the live server endpoint.

The diagnostic artifact is:

`/srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.5-from-0.4.2.user.js`

SHA-256:

`fbfc6a27395b5d3cfa7bd0b3ebcab96e4be856d71d9772881e127eebb848fee9`

The ten support modules are locked to these known-good SHA-256 values:

- `src/core.js` `d3de50932244fc6c8acbc48c4243e7fb7158b456e6f3943daee530100f539147`
- `src/chat-dom.js` `5decc73d73a46f1aa926d00ed898f18f246a28b76533a56af7dd133f1651bcd6`
- `src/public-channels.js` `0abc56e7506bcd235a771957f63fe76953065d2c7a37e02600ea8bc3c8a50a88`
- `src/client-chat-policy.js` `2235c3cd14b29ab5137fb4a050b89f6c79a5736133f0d8c601e426d6d3df5bd5`
- `src/api-client.js` `9660f1dad2dc20ed227330710aaf51c251ce44cbe28456eeb08b8776ff2e75b6`
- `src/versioning.js` `ffe8f8342d38c2588e36c17c1c2cd78f37b2e91f09544b5cd8c07d21e8b4c2ed`
- `src/update-manager.js` `3b9ba77a38d5c5a53b031130de0dd59eab3088e44fc1274fbe3a6e9ea7fbb3a8`
- `src/telemetry-client.js` `8f746f2e8c28eeab9d74bb08918a684e72677106850a40b27f1974d05b4c60ad`
- `src/revive-classifier.js` `5a2e27c74599b4f75a84699213b8a0269dd7f8ed3a92d73e80ecae49f5fc5014`
- `src/candidate-pipeline.js` `a224d2741108e3876c66d635806b2bf4f7a5f4af65386baaca92fbb965a24a3e`

These hashes are regression locks for the first Auto-Debug integration. A support-module change must be separately justified and browser-tested.

### 3.2 Client regression boundary

The user has confirmed:

- 0.4.2 panel appears;
- 0.4.3 panel disappears;
- 0.4.4 self-contained build also does not restore the panel;
- 0.4.5 built from the exact 0.4.2 client baseline appears and provides the shared feed.

The exact root cause of the 0.4.3/0.4.4 panel regression remains unproven. This design therefore does not treat current `main` client packaging as a safe baseline merely because its automated tests pass.

### 3.3 Minimized chat DOM result

The local-only minimized-chat DOM probe showed that the current Hospital message body/container is not available through the existing DOM extraction path once the relevant chat component is minimized. Therefore the current DOM collector cannot solve minimized Hospital capture.

### 3.4 Transport probe result

The separate local-only transport probe has successfully installed a WebSocket hook in the user's Torn browser and observed inbound Torn WebSocket frames. The current endpoint classifier has not yet identified the active socket as the expected chat socket, and a full minimized Hospital message payload has not yet been proven.

This is evidence that the transport layer is reachable. It is not evidence that minimized Hospital message bodies are already available.

## 4. Non-negotiable security and privacy constraints

1. ReviveRelay PostgreSQL remains isolated from every other Voidsmith product database.
2. Auto-Debug receives no DungeonMasterOS, Nexis, CIEL or website database credentials.
3. Identity-only Torn API keys remain one-time verification material and are never persisted by Auto-Debug.
4. Transaction-verification credentials remain encrypted server-side and are never available to Auto-Debug.
5. Cookies, authorization headers, session tokens, API keys, passwords and WebSocket query parameters are forbidden diagnostic fields.
6. Raw WebSocket frame bodies are never written to Tampermonkey storage, server queues, PostgreSQL, Google Sheets or server logs.
7. Normal public chat message text is not uploaded through the diagnostics path.
8. Faction, Company, private/group-private, competition, poker, unknown and unclassified chat text is never uploaded through the diagnostics path.
9. Exact private/non-public channel IDs or names are not retained as diagnostics. They collapse to a generic non-public/forbidden classification.
10. Known public channel IDs may be retained only when they are members of ReviveRelay's explicit public allowlist.
11. Browser/client-supplied user IDs are never trusted. Authenticated attribution comes only from the validated ReviveRelay bearer session and is stored as the internal ReviveRelay user UUID.
12. The diagnostic subsystem must fail open with respect to Torn and normal ReviveRelay behavior. A diagnostics failure must never block or modify Torn chat, ReviveRelay requests, candidate capture or marketplace actions.
13. Auto-Debug must not expose PostgreSQL publicly or add a public administrative diagnostics endpoint.
14. `PAID_TIER_ENABLED=false` remains unaffected by this work.

## 5. High-level architecture

One installed userscript contains four logical client layers:

```text
Tampermonkey document-start
        |
        v
Early Transport Observer
        |
        +--> in-memory sanitize/aggregate --> bounded debug outbox
        |
        v
Normal ReviveRelay application bootstrap
        |
        +--> existing DOM collector / requester / reviver / activity UI
        +--> existing error telemetry
        +--> Auto-Debug uploader
        +--> Settings -> Open Debug Console
```

Server flow:

```text
Sanitized client debug batch
        |
        v
POST /v1/telemetry/debug
        |
        v
Strict schema validation
        |
        v
Second server-side sanitization
        |
        +--> diagnostic_event_groups
        +--> diagnostic_event_occurrences
        |
        v
30-day occurrence retention
```

The existing `/v1/telemetry/errors` route remains dedicated to actual errors/exceptions. Routine Auto-Debug events do not pollute error triage.

## 6. Bootstrap and packaging safety

### 6.1 Why the current external `@require` arrangement cannot be assumed safe for the early hook

Tampermonkey documents `@run-at` as the first possible execution moment, not a guarantee. Its documentation explicitly warns that a userscript using `@require` may execute after the document has already loaded if required scripts take time to fetch.

References:

- `https://www.tampermonkey.net/documentation.php?locale=en&q=run_at`
- `https://www.tampermonkey.net/documentation.php?locale=en&q=externals`

The proven 0.4.5 diagnostic currently uses ten immutable external `@require` URLs. That is acceptable for the current `document-idle` application, but cannot be relied upon for a transport hook that must execute before Torn creates its chat connection.

### 6.2 Why current 0.4.4 self-contained packaging is not accepted as proof

0.4.4 bundled the then-current module tree and failed the real-browser panel test. That does not prove that bundling itself is the cause because the bundled module tree included post-0.4.2 client changes that are absent from the browser-proven 0.4.5 diagnostic.

Therefore a self-contained exact-0.4.2 module build must be tested independently before Auto-Debug relies on it.

### 6.3 Mandatory browser control gates

Implementation must proceed through these controls in order. No control may be skipped because automated tests pass.

#### Control A - freeze the proven 0.4.5 client baseline

Create a canonical commit containing the exact browser-proven 0.4.5 client behavior while retaining the current server-side shared-feed implementation. This is a reconciliation commit, not a rollback of the live server code.

The commit must preserve all ten support-module hashes listed in section 3.1.

The generated manual artifact must byte-match the already accepted 0.4.5 diagnostic behavior, except for immutable build provenance that necessarily reflects the new canonical commit.

#### Control B - exact-module self-contained packaging only

Create a diagnostic build that:

- uses the exact ten 0.4.2 support-module source bytes;
- embeds them into one userscript in their proven order;
- preserves 0.4.5 application behavior;
- keeps `@run-at document-idle`;
- adds no transport observer and no Auto-Debug behavior.

The user must confirm in Torn that the ReviveRelay panel still appears and the shared public feed still works.

If Control B fails, bundling is not accepted and the architecture must be revisited before Auto-Debug implementation continues.

#### Control C - document-start with deferred application only

After Control B passes, create a diagnostic build that:

- keeps the same exact embedded module bytes;
- changes the userscript to `@run-at document-start`;
- performs no WebSocket interception yet;
- defers the existing ReviveRelay application startup until the DOM/application prerequisites used by 0.4.5 are satisfied.

The user must again confirm the normal panel and shared feed in Torn.

Only after Control C passes may the transport observer be integrated.

### 6.4 Sandbox/main-world compatibility

Tampermonkey currently documents `raw` as the default sandbox mode and describes it as page-context execution. The existing standalone probe used `@grant none`, while ReviveRelay requires `GM_getValue`, `GM_setValue`, `GM_xmlhttpRequest` and `GM_addStyle`.

References:

- `https://www.tampermonkey.net/documentation.php?locale=en&q=sandbox`
- `https://www.tampermonkey.net/documentation.php?locale=en&q=grant`

The standalone probe therefore proves that a transport hook can work in the user's environment, but it does not by itself prove that the granted integrated script will hook the same page-level constructor.

The integrated diagnostic must report whether its wrapper remains installed and whether it sees Torn sockets/frames. No `@sandbox` metadata change is made merely on assumption. If a sandbox change becomes necessary, it requires its own real-browser control test.

## 7. Early transport observer

### 7.1 Installation

At the first executable statement of the self-contained userscript:

1. capture the native `window.WebSocket` constructor;
2. install exactly one wrapper guarded by a unique ReviveRelay sentinel;
3. preserve `prototype`, `CONNECTING`, `OPEN`, `CLOSING`, `CLOSED` and constructor behavior;
4. create the native socket with the exact original arguments;
5. add a passive `message` listener;
6. return the native socket.

The observer must never:

- rewrite outgoing messages;
- override `send`, `close` or application `onmessage` handlers;
- cancel events;
- delay Torn traffic;
- reconnect Torn sockets;
- inject messages into Torn chat.

### 7.2 Endpoint sanitization

Socket URLs are parsed immediately.

Diagnostics may retain only:

- normalized hostname;
- a normalized pathname template;
- whether the hostname belongs to Torn;
- a coarse socket classification.

The pathname template is bounded to 160 characters and replaces numeric IDs, UUID-like segments and opaque long token-like path segments with placeholders before persistence. Query strings, fragments, credentials and URL userinfo are discarded before any event object is created.

Only Torn-owned sockets are inspected beyond endpoint classification.

### 7.3 Frame decoding limits

The observer may decode:

- text frames;
- `ArrayBuffer` frames;
- `Blob` frames.

A maximum of 64 KiB per frame may be inspected. Oversized frames are counted as an `oversize` bucket and are not parsed further.

Raw decoded text exists only in a local function scope long enough to classify the frame and produce a sanitized result. No raw frame field exists in the diagnostic event schema.

### 7.4 Structural parsing

The initial parser supports conservative Socket.IO-style envelopes, including numeric prefixes followed by JSON arrays/objects.

It may extract only:

- whether JSON parsing succeeded;
- an event name when it is the explicit envelope event-name field and matches a strict technical identifier pattern;
- structural paths to a synthetic ReviveRelay marker while a marker test is active;
- known allowlisted public channel classification;
- whether Hospital public context is identified;
- frame type and size bucket.

It does not recursively export arbitrary scalar values.

### 7.5 Channel privacy mapping

Channel observations normalize to one of:

- an exact allowlisted public channel such as `public_hospital`;
- `public_other_allowlisted` where exact naming is not needed;
- `forbidden_or_nonpublic`;
- `unknown`.

For `forbidden_or_nonpublic` and `unknown`, no exact channel ID/name/path extracted from payload content is uploaded.

### 7.6 Activity gate

The transport wrapper remains installed for the lifetime of the page so hook health can be diagnosed continuously. Content-sensitive frame decoding is still gated by ReviveRelay's active-use policy.

When the Torn page is not visible/focused or falls outside the existing recent-interaction window:

- the observer may maintain only coarse transport-health counters such as socket existence and frame count/type/size bucket;
- it does not parse chat payload content for channel identity, marker text or message structure;
- it does not create candidates or alerts from those frames.

When the page is visible/focused and recently interacted with, the observer may perform the bounded structural parsing defined above.

This keeps `background diagnostics` distinct from unattended/background chat scraping.

### 7.7 Synthetic marker mode

The Debug Console can create a random marker such as `RRWS-123456`.

Marker mode:

- is off by default;
- expires automatically after 10 minutes;
- never searches historical data;
- records only marker-hit boolean, safe event name, known public-channel classification and structural key/index paths;
- never records neighboring scalar values or the surrounding raw payload.

The marker is synthetic test data and contains no Torn user information.

## 8. Auto-Debug client event model

Auto-Debug uses a dedicated strict event model rather than the free-form error envelope.

Initial event types:

- `client_bootstrap`
- `transport_summary`
- `transport_hook_anomaly`
- `public_chat_structure`
- `synthetic_marker_hit`
- `dom_collector_summary`
- `api_health_summary`
- `debug_uploader_state`

Each event type has an explicit allowlist of scalar fields. Unknown keys are removed client-side and rejected or dropped server-side.

Permitted diagnostic values include:

- client version and build commit;
- startup phase;
- hook active boolean;
- socket count;
- Torn socket count;
- sanitized socket host/path;
- inbound frame counters by text/binary type;
- frame-size buckets;
- parsed-envelope counter;
- safe technical event name;
- allowlisted public-channel classification;
- Hospital identified boolean;
- synthetic marker hit boolean;
- marker structural paths;
- `document.visibilityState` as a bounded enum;
- document-focused boolean;
- existing DOM collector open-chat/list-item counts;
- candidate queue depth;
- debug queue depth;
- last upload result code;
- HTTP status class for ReviveRelay API health;
- timestamps.

Forbidden fields include message text, raw payloads, request bodies, headers, cookies, credentials, Torn API keys, transaction-verification keys, session tokens and arbitrary client-provided identifiers.

## 9. Client aggregation, upload cadence and local queue

### 9.1 Healthy background cadence

A healthy client emits approximately one compact summary batch per minute rather than one request per WebSocket frame.

Immediate flushes are reserved for bounded high-value events such as:

- startup hook failure;
- wrapper replacement/loss;
- parser failure threshold crossing;
- synthetic marker hit;
- repeated API upload failure state change.

### 9.2 In-memory counters

Per-frame activity is aggregated locally into counters and size/type buckets. Individual normal frame events are not persisted.

### 9.3 Bounded persisted outbox

Only already-sanitized event envelopes may enter Tampermonkey storage.

The debug outbox is:

- capped at 100 events;
- capped to events no older than 24 hours;
- oldest-first dropped when full;
- drained in batches of at most 20;
- independently failure-contained from the candidate and error-telemetry outboxes.

A dropped-debug-event counter is permitted so sustained outage pressure is visible later.

### 9.4 Backoff

Retry uses the bounded ReviveRelay schedule of 5s, 15s, 30s and 60s, then caps repeated background retries at 300 seconds.

Auto-Debug upload failure must never recurse into Auto-Debug indefinitely. The uploader reports state transitions through bounded counters, not a new event for every failed send.

## 10. Server diagnostics endpoint

Add:

`POST /v1/telemetry/debug`

### 10.1 Authentication

The endpoint accepts early anonymous diagnostics when no bearer token exists.

If a bearer token is presented:

- the normal ReviveRelay session authenticator validates it;
- only the server-derived internal user UUID may be associated with the occurrence;
- any client-supplied identity field is rejected or ignored.

An invalid presented bearer token fails safely rather than silently storing it as anonymous.

### 10.2 Request contract

A request contains 1 to 20 diagnostic events.

The route has a hard 64 KiB body-size limit for the entire request.

Every event is validated by a strict schema keyed by `eventType`.

Unknown event types, raw body fields and unsupported context keys fail validation.

### 10.3 Server-side second sanitization

Even though the client sanitizes first, the server repeats:

- URL query/fragment removal;
- token/credential redaction;
- string-length bounds;
- technical identifier validation;
- known-public-channel validation;
- context-key allowlisting.

The server never assumes a modified userscript obeys the privacy contract.

### 10.4 Rate limits

The route must not share the exact same rate bucket as error telemetry.

Target limits:

- authenticated clients: 30 requests per five minutes per authenticated internal user;
- anonymous startup diagnostics: 10 requests per five minutes per trusted proxy source.

The intended healthy rate is about five requests per five minutes or less, so these limits leave room for anomalies without permitting frame-by-frame flooding.

If the rate-limit framework cannot safely key authenticated traffic by internal user UUID, the implementation plan must explicitly solve that before rollout rather than falling back to a NAT-hostile global IP bucket.

## 11. Diagnostic persistence model

Create dedicated tables rather than overloading `error_groups` and `error_occurrences`.

### 11.1 `diagnostic_event_groups`

Minimum fields:

- `id` UUID primary key;
- `fingerprint` unique;
- `event_type`;
- `summary_code`;
- `first_version`;
- `last_version`;
- `last_build_commit`;
- `occurrence_count`;
- `first_seen_at`;
- `last_seen_at`;
- `created_at`;
- `updated_at`.

The fingerprint is based only on stable technical fields. It must not include user UUIDs, exact timestamps, random marker values or raw URLs.

### 11.2 `diagnostic_event_occurrences`

Minimum fields:

- `id` UUID primary key;
- `diagnostic_event_group_id` foreign key;
- nullable internal `user_id` foreign key;
- `version`;
- `build_commit`;
- sanitized `context` JSONB;
- `occurred_at`;
- `received_at`.

There is deliberately no raw message/body/stack/header column.

### 11.3 Indexes

At minimum:

- unique group fingerprint;
- occurrences by group and received time;
- occurrences by nullable user and received time;
- groups by last seen time/event type.

## 12. Retention

Detailed diagnostic occurrences are retained for 30 days.

The existing daily `telemetry.retention` worker schedule may be extended to purge both:

- `error_occurrences` older than 30 days;
- `diagnostic_event_occurrences` older than 30 days.

Aggregate diagnostic groups are not automatically deleted by that retention job.

After occurrence deletion, long-lived groups retain only technical aggregate information such as fingerprint, event type, count and first/last version/time. They do not retain user identity lists.

## 13. Settings and Debug Console UX

### 13.1 Settings Diagnostics card

Settings contains a Diagnostics card with:

- status chip `AUTO-DEBUG: ACTIVE`;
- explanatory privacy text;
- client version/build;
- transport-hook status;
- sanitized debug outbox depth;
- last successful diagnostics upload time;
- `Open Debug Console` button.

There is no user checkbox that disables Auto-Debug because the approved product mode is always-on diagnostics for all ReviveRelay clients.

The existing 0.4.5 `Send sanitized error diagnostics` toggle is removed. Both existing sanitized exception/error telemetry and the new Auto-Debug technical telemetry are always-on so Settings does not present contradictory privacy semantics. The Settings card discloses both channels and their privacy bounds but does not offer an off switch.

### 13.2 Separate Debug Console window

`Open Debug Console` opens a ReviveRelay-owned draggable/minimizable diagnostic panel separate from the normal Request/Reviver/Activity/Settings content.

Closing or minimizing the console only changes visibility. It does not stop:

- transport observation;
- local aggregation;
- diagnostics queueing;
- server upload.

The console may show only sanitized data, including:

- hook active state;
- sanitized Torn socket host/path;
- socket/frame counters;
- text/binary counts;
- frame-size buckets;
- parsed envelope counts;
- safe technical event names;
- public/Hospital classification;
- visibility/focus state;
- DOM collector coverage;
- ReviveRelay API health;
- debug outbox depth and dropped count;
- last upload status/time;
- recent sanitized ReviveRelay errors;
- synthetic marker controls.

A `Copy Safe Report` action may remain available as a fallback, but normal debugging does not depend on the user copying it.

## 14. Server-side operator access

Initial Auto-Debug implementation adds no public admin API and no public diagnostics dashboard.

Operational inspection is performed server-side through SentinelX/approved VPS access against the isolated ReviveRelay database or a bounded local CLI/query helper.

This is sufficient for the current workflow: after a user reproduces a bug, the operator can inspect recent sanitized diagnostic groups/occurrences directly without asking the user for logs.

A future Voidsmith Command Centre diagnostics UI is a separate project and is not required for this implementation.

## 15. Error and anomaly fingerprinting

Diagnostic grouping must normalize high-cardinality values before hashing.

Examples:

- socket endpoint uses `host + path`, never query string;
- frame size uses a bucket rather than exact every-frame size;
- random marker value is excluded;
- timestamps are excluded;
- internal user UUID is excluded;
- occurrence counters are excluded;
- structural paths may be normalized to key/index shapes.

This allows one transport regression to aggregate across many users and versions instead of creating a new group for every occurrence.

## 16. Failure containment

The subsystem must handle these cases explicitly:

### 16.1 Observer installation fails

Normal ReviveRelay still starts. A bounded `transport_hook_anomaly` is queued when possible.

### 16.2 Another script replaces `window.WebSocket` later

Periodic health checks compare the installed constructor with the expected wrapper. The state is reported as a technical anomaly without trying to repeatedly fight other scripts for ownership.

### 16.3 Socket opened before observer installation

The subsystem reports bootstrap timing/hook state and does not invent missing transport evidence. The browser acceptance gate determines whether the packaging executes early enough in practice.

### 16.4 Torn changes its frame format

Parse failures increment bounded counters. Raw frames are not uploaded to compensate. Synthetic marker mode and structural parser updates are used to investigate the new format.

### 16.5 ReviveRelay API unavailable

Sanitized events enter the bounded 24-hour outbox. Normal product functionality continues as far as its own API dependencies permit.

### 16.6 Local storage unavailable/full

Diagnostics fall back to in-memory aggregation and drop rather than blocking Torn or ReviveRelay.

### 16.7 Server rejects diagnostics

The client records only bounded uploader status/counters. It does not recursively generate an event per rejection.

## 17. Minimized public-chat feature boundary

The first Auto-Debug release does not convert transport frames into shared revive candidates.

Before a later minimized-chat collector can be enabled, real-browser evidence must demonstrate all of the following while the relevant public chat UI is minimized:

1. the integrated main-script transport hook remains active;
2. inbound frame delivery continues;
3. a synthetic marker posted in Hospital is received;
4. Hospital/public channel identity is deterministically recoverable;
5. the full marker-containing message field is structurally recoverable;
6. private/non-public traffic can be excluded with a fail-closed policy;
7. the behavior remains within the approved Torn scripting boundary communicated by the user.

Only then may a separate design/change route allowlisted public transport messages into the existing candidate classifier/pipeline.

The candidate server API, dedupe and public-channel allowlist remain authoritative even after that future change.

## 18. Testing strategy

All implementation uses TDD.

### 18.1 Client tests

Add tests for:

- exact preservation of the ten proven support-module hashes through the bootstrap controls;
- self-contained exact-module packaging;
- `document-start` metadata and deferred normal startup;
- WebSocket constructor/prototype/static constant preservation;
- passive listener behavior;
- URL query/fragment stripping;
- frame-size cap;
- text/ArrayBuffer/Blob decoding;
- strict Socket.IO envelope parsing;
- event-name allowlisting;
- public/non-public/unknown channel collapse;
- no raw text in diagnostic envelopes;
- marker path extraction without neighboring values;
- queue cap and 24-hour expiry;
- heartbeat aggregation and no per-frame uploads;
- backoff and non-recursive upload failure;
- Debug Console visibility independent of collector state;
- Settings `AUTO-DEBUG: ACTIVE` state;
- existing Request/Reviver/Activity behavior unchanged.

### 18.2 Server tests

Add tests for:

- strict `/v1/telemetry/debug` schema;
- malformed/unknown fields rejected;
- anonymous early events accepted within limits;
- valid bearer attribution uses only internal UUID;
- invalid bearer fails safely;
- client-forged user identity ignored/rejected;
- server-side URL/token redaction;
- raw payload/chat fields impossible to persist;
- rate limits;
- diagnostic fingerprint stability across users/timestamps/markers;
- aggregate upsert under concurrency;
- 30-day occurrence purge;
- aggregate group retention;
- DB migration idempotence.

### 18.3 Browser acceptance gates

Automated tests are necessary but not sufficient because 0.4.3/0.4.4 already demonstrated a real-browser regression despite green tests.

Mandatory human browser gates are:

1. Control B panel/shared-feed acceptance;
2. Control C document-start panel/shared-feed acceptance;
3. integrated Auto-Debug panel/shared-feed acceptance;
4. VPS receipt of sanitized Auto-Debug events;
5. Debug Console open/close behavior;
6. synthetic marker minimized-Hospital transport test.

No automatic-channel promotion occurs before these gates pass.

## 19. Baseline verification record

Before writing this spec, the isolated spec worktree was created from `main` at `b9c8017`.

Baseline client suite:

- 123 tests passed;
- 0 failed.

Baseline server suite requires both PostgreSQL and `git` for all tests. Using a disposable database inside the private ReviveRelay Docker network:

- 224 of 226 server tests passed;
- the only two failures were deployment-script tests caused by the slim runtime API container not containing the `git` executable;
- those same deployment-script tests passed in the host-side baseline run where `git` is available;
- the disposable test database was dropped after the run.

Therefore the observed baseline failures are environment/tooling limitations, not application test failures.

## 20. Release strategy

1. Do not alter the current automatic client channel while the bootstrap controls are being proven.
2. Freeze a canonical browser-proven 0.4.5 client baseline while retaining current server functionality.
3. Run Control B and obtain user browser acceptance.
4. Run Control C and obtain user browser acceptance.
5. Implement server diagnostics storage/route under TDD.
6. Implement client Auto-Debug observer/uploader/Debug Console under TDD.
7. Build a manual diagnostic release only.
8. User installs and confirms the normal ReviveRelay panel/shared feed still work.
9. Operator verifies sanitized diagnostics arrive in the VPS database.
10. Run the synthetic marker/minimized-Hospital diagnostic.
11. Only after all verification passes may the release be considered for the automatic channel.

The release process must preserve rollback access to the known-good 0.4.5 manual baseline throughout this work.

## 21. Out of scope

This design does not implement:

- automatic minimized-chat candidate submission yet;
- background/unfocused Torn-page scraping beyond the approved operating boundary;
- a public diagnostics dashboard;
- cross-product Voidsmith telemetry;
- DungeonMasterOS/Nexis/CIEL account integration;
- Reviver Pro billing;
- raw chat archives;
- private/faction/company chat monitoring;
- long-term storage of detailed user-attributed diagnostics beyond 30 days.

## 22. Acceptance criteria

The architecture is complete only when all of the following are true:

- one ReviveRelay userscript contains the working product and Auto-Debug subsystem;
- early transport observation does not break the known-good panel;
- the exact 0.4.2 support-module behavior is preserved through the bootstrap safety controls;
- background diagnostics run without the Debug Console being open;
- normal traffic is aggregated, not uploaded per frame;
- raw frames/chat text/credentials cannot enter the diagnostics storage path;
- server validation and sanitization independently enforce the privacy contract;
- detailed occurrences purge after 30 days;
- aggregate diagnostic groups remain available for long-term regression trends;
- Settings exposes Auto-Debug status and an Open Debug Console button;
- operator can inspect recent diagnostics directly on the ReviveRelay VPS;
- all automated tests pass in their required environments;
- the user confirms the real Torn/Tampermonkey panel remains functional before promotion.
