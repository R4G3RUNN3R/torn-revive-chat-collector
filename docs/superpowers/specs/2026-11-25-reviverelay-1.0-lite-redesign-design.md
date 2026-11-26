# ReviveRelay 1.0 "Lite" Redesign Design

Status: approved direction, open questions decided · 2026-11-25
Owner: R4G3RUNN3R [3877028]
Baseline: client 0.7.3 (published review), 0.7.4 (engineering candidate), server 0.6.1-paid-race-20261125

## Context and audited baseline

ReviveRelay works, but it does not feel light. Measured on the published 0.7.3 client:

| Measure | 0.7.3 |
| --- | --- |
| Userscript size | 172 KB, 3,776 lines, one file |
| Recurring timers per tab | 9 `setInterval`s (request 10 s, queue 10 s, invoice 15 s, Pro 60 s, sidebar reconcile 5 s, telemetry 30 s, clock, PDA launcher watch, update check) |
| Server requests per tab, everything active | ~17 per minute, **in every open Torn tab, visible or not** |
| Cross-tab coordination | none (3 tabs ≈ 3× the traffic and 3× the notifications risk) |
| Icons / graphics | text only, no SVG |
| Wholesale `innerHTML` re-renders | 19 call sites |
| CSS isolation | none (shares the page with Torn and TornTools styles) |

A survey of the most-installed and best-regarded Torn userscripts (FF Scouter V2, MoDuL's Smuggler, Torn City Reviver's Tool, Universal Healthcare Revives, Torn War Stuff Enhanced, BUSTR, WarRevive, DX Medical) showed that perceived lightness comes from behaviour, not file size:

- **Do work once, share it:** FF Scouter caches in IndexedDB, shares across tabs with `BroadcastChannel`, defers to `requestIdleCallback`, and marks processed nodes with `data-*` attributes.
- **Few timers, no page-wide observers:** MoDuL's Smuggler (254 KB) runs one interval and zero `MutationObserver`s, yet is the most polished visually (inline SVG icon set, CSS variables, 120–250 ms transitions, `pointer: coarse` detection for TornPDA).
- **Paint from cache first:** Reviver's Tool advertises "near-instant first load" by rendering cached state, then refreshing.
- **Tiny requester entry point:** UHC's whole requester flow is a 3.6 KB "REVIVE ME" button in Torn's header. That header slot is the ecosystem convention players already expect.
- **Live inside Torn's own pages:** FF Scouter and War Stuff Enhanced add small badges and columns into Torn lists rather than floating panels.

Owner decisions taken on 2026-11-25:

| Question | Decision |
| --- | --- |
| Audience | Both requesters and revivers; requester experience first |
| Visual direction | Native-plus: feels part of Torn, with a ReviveRelay accent, icons and status motion |
| Platform | Desktop and TornPDA equally; designed mobile-first |
| Scope | Full redesign (new engine and new UI), shipped as 1.0 |

## Goal

ReviveRelay 1.0 is a light revive add-on that:

1. costs **nothing** in a background tab and almost nothing in a visible idle tab;
2. tells the requester, at a glance from Torn's header, exactly where their revive is;
3. gives revivers a fast, legible queue that sorts itself and never double-notifies;
4. looks like a careful extension of Torn on desktop and on TornPDA;
5. keeps every trust, payment and policy guarantee the 0.6/0.7 line established.

## Non-goals

- No change to the money model: requester access stays free; Reviver Pro, prices, trial, OWNER rules and the receiver account are unchanged.
- No change to transaction semantics: the server state machine (`server/src/domain/transaction-state.js`) is authoritative and keeps all 16 states.
- No automation of Torn game actions: no auto-pay, no auto-revive, no moving or re-skinning Torn's own action buttons (e.g. no "quick revive" that repositions Torn's Yes button).
- No scraping of chat or hidden pages, and no non-API background Torn requests.
- No remote code loading, `eval`, or runtime-fetched modules.
- Faction/war bulk revive contracts are out of scope for 1.0 (see Future work).

## Carried-forward invariants

