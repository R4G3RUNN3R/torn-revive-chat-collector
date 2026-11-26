# ReviveRelay Lite engine notes

Rationale comments moved out of the Lite-core sources in Plan 3b (owner decision 2026-11-26: the
110 KB Lite core budget is met by trimming, never by raising the gate; bundled modules stay
byte-identical to their sources, so comments cost bundle bytes). Each note names the code line it
described, as that line now reads.

## src/platform.js

- `const isTornPda = hasPdaReadyPromise || hasFlutterBridge || (hasPdaStorage && hasPdaHttp);`: The PDA ready promise appears before the native bridge on a cold WebView.
- `async function moveToPda(values) {`: Copy values into PDA storage, then reset their GM copies to the legacy defaults.

## src/lite/boot.js

- `const RELAYOUT_DELAYS_MS = Object.freeze([150, 1000, 3000]);`: After a start or a Torn SPA navigation the sidebar renders late: re-place the dock a few times.
- `getSession = null,`: () => { signedIn, tornId }. MUST read shared platform.storage on every call, never tab memory.
- `const tabId = `rr-${now().toString(36)}-${random().toString(36).slice(2, 10)}`;`: One id per page load, kept across BFCache restarts.
- `if (!event || event.persisted !== true) return;`: Only a BFCache restore needs a restart; a normal load already started.

## src/lite/engine.js

