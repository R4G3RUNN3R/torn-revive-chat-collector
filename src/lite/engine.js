(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dependency(globalName, path) {
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
    if (typeof require === 'function') return require(path);
    throw new Error(`${globalName} unavailable`);
  }

  function loadModules() {
    return {
      PillState: dependency('ReviveRelayLitePillState', './pill-state'),
      Scheduler: dependency('ReviveRelayLiteScheduler', './scheduler'),
      TabLeader: dependency('ReviveRelayLiteTabLeader', './tab-leader'),
      SnapshotCache: dependency('ReviveRelayLiteSnapshotCache', './snapshot-cache'),
      PillView: dependency('ReviveRelayLitePillView', './pill-view')
    };
  }

  function createLiteEngine({
    platform = null,
    api,
    window,
    document,
    storage,
    clock = {},
    tabId,
    headerSelectors,
    onActivate = () => {},
    // () => ({ signedIn, tornId }). Omitted: always signed in, identity unknown.
    getSession = null,
    // Called after every render with { view, snapshot, freshness } (e.g. to refresh an open panel).
    onRender = null
  } = {}) {
    if (!api || typeof api.getState !== 'function') throw new Error('api.getState is required');
    if (!document || typeof document.addEventListener !== 'function') throw new Error('document is required');
    const { PillState, Scheduler, TabLeader, SnapshotCache, PillView } = loadModules();

    const now = typeof clock.now === 'function' ? clock.now : () => Date.now();
    const setTimer = typeof clock.setTimeout === 'function' ? clock.setTimeout : (fn, ms) => globalThis.setTimeout(fn, ms);
    const clearTimer = typeof clock.clearTimeout === 'function' ? clock.clearTimeout : handle => globalThis.clearTimeout(handle);
    const random = typeof clock.random === 'function' ? clock.random : Math.random;
    const cache = SnapshotCache.createSnapshotCache({ storage, now });

    const isTornPda = Boolean(platform && platform.runtime && platform.runtime.isTornPda);
    const BroadcastChannelCtor = window && typeof window.BroadcastChannel === 'function' ? window.BroadcastChannel : null;
    const createChannel = !isTornPda && BroadcastChannelCtor ? name => new BroadcastChannelCtor(name) : null;
    const locks = window && window.navigator && window.navigator.locks ? window.navigator.locks : null;
    const AbortControllerCtor = window && typeof window.AbortController === 'function'
      ? window.AbortController
      : (typeof AbortController === 'function' ? AbortController : null);

    let started = false;
    let epoch = 0;
    let view = null;
    let scheduler = null;
    let leader = null;
    let current = { snapshot: null, freshness: 'syncing' };
    let lastView = null;
    let sheetOpen = false;
    let lastFetchedAt = null;
    let resyncSoon = false;
    let jobsAddedAt = 0;
    // Set at boot when the cached snapshot is younger than the cadence: the first poll waits for it.
    let deferredPollAt = null;
    // Set when the server rejected the session: no polling until resetSession() or a restart.
    let authExpired = false;
    // The session this run started with; a different one seen later restarts the engine.
    let knownSession = null;
    // When resetSession() last ran: an expiry of a request sent before it is about the old session.
    let sessionSince = null;
    // While gated, a passive listener on the state channel (gated tabs never lead).
    let gatedChannel = null;

    function session() {
      if (typeof getSession !== 'function') return { signedIn: true, tornId: null };
      let value = null;
      try { value = getSession(); } catch (_) { value = null; }
      const tornId = value && Number.isSafeInteger(Number(value.tornId)) && Number(value.tornId) > 0 ? Number(value.tornId) : null;
      return { signedIn: Boolean(value && value.signedIn), tornId };
    }

    // 'signed-out' or 'expired' while the session cannot poll; otherwise null.
    function sessionGate() {
      if (!session().signedIn) return 'signed-out';
      return authExpired ? 'expired' : null;
    }

    // A snapshot belongs to the signed-in Torn user, or to nobody known yet.
    function ownedBySession(snapshot) {
      const expected = session().tornId;
      if (expected === null || !snapshot || typeof snapshot !== 'object') return true;
      const owner = snapshot.me && Number(snapshot.me.tornId);
      return owner === expected;
    }

    function isAuthError(error) {
      return Boolean(error && (error.code === 'AUTH_REQUIRED' || Number(error.status) === 401));
    }

    function isHidden() {
      return document.visibilityState === 'hidden' || document.hidden === true;
    }

    function isLeader() {
      return Boolean(leader && leader.isLeader());
    }

    function sessionChanged() {
      if (!knownSession) return false;
      const value = session();
      return value.signedIn !== knownSession.signedIn || value.tornId !== knownSession.tornId;
    }

    // Every broadcast names the session it belongs to, so other users' tabs can ignore it.
    function statePayload(snapshot, freshness, fetchedAt, extra = {}) {
      return { snapshot, freshness, fetchedAt, tornId: session().tornId, ...extra };
    }

    function joinLeadership() {
      if (leader || !started) return;
      leader = TabLeader.createTabLeader({
        tabId,
        locks,
        createChannel,
        createAbortController: AbortControllerCtor ? () => new AbortControllerCtor() : null,
        isHidden,
        setTimeout: setTimer,
        clearTimeout: clearTimer,
        onChange: onLeaderChange,
        onSnapshot: onBroadcast,
        onStateRequest
      });
      leader.start();
    }

    // Releases the Web Lock / resigns, so a tab that can poll takes over.
    function leaveLeadership() {
      if (!leader) return;
      const old = leader;
      leader = null;
      old.stop();
      epoch += 1;
      deferredPollAt = null;
      if (!scheduler) return;
      scheduler.reschedule('poll');
      scheduler.reschedule('freshness');
    }

    function onGatedMessage(event) {
      const message = event && event.data;
      if (!message || typeof message !== 'object' || message.type !== 'state') return;
      if (!message.payload || typeof message.payload !== 'object') return;
      onBroadcast(message.payload);
    }

    // A gated tab still hears the leader's state so it notices a sign-in made elsewhere.
    function listenWhileGated() {
      if (gatedChannel || !started || typeof createChannel !== 'function') return;
      try {
        gatedChannel = createChannel(TabLeader.STATE_CHANNEL);
      } catch (_) {
        gatedChannel = null;
      }
      if (!gatedChannel) return;
      gatedChannel.addEventListener('message', onGatedMessage);
      try { gatedChannel.postMessage({ type: 'state-request', from: `${tabId}:gated` }); } catch (_) { /* closed */ }
    }

    function stopListening() {
      if (!gatedChannel) return;
      const channel = gatedChannel;
      gatedChannel = null;
      try {
        channel.removeEventListener('message', onGatedMessage);
        channel.close();
      } catch (_) { /* already closed */ }
    }

    // Gated tabs (signed out, or session expired) never hold leadership.
    function syncLeadership() {
      if (!started) return;
      if (sessionGate()) {
        leaveLeadership();
        listenWhileGated();
      } else {
        stopListening();
        joinLeadership();
      }
    }

    function render() {
      if (!view) return;
      lastView = PillState.derivePill(current.snapshot, current.freshness, now());
      view.update(lastView);
      if (typeof onRender === 'function') {
        try { onRender({ view: lastView, snapshot: current.snapshot, freshness: current.freshness }); } catch (_) { /* listener errors stay with the caller */ }
      }
    }

    function needsTick() {
      return Boolean(sheetOpen || (lastView && (lastView.timer || lastView.refreshAt !== null)));
    }

    function cadenceMs(hidden, sheet = sheetOpen) {
      const snapshot = current.snapshot || {};
      return Scheduler.pollDelayMs({
        hidden,
        nextPollMs: snapshot.nextPollMs,
        hasActive: Boolean(snapshot.activeRequest || (Array.isArray(snapshot.activeTransactions) && snapshot.activeTransactions.length)),
        isReviver: Boolean(snapshot.me && Array.isArray(snapshot.me.roles) && snapshot.me.roles.includes('reviver')),
        sheetOpen: sheet
      });
    }

    // A follower only knows when the leader last fetched. Past 2 × cadence without a broadcast,
    // its "live" data is no longer known to be fresh. The leader's cadence does not depend on
    // this tab's own sheet, so the open-sheet speed-up is ignored here.
    function followerStaleAfter() {
      if (isLeader() || current.freshness !== 'live' || lastFetchedAt === null) return null;
      const cadence = cadenceMs(false, false);
      return cadence === null ? null : lastFetchedAt + 2 * cadence;
    }

    function ageFollower() {
      const limit = followerStaleAfter();
      if (limit === null || now() <= limit) return false;
      current = { snapshot: current.snapshot, freshness: 'syncing' };
      return true;
    }

    // Evaluated on the 1 s tick while it runs; otherwise a one-shot job on the same scheduler.
    function freshnessDelay(ctx) {
      if (needsTick()) return null;
      const limit = followerStaleAfter();
      if (limit === null) return null;
      const base = ctx.lastRunAt === null ? jobsAddedAt : ctx.lastRunAt;
      return limit + 1 - base;
    }

    function tick() {
      ageFollower();
      render();
      // The tick may have just stopped itself; the one-shot freshness check then takes over.
      if (scheduler) scheduler.reschedule('freshness');
    }

    function rescheduleLocal() {
      if (!scheduler) return;
      scheduler.reschedule('tick');
      scheduler.reschedule('freshness');
    }

    function pollDelay() {
      if (!isLeader() || sessionGate()) return null;
      if (resyncSoon && !isHidden()) return Scheduler.POLL_BOUNDS_MS.min;
      if (deferredPollAt !== null && !isHidden()) return deferredPollAt - jobsAddedAt;
      return cadenceMs(isHidden());
    }

    // A response is only acted on while this engine session still leads the poll it started.
    function stillCurrent(runEpoch) {
      return started && runEpoch === epoch && isLeader();
    }

    function apply(snapshot, freshness, fetchedAt, extra) {
      current = { snapshot, freshness };
      if (freshness === 'live' && fetchedAt !== null) lastFetchedAt = fetchedAt;
      if (snapshot && fetchedAt !== null) cache.write(snapshot, fetchedAt);
      if (isLeader()) leader.broadcast(statePayload(snapshot, freshness, fetchedAt, extra));
      render();
      rescheduleLocal();
    }

    async function poll() {
      if (!isLeader() || sessionGate()) return;
      deferredPollAt = null;
      const runEpoch = epoch;
      const requestedAt = now();
      let result;
      try {
        result = await api.getState();
      } catch (error) {
        // A stale session or a tab that lost leadership neither renders "Offline" nor backs off.
        if (!stillCurrent(runEpoch)) return;
        if (isAuthError(error)) {
          // Expired or revoked session: show it as such, forget this user's cache, stop polling.
          authExpired = true;
          cache.clear();
          if (typeof api.reset === 'function') api.reset();
          apply(null, 'expired', null, { requestedAt });
          syncLeadership();
          return;
        }
        apply(current.snapshot, 'offline', null);
        throw error;
      }
      if (!stillCurrent(runEpoch)) return;
      resyncSoon = false;
      if (result && result.notModified) {
        const shown = current.snapshot && current.snapshot.stateVersion;
        if (!shown || result.stateVersion !== shown) {
          // The 304 confirms a version we are not showing (e.g. a broadcast replaced it):
          // drop the client's ETag and fetch a full body soon. Until then, the state is unknown.
          if (typeof api.reset === 'function') api.reset();
          resyncSoon = true;
          apply(current.snapshot, 'syncing', null);
          return;
        }
        apply(current.snapshot, 'live', requestedAt);
        return;
      }
      const snapshot = result && result.snapshot;
      if (!snapshot) return;
      const serverMs = Date.parse(snapshot.serverTime);
      if (Number.isFinite(serverMs)) snapshot.clockSkewMs = serverMs - Math.round((requestedAt + now()) / 2);
      apply(snapshot, 'live', requestedAt);
    }

    function onLeaderChange(nowLeader) {
      // Losing leadership invalidates any poll still in flight.
      if (!nowLeader) {
        epoch += 1;
        deferredPollAt = null;
      }
      if (!scheduler) return;
      // The first leadership of a fresh page load honours a young cache; a hand-off polls at once.
      if (nowLeader && deferredPollAt !== null) scheduler.reschedule('poll');
      else if (nowLeader) scheduler.trigger('poll');
      else scheduler.reschedule('poll');
      scheduler.reschedule('freshness');
    }

    // A joining follower asked for the current state: answer with what this leader shows.
    // Even without a snapshot (e.g. offline before the first success), so the joiner learns it.
    function onStateRequest() {
      if (!started || !isLeader()) return;
      leader.broadcast(statePayload(current.snapshot, current.freshness, lastFetchedAt));
    }

    function onBroadcast(payload) {
      if (!started || isLeader() || !payload || typeof payload !== 'object') return;
      // Another tab may have signed in, out or as someone else: start over with that session.
      if (sessionChanged()) {
        resetSession();
        return;
      }
      const own = session();
      if (!own.signedIn) return;
      // Never paint another Torn user's state (a tab still holding an older session).
      const sender = Number(payload.tornId);
      if (own.tornId !== null && Number.isSafeInteger(sender) && sender > 0 && sender !== own.tornId) return;
      if (!ownedBySession(payload.snapshot)) return;
      if (authExpired) {
        // Live state for this user from another tab: the shared session works again.
        if (payload.freshness === 'live' && payload.snapshot) resetSession();
        return;
      }
      if (payload.freshness === 'expired') {
        // An expiry of a request sent before this tab's re-authentication is about the old session.
        if (sessionSince !== null && Number.isFinite(payload.requestedAt) && payload.requestedAt < sessionSince) return;
        authExpired = true;
        deferredPollAt = null;
        cache.clear();
        if (typeof api.reset === 'function') api.reset();
        current = { snapshot: null, freshness: 'expired' };
        syncLeadership();
        render();
        rescheduleLocal();
        return;
      }
      // Another tab is leading, so a later hand-off to this tab must poll promptly.
      deferredPollAt = null;
      const freshness = PillState.FRESHNESS.includes(payload.freshness) ? payload.freshness : 'syncing';
      current = { snapshot: payload.snapshot || current.snapshot, freshness };
      if (freshness === 'live' && Number.isFinite(payload.fetchedAt)) lastFetchedAt = payload.fetchedAt;
      ageFollower();
      render();
      rescheduleLocal();
    }

    function onVisibilityChange() {
      if (!started) return;
      // getSession() is re-read here and on broadcasts, never on a timer.
      if (!isHidden() && sessionChanged()) {
        resetSession();
        return;
      }
      if (leader) leader.onVisibilityChange();
      scheduler.onVisibilityChange();
      if (isHidden()) return;
      // Coming back after longer than the poll cadence: what is shown may be out of date.
      const cadence = cadenceMs(false);
      if (current.freshness === 'live' && (lastFetchedAt === null || now() - lastFetchedAt > cadence)) {
        current = { snapshot: current.snapshot, freshness: 'syncing' };
      }
      render();
      rescheduleLocal();
    }

    function start() {
      if (started) return;
      started = true;
      epoch += 1;
      lastFetchedAt = null;
      resyncSoon = false;
      authExpired = false;
      knownSession = session();
      const gate = sessionGate();
      let cached = gate ? null : cache.read();
      if (cached && !ownedBySession(cached.snapshot)) {
        cache.clear();
        cached = null;
      }
      current = gate ? { snapshot: null, freshness: gate } : { snapshot: cached ? cached.snapshot : null, freshness: 'syncing' };
      // Torn navigation is mostly full page loads: a cache younger than the cadence (the last
      // successful poll in this profile) defers the first poll to fetchedAt + cadence, never
      // sooner than the scheduler's minimum.
      deferredPollAt = null;
      if (cached) {
        const cadence = cadenceMs(false);
        const age = now() - cached.fetchedAt;
        if (cadence !== null && age >= 0 && age < cadence) {
          deferredPollAt = Math.max(cached.fetchedAt + cadence, now() + Scheduler.POLL_BOUNDS_MS.min);
        }
      }
      view = PillView.mountPill({ document, window, onActivate, headerSelectors });
      scheduler = Scheduler.createScheduler({ setTimeout: setTimer, clearTimeout: clearTimer, now, random, isHidden });
      jobsAddedAt = now();
      scheduler.addJob('poll', { delay: pollDelay, run: poll });
      scheduler.addJob('tick', { delay: () => (needsTick() ? Scheduler.CADENCE_MS.TICK : null), run: tick });
      scheduler.addJob('freshness', {
        delay: freshnessDelay,
        run: () => {
          if (!ageFollower()) return;
          render();
          if (scheduler) scheduler.reschedule('tick');
        }
      });
      document.addEventListener('visibilitychange', onVisibilityChange);
      scheduler.start();
      syncLeadership();
      // First paint only after setup: an onRender listener may stop() or resetSession() here.
      render();
      rescheduleLocal();
    }

    function stop() {
      if (!started) return;
      started = false;
      epoch += 1;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopListening();
      if (leader) leader.stop();
      if (scheduler) scheduler.clear();
      if (view) view.destroy();
      leader = null;
      scheduler = null;
      view = null;
      lastView = null;
      deferredPollAt = null;
    }

    function setSheetOpen(open) {
      sheetOpen = Boolean(open);
      if (!scheduler) return;
      scheduler.reschedule('poll');
      rescheduleLocal();
    }

    function refresh() {
      if (scheduler && isLeader()) scheduler.trigger('poll');
    }

    // Torn re-renders its header on SPA navigation: re-attach the pill and re-read the theme.
    function relayout() {
      if (!view) return;
      view.place();
      view.refreshTheme();
    }

    // Sign-in, sign-out or a different Torn user: forget everything tied to the old session.
    function resetSession() {
      const wasStarted = started;
      stop();
      sessionSince = now();
      authExpired = false;
      current = { snapshot: null, freshness: 'syncing' };
      lastFetchedAt = null;
      cache.clear();
      if (typeof api.reset === 'function') api.reset();
      if (wasStarted) start();
    }

    return Object.freeze({
      start,
      stop,
      setSheetOpen,
      refresh,
      relayout,
      resetSession,
      isStarted: () => started,
      isLeader,
      viewModel: () => lastView
    });
  }

  return Object.freeze({ createLiteEngine });
});