Everything in "Locked architecture and trust invariants", "Dormancy invariant", "Unknown and pending state invariant" and "Network and credential boundary" of `2026-09-10-reviverelay-completion-hardening-design.md` applies unchanged. In particular:

- the server is the source of truth for request state, payment, entitlement and alerts; the client never manufactures success;
- unknown, pending, transport failure and stale cache are rendered as such, never as authoritative success or failure;
- a disabled, unlicensed or inapplicable client is genuinely dormant;
- the merchant/receiver credential never enters the userscript.

1.0 adds one more:

**Single-actor invariant.** For one browser profile, at most one tab polls the server and at most one tab fires a given notification. Other tabs render shared state.

## Design principles

1. **Status, not screens.** The default UI is one header pill. Everything else is opened on demand.
2. **Zero cost when unseen.** Hidden tabs do no network work and no DOM work. Collapsed UI holds a few dozen DOM nodes, not hundreds.
3. **Paint from cache, then confirm.** Show the last known state instantly, visibly marked as stale until the server confirms it.
4. **One click, one action.** Every Torn-affecting action is a single explicit player click that opens Torn's own page; ReviveRelay never performs it.
5. **Native-plus.** Torn's typography, spacing and dark/light mode; ReviveRelay adds one accent colour, an icon set and short status motion.
6. **Same product on both platforms.** Desktop and TornPDA share components; only layout containers differ.

## Experience design

### Header pill (every Torn page)

A single pill mounts in Torn's header button area (the slot other revive services use) on every platform, TornPDA included. If the header slot is missing or too narrow (checked on mount and on resize), it falls back to the launcher position the 0.7.3 PDA work already made reliable. It shows an icon, a short label and, when relevant, a timer or progress ring.

The pill is a pure function of `(role, transaction state, freshness)`. Requester mapping:

| Server state | Pill | Tone | Expanded sheet shows |
| --- | --- | --- | --- |
| none, eligible | Revive me · *n* online (when *n* = 0: Revive me) | neutral | Request button; "*n* revivers online", or "Revivers are notified" when *n* = 0 |
| none, not verified | Set up revives | warning | Verification setup (existing flow) |
| `AVAILABLE` | Waiting · m:ss | waiting | Cancel; position hint |
| `WAITING_FOR_PAYMENT` | Pay *reviver* · m:ss left | action | Exact amount, currency, deadline, **Open reviver's profile** (manual send in Torn), Cancel |
| `PAYMENT_RECONCILING` | Checking payment | waiting | "Verifying your payment with Torn" |
| `WAITING_FOR_REVIVE` | *Reviver* is reviving | progress | Reviver name, elapsed time |
| `COMPLETED` | Revived | success | Summary; pill fades back to idle after 5 s |
| `FAILED_ATTEMPT_CHOICE` | Revive failed · choose | action | Ask the same reviver to retry, or Request refund |
| `RETRY_OFFERED` | Retry requested | waiting | Waiting for the reviver to accept; declining or timing out moves to refund |
| `REFUND_REQUIRED` / `REFUND_RECONCILING` | Refund in progress | waiting | Amount, reviver, deadline |
| `REFUNDED` | Refunded | success | Summary |
| `PAYMENT_EXPIRED`, `CANCELLED_BY_REQUESTER`, `CLOSED_*` | (idle) | neutral | Brief closing note in history |
| `REPORTABLE_*` | Needs attention | attention | What happened and how to report it |

Freshness overrides: while cached state is unconfirmed, the pill shows the cached label with a "syncing" indicator; on transport failure it shows "Offline · retrying" and never a success or failure tone.

Reviver mapping: idle pill shows "Queue · *n*" (Pro/eligible) or "Reviver setup" / "Pro expired" with the matching sheet. When the reviver holds a transaction, the reviver-side state takes priority over the queue count (when it holds several, the one with the nearest deadline drives the pill): awaiting payment (`WAITING_FOR_PAYMENT`), paid → revive now (`WAITING_FOR_REVIVE`), retry requested → Accept or decline (`RETRY_OFFERED`), refund owed (`REFUND_REQUIRED`/`REFUND_RECONCILING`).