- `getSession = null,`: () => ({ signedIn, tornId }); omitted: signed in, identity unknown.
- `onRender = null`: Called after every render with { view, snapshot, freshness }.
- `let refreshSoon = false;`: a follower asked for a refresh
- `let deferredPollAt = null;`: first poll waits for a young cache
- `let authExpired = false;`: no polling until resetSession() or a restart
- `let knownSession = null;`: a different session seen later restarts the engine
- `let sessionSince = null;`: expiries of requests sent before this are about the old session
- `let gatedChannel = null;`: passive state listener while gated
- `function statePayload(snapshot, freshness, fetchedAt, extra = {}) {`: Broadcasts name their session so other users' tabs can ignore them.
- `function listenWhileGated() {`: A gated tab still hears the leader, to notice a sign-in made elsewhere.
- `try { gatedChannel.postMessage({ type: 'state-request', from: `${tabId}:gated` }); } catch (_) { }`: closed
- `} catch (_) { }`: already closed
- `function leaderSessionCheck() {`: A leader whose session changed resets; a gated one steps out. True when it acted.
- `function syncLeadership() {`: Gated tabs never hold leadership.
- `const firstSeen = new Map();`: Per tab, not broadcast: each tab shows an outcome 5 s from its own first sight.
- `if (!view.host.isConnected) view.place();`: Torn removed the dock without navigating
- `try { onRender({ view: lastView, snapshot: current.snapshot, freshness: current.freshness }); } catc`: listener errors stay with the caller
- `function followerStaleAfter() {`: A follower's "live" goes stale 2 × the leader's cadence (sheet speed-up ignored) after its last fetch.
- `function freshnessDelay(ctx) {`: Handled by the 1 s tick while it runs; otherwise a one-shot job.
- `function youngDataPollAt(fetchedAt) {`: Data younger than the cadence defers a poll to fetchedAt + cadence, at least the minimum away.
- `resetApi();`: A 304 for a version we are not showing: drop the ETag and refetch soon.
- `if (nowLeader && deferredPollAt === null) deferredPollAt = youngDataPollAt(lastFetchedAt);`: A fresh load honours a young cache, a hand-off the last fetch; older data polls at once.
- `function onStateRequest() {`: Answer a joining follower, even without a snapshot.
- `const sender = Number(payload.tornId);`: Never paint another Torn user's state.
- `deferredPollAt = null;`: a later hand-off defers from this fetchedAt
- `render();`: after setup: onRender may stop() or resetSession()
- `function refresh() {`: Followers ask the leader; gated and hidden tabs ask nothing.
- `function resetSession(fromBroadcast = false) {`: Forget everything tied to the old session (a new session's cache entry stays).

## src/lite/icons.js

- `const ICON_PATHS = Object.freeze({`: Static, trusted path data (24 × 24 grid, 2 px round strokes, currentColor).
- `function iconMarkup(name, size = 16) {`: Static SVG string for a bundled icon. Only ever built from ICON_PATHS, never from data.
- `function createIcon(document, name, size = 16) {`: Builds the same icon as DOM nodes; no HTML string is ever parsed.

## src/lite/pill-state.js

- `const SESSION_STATES = Object.freeze(['signed-out', 'expired']);`: Session states replace the snapshot entirely: nothing cached is ever painted under them.
- `const OUTCOME_WINDOW_MS = 30000;`: server recentlyClosed window for outcomes
- `function completedFade(transaction, now, seen) {`: Shown 5 s from first sight (unseen: now), never past the 30 s window or with closedAt over 5 s ahead.
- `function unknownCount(value) {`: Only finite numbers or numeric strings count; anything else is unknown, never 0.
- `function firstClosed(transactions, role, now, seen, skipReportable) {`: Newest first; only outcomes that still map drive the pill, unknown states are skipped.
- `const known = TRANSACTION_STATES.includes(request.state);`: An open request in a state this client does not know is "Updating", never idle "Revive me".
- `const outcome = firstClosed(closed, 'requester', now, seen) || firstClosed(closed, 'reviver', now, s`: A reviver's reportable ranks below a visible queue count.
- `function serverNow(snapshot, now) {`: clockSkewMs (set by the engine) counts only as a finite number within ±24 h.
- `function derivePill(snapshot, freshness, now, firstSeen) {`: firstSeen(transactionId): client ms this tab first showed that outcome, or undefined.

## src/lite/pill-view.js

- `const HOST_ID = 'reviverelay-lite-root';`: 1.0.2 dock: one fixed "ReviveRelay" row in Torn's left sidebar, or a floating "RR" launcher on TornPDA, narrow touch screens or pages without a sidebar. It never shows status; the panel's status line does (MAIN `renderStateLine`). Never placed in Torn's header.
- `const SIDEBAR_SELECTORS = Object.freeze([`: 0.7.3's `src/sidebar-action.js` NAV_SELECTORS, in order; the first match wins. Overridable for tests and future Torn markup.
- `target.insertBefore(host, native[1] || native[0] || null);`: 0.7.3's slot: second from the top of the sidebar.
- `return mediaMatches(window, '(pointer: coarse)') && Number(window.innerWidth) <= 900;`: 0.7.3's recovery-launcher rule for touch screens.
- `function observe(sidebar) {`: Torn re-renders its sidebar: watch the sidebar and its parent (childList only) and re-place on the mutation batch. No timer; 0.7.3's 5 s setInterval is not needed because the engine also re-places on every render and boot on every navigation. place() is a no-op while the row is in place, so its own insert cannot loop.
- `function onWindowClick(event) {`: As 0.7.3: a capture-phase window listener sees the click before Torn's sidebar handlers can; it stops propagation, so the button's own listener does not run twice.
- `try { onActivate(); } catch (_) { }`: activation errors stay with the caller

## src/lite/scheduler.js

- `function pollDelayMs({ hidden = false, nextPollMs = null, hasActive = false, isReviver = false, shee`: Leader poll cadence for one context (spec "One scheduler" table).
- `if (isReviver && sheetOpen && !hasActive && server <= CADENCE_MS.REVIVER) return Math.min(server, CA`: The server may always slow polling; an open reviver sheet keeps 5 s unless it asks for > 20 s.
- `function nextDueAt(job) {`: A trigger that arrived while the job was running makes it due now, once visible.

## src/lite/snapshot-cache.js

- `try { storage.set(key, null); } catch (_) { }`: storage unavailable: nothing to clear

## src/lite/tab-leader.js

- `const STAGGER_MS = 200;`: Staggered promotion (electionMs + hash(id) % STAGGER_MS); crash hand-off stays under 5 s.
- `let pending = null;`: Web Locks mode
- `let knownLeader = null;`: Heartbeat mode
- `try { onChange(value); } catch (_) { }`: listener errors never break election
- `try { channel.postMessage({ ...message, from: id }); } catch (_) { }`: channel closed
- `} catch (_) { }`: already closed
- `function onStateMessage(event) {`: rr-state: 'state' from the leader; 'state-request' / 'refresh-request' for the leader.
- `try { listener(); } catch (_) { }`: listener errors stay local
- `try { onSnapshot(message.payload); } catch (_) { }`: renderer errors stay local
- `try { controller.abort(); } catch (_) { }`: already settled
- `function onCandidateHello(from) {`: A lower-id candidate gets time to promote first; a higher-id one is answered once so it yields.
- `startElection();`: the hidden leader never answered
- `function trackLeader(from, hidden) {`: A hidden leader never polls: a visible tab claims from it instead of sitting unled.
- `post(stateChannel, { type: 'state-request' });`: ask any leader for its state now
- `function requestRefresh() {`: Ask the leader to poll soon (e.g. after this tab created a request).