The full mapping lives in one table-driven module (`ui/pill-state.js`) with a unit test covering every state × role × freshness combination.

### Expanded sheet

Clicking the pill opens a sheet anchored to it:

- **Desktop:** a 360 px popover under the pill, one level of elevation, closes on outside click or Esc.
- **TornPDA / coarse pointer:** a bottom sheet, full width, 44 px minimum touch targets, drag-down or close button to dismiss. No floating draggable windows.

Sheet sections are built on first open (lazy), then kept and patched.

### Reviver queue

Inside the sheet for eligible revivers:

- rows sorted by hospital time remaining (server-provided), then request age;
- each row: player name, abroad marker, hospital-time bar with text, offered payment (`offerAmount`), and one **Revive** button that opens the player's Torn profile in the same tab (the reviver revives manually);
- accepting is a separate explicit click on "Accept" before revive; the server's atomic acceptance stays authoritative and the row shows "Taken by another reviver" if it lost the race;
- new-request highlight for 3 s; no layout jump (rows are keyed and patched in place).

### Inline badges

Small, opt-out badges inside Torn pages, never altering Torn's own controls:

- **Hospital list:** an "RR" badge next to players with an active certified request (data from the shared queue state; no extra requests).
- **Profile page:** "RR verified requester/reviver" chip when the server says so for that player (fetched only when that profile page is visible, cached for 10 minutes).

Badges are inserted once per node and marked with `data-rr-badge` so re-renders never duplicate them.

### Notifications

- Requester: accepted, payment verified, revived, failed, refund resolved.
- Reviver: new request (opt-in, rate-limited), payment received, refund owed.
- Delivered once per event id across all tabs (single-actor invariant), via `GM_notification`; tab title badge as fallback on PDA.
- Sound is on by default only for events that need the player to act or confirm an outcome: requester (accepted · time to pay, revived, refund resolved) and reviver (payment received · revive now, refund owed). New-queue-request notifications are silent by default. One short, soft bundled sound; one toggle turns all sound off.
- Quiet hours and per-type toggles in settings.

### Settings and Pro

Settings, verification, Pro status, plans and invoices move into sheet tabs that are created only when opened. Invoice flow is unchanged server-side; visually it reuses the pill/sheet components (e.g. "Pay R4G3RUNN3R 10,000,000 · 23:41:05 left").

### Visual system

- **Tokens:** CSS custom properties inside the shadow root: surfaces, text, border, one accent (ReviveRelay red `#a4161a`, kept from 0.7.x), and status tones (waiting amber, action purple, success green, attention orange). Red is the brand only: error and "needs attention" states use orange plus an alert icon, so red never doubles as a danger signal. Dark-mode accent is a lightened red tuned for contrast on Torn's dark surfaces. Light and dark sets follow Torn's active theme (detected from Torn's body class, falling back to `prefers-color-scheme`).
- **Type:** inherit Torn's font family and base size; two weights only.
- **Icons:** a bundled set of about 16 inline SVG icons (heartbeat, clock, plane, user-check, check, alert, refund, settings, close, chevron, bell, bolt, shield, cash, pill, external), 16/20 px, `currentColor`.
- **Motion:** 120–250 ms opacity/transform transitions only; progress rings animate with CSS; everything respects `prefers-reduced-motion`.
- **Density:** desktop rows 36 px; PDA rows 48 px.

## Engine architecture

### Source layout and build

1.0 is authored as small modules and bundled by the existing `scripts/build.js` into one userscript (no runtime module loading):

```
src/
  core/        boot.js, scheduler.js, tab-leader.js, store.js, api.js, cache.js, torn-page.js
  ui/          root.js (shadow DOM), pill.js, pill-state.js, sheet.js, icons.js, tokens.css
  features/    requester.js, reviver-queue.js, badges.js, notifications.js, settings.js, pro.js
```

The existing flat `src/*.js` modules (e.g. `direct-api-client.js`, `pro-client.js`, `platform.js`) are reused or moved into this structure during planning; nothing is rewritten that already meets the invariants.

`core` and `ui/pill*` run at boot. `features/*` export `mount()/unmount()` and are initialised only when their trigger occurs (sheet opened, role eligible, page matches).

### Boot sequence

1. `document-idle`: read cached snapshot from GM storage (synchronous-feeling, < 5 ms).
2. Mount shadow root and pill from the snapshot (marked stale).
3. Join tab leadership; leader fetches `/v1/state`, followers wait for the broadcast.
4. Defer badges and non-visible work to `requestIdleCallback` (timeout 2 s, with a `setTimeout` fallback for PDA).

### One scheduler

All recurring work goes through `core/scheduler.js`, one timer per tab, replacing all nine intervals. Each job declares its cadence by context:

| Context | Leader poll of `/v1/state` | Clock/UI tick | Notes |
| --- | --- | --- | --- |
| Tab hidden | none (leader hands off) | none | zero work |
| Visible, idle (no request, not a reviver) | 60 s | none | |
| Visible, requester has active request | 5 s | 1 s (only while sheet or timer visible) | |
| Visible, reviver with sheet open | 5 s | 1 s | |
| Visible, reviver, sheet closed | 20 s | none | pill count only |
| Server sent `nextPollMs` | honour it (bounded 3–120 s) | | lets the server slow everyone down |
| Transport failure | exponential back-off 5 → 120 s with jitter | | |

The server can always shorten or lengthen the next poll, so cadence can be tuned without a client release.

### Tab leadership

- Use the Web Locks API (`navigator.locks.request('rr-leader', ...)`) where available; otherwise a `BroadcastChannel` heartbeat election with GM storage tie-break.
- Only the leader polls and fires notifications; it broadcasts each new state snapshot on `BroadcastChannel('rr-state')` and writes it to the GM cache.
- Leadership moves to a visible tab when the leader is hidden; if no tab is visible, nobody polls.
- TornPDA runs a single WebView, so it is always leader; the code path is identical.

### Aggregated state endpoint

New server endpoint: `GET /v1/state` (review: `/review/v1/state`), authenticated as today, returning in one response:

- `me`: `{ tornId, name, roles, verification }`, where `verification` is `{ usable, requester, reviver }` or `null` when the user has no stored credential,
- `pro` status (resolved, so the owner reads `OWNER`),
- `activeRequest`: the user's own open request `{ id, state, paymentMethod, offerAmount, createdAt, transactionId }` or `null`,
- `activeTransactions`: **every** open transaction the user is part of (as requester or reviver), each in the existing `GET /v1/transactions/:id` shape with `participantRole`, sorted by nearest upcoming deadline (payment, revive, retry-response or refund; none last). Empty array when none. A user can be requester in one and reviver in others at the same time,
- `queue`: `{ count }` (exact) only for revivers with queue access (free mode, or Pro state TRIAL/ACTIVE/OWNER); otherwise `null`. Rows stay behind the existing gated `GET /v1/reviver/queue`, which the client calls only while the queue sheet is open,
- `revivers.online` count (an aggregate only; no identities; `null` if unavailable),
- `nextPollMs`: 5000 with an active request or any open transaction, 20000 for revivers, 60000 otherwise,
- `stateVersion` (16 hex chars) with `ETag` and `Cache-Control: no-store`; a matching `If-None-Match` (weak `W/` and comma-separated lists accepted) returns `304` with no body.

Rate limits: 30 requests/minute per verified session (checked after authentication) plus a 120/minute per-IP ceiling (checked before authentication). The badge endpoint uses 60/minute per session and the same per-IP ceiling.

Existing endpoints stay for compatibility and for actions (`POST /v1/requests`, accept, cancel, check-payment, etc.).

Live push is deliberately not in 1.0. 1.0 ships with the adaptive polling above; after the review alpha measures real latency and request volume, a 1.1 may add Server-Sent Events, with polling kept as the fallback for userscript managers or TornPDA builds that cannot stream.

### Rendering

- One shadow root per page holds all ReviveRelay UI, so Torn and TornTools styles cannot leak in or out.
- A tiny store (`core/store.js`) holds the snapshot; components subscribe to slices and patch only changed text, attributes and keyed rows.
- No `innerHTML` with server or player data; text goes through `textContent`, structure through templates cloned once. This also removes an XSS class.
- Torn SPA navigation is detected with one `MutationObserver` on Torn's main content container (not `document.body`) plus `popstate`/`hashchange`, disconnected while dormant.

### Caching

- GM storage key `rr:snapshot:v1` holds `{stateVersion, fetchedAt, data}`; entries older than 10 minutes render as stale, older than 24 hours are discarded.
- Profile badge lookups are cached per player for 10 minutes in memory and in GM storage (bounded at 200 entries, LRU).
- Cache never overrides a newer `stateVersion`.

### Performance budgets (acceptance gates)

| Budget | Target |
| --- | --- |
| Bundled userscript | ≤ 110 KB unminified |
| Boot to pill painted from cache | ≤ 50 ms desktop, ≤ 150 ms mid-range Android in TornPDA |
| Main-thread long tasks from ReviveRelay | none > 50 ms |
| Hidden tab | 0 network requests, 0 timers firing |
| Visible idle tab | ≤ 1 request per minute per browser profile |
| Active request | ≤ 12 requests per minute per browser profile (not per tab) |
| Collapsed UI DOM | ≤ 30 nodes |
| Duplicate notifications across tabs | 0 |

## Server changes

1. `GET /v1/state` aggregated endpoint with ETag/304 and `nextPollMs` (plus review-channel mount).
2. `revivers.online` aggregate: revivers with an authenticated request in the last 5 minutes, eligible and entitled. Count only; the client hides the number when it is 0.
3. Queue rows add `hospitalUntil` (absolute timestamp; the client corrects for clock skew using the response `Date` header) and `abroad`. A **separate process**, `server/src/request-status-worker.js` (`npm run status-worker`), reads each waiting requester's Torn profile status with the requester's existing verification credential (the requester key already includes `profile`, as disclosed in `TORN-API-DISCLOSURE.md`), at most once per minute per waiting request, with a 5-second timeout per call and a 15-second batch budget. It does not use the shared `jobs` table, so an older worker on the same database cannot interfere. Only the derived hospital-until time and abroad flag are stored. Values are returned as `null` (unknown) once the last successful read is more than 3 minutes old; they are never guessed. Abroad is recognised from Torn's "In a/an <Country> hospital…" status text; anything else is `null` (to be confirmed against a live profile).
4. Profile verification lookup `GET /v1/players/:tornId/badge` returning only `{tornId, requesterVerified, reviverVerified}`; rate-limited; `Cache-Control: private, max-age=600`.
5. One additive migration, `008_lite_state.sql` (`lock_timeout` 5 s): `sessions.last_seen_at` (written at most once a minute on authentication; a failed write is logged, never blocks login), and `revive_requests.hospital_until`, `abroad`, `status_checked_at`, `status_refreshed_at`. See `docs/superpowers/plans/2026-11-25-reviverelay-1.0-server-state.md` and PR #17.

## Torn policy and review

- Every action that affects the game stays a manual player action on Torn's own page. ReviveRelay opens profiles; it never clicks, submits or pays.
- The Torn API usage stays read-only and within the scopes already disclosed in `TORN-API-DISCLOSURE.md`; badges and counts use ReviveRelay's server data, not new Torn API calls from the client.
- 1.0 changes visible behaviour substantially, so it ships first on the private review channel and is presented to Torn staff with an updated staff summary, API inventory and screenshots before any stable promotion. Ask staff early whether the header pill placement and inline hospital badges are acceptable.

## Rollout and migration

1. Build 1.0 on a new branch alongside 0.7.x; reuse the API client, verification and payment logic where they already meet the invariants.
2. Ship `GET /v1/state` to the review server first; 0.7.x keeps working because existing endpoints are unchanged.
3. Internal alpha (owner + a few testers) on the review channel, measuring the performance budgets with a debug overlay.
4. Torn staff review of 1.0 on the review channel.
5. Promote 1.0 to review users, raise `minimumVersion` only after a two-week overlap; 0.7.3 remains the rollback.
6. Stable channel promotion only after approval, per the existing promotion policy.

Settings migrate from 0.7.x GM keys on first boot; the API key binding and verification credential are untouched.

## Testing and acceptance

- **Unit:** `pill-state` mapping for every transaction state × role × freshness; scheduler cadence table; leader election hand-off; cache staleness rules; store patching emits no change when the snapshot is unchanged.
- **Lifecycle:** start/stop idempotence across Torn SPA navigation and remounts; no duplicated timers, observers, listeners or notifications (extends the dormancy tests).
- **Multi-tab:** with three tabs open, exactly one polls and one notifies; closing or hiding the leader hands over within 5 s.
- **Performance:** an automated harness counts requests per minute and timers per tab in each context and fails the build when a budget is exceeded.
- **Visual:** screenshots of every pill state and sheet in Torn light and dark, desktop and PDA width, reviewed by the owner.
- **Real TornPDA:** the existing real-device acceptance list, plus bottom sheet, touch targets and notification fallback.
- **Server:** `/v1/state` contract tests, ETag/304 behaviour, `nextPollMs` bounds, privacy of `revivers.online`.

## Decisions (owner, 2026-11-25)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Live push | Adaptive polling in 1.0. Consider Server-Sent Events in 1.1 after measuring; polling stays as fallback. (`EventSource` cannot send the bearer token, and `GM_xmlhttpRequest` streaming differs across Tampermonkey, Violentmonkey and TornPDA.) |
| 2 | Pill on TornPDA | Torn's header on all platforms; fall back to the 0.7.3 PDA launcher position when the header slot is missing or too narrow. |
| 3 | Revivers online | Eligible, entitled revivers seen in the last 5 minutes; hide the number at 0 and say "Revivers are notified". |
| 4 | Accent colour | Keep ReviveRelay red `#a4161a`. Error/attention states move to orange plus an alert icon so red is brand-only. |
| 5 | Sound | On by default for key action/outcome events only; new queue requests silent; one toggle for all sound. |
| 6 | Hospital time and abroad | Server reads the requester's profile status with their existing credential (Profile scope already disclosed), at most once per minute per active request. |

Decisions taken while building the server (owner, 2026-11-25):

| # | Question | Decision |
| --- | --- | --- |
| 7 | Presence write failures | Never block login; log a warning at most once a minute. |
| 8 | Queue count | Exact `COUNT` query, shown only to revivers with queue access. |
| 9 | Several open revives | Return all of them (`activeTransactions`), nearest deadline first. |
| 10 | Status refresh process | Own small process, not the shared job queue. |
| 11 | Failed status reads | Unknown once the last success is over 3 minutes old. |
| 12 | Key status | Included in `me.verification`. |
| 13 | Polling rate limits | Per verified session after authentication, plus a per-IP ceiling. |
| 14 | Size budget with the staged 1.0 | 1.0 keeps the existing panel for rare screens, so the whole file cannot meet 110 KB: the light core (bundle minus the old panel) must stay ≤ 110 KB and the whole 1.0 file ≤ 232 KB, both enforced by tests. 1.1, which replaces the old panel with new sheets, must bring the whole file to ≤ 110 KB. Plan 3b (2026-11-26, owner): the limits stay as they are; new sheets, badges, notifications and sound fit by trimming older code out of the Lite core (e.g. slimming or dropping telemetry and the update manager from the Lite path), never by raising a gate. |
| 15 | 1.0 scope | Staged, core first: new engine, header pill and new sheets for everyday flows in 1.0; key setup, Pro invoices, settings and account deletion stay in the existing panel opened from the pill, redesigned in 1.1. |

No open questions remain for the design.

## Future work (not 1.0)

- Faction/war mode: revive requests on behalf of faction members, inspired by WarRevive and faction contracts.
- Abroad-specific pricing and reviver availability by location.
- Reviver performance stats for Pro (success rate, earnings), rendered in the same sheet.

## Definition of done

1.0 is done when every performance budget passes in the automated harness and on a real TornPDA device, every pill state has an approved screenshot in both themes and both layouts, all carried-forward invariants and the single-actor invariant have passing tests, Torn staff have reviewed the 1.0 review build, and 0.7.3 remains available as a tested rollback.
