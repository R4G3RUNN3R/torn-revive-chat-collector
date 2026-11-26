(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const dependency = (globalName, path) => globalThis[globalName] || require(path);

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
    onActivate = () => {},
    getSession = null,
    onRender = null,
    onLiveSnapshot = null
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
    let refreshSoon = false;
    let jobsAddedAt = 0;
    let deferredPollAt = null;
    let authExpired = false;
    let knownSession = null;
    let sessionSince = null;
    let gatedChannel = null;

    function session() {
      if (typeof getSession !== 'function') return { signedIn: true, tornId: null };
      let value = null;
      try { value = getSession(); } catch (_) { value = null; }
      const tornId = value && Number.isSafeInteger(Number(value.tornId)) && Number(value.tornId) > 0 ? Number(value.tornId) : null;
      return { signedIn: Boolean(value && value.signedIn), tornId };
    }

    function sessionGate() {
      if (!session().signedIn) return 'signed-out';
      return authExpired ? 'expired' : null;
    }

    function ownedBySession(snapshot) {
      const expected = session().tornId;
      if (expected === null || !snapshot || typeof snapshot !== 'object') return true;
      const owner = snapshot.me && Number(snapshot.me.tornId);
      return owner === expected;
    }

    function resetApi(badgesToo) {
      if (typeof api.reset === 'function') api.reset();
      if (badgesToo && typeof api.clearBadges === 'function') api.clearBadges();
    }

    function expire() {
      authExpired = true;
      deferredPollAt = null;
      cache.clear();
      resetApi(true);
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

    function statePayload(snapshot, freshness, fetchedAt, extra = {}) {
      const owner = snapshot && snapshot.me ? Number(snapshot.me.tornId) : NaN;
      const tornId = Number.isSafeInteger(owner) && owner > 0 ? owner : (knownSession ? knownSession.tornId : null);
      return { snapshot, freshness, fetchedAt, tornId, ...extra };
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
        onStateRequest,
        onRefreshRequest
      });
      leader.start();
    }

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

    function listenWhileGated() {
      if (gatedChannel || !started || typeof createChannel !== 'function') return;
      try {
        gatedChannel = createChannel(TabLeader.STATE_CHANNEL);
      } catch (_) {
        gatedChannel = null;
      }
      if (!gatedChannel) return;
      gatedChannel.addEventListener('message', onGatedMessage);
      try { gatedChannel.postMessage({ type: 'state-request', from: `${tabId}:gated` }); } catch (_) { }
    }

    function stopListening() {
      if (!gatedChannel) return;
      const channel = gatedChannel;
      gatedChannel = null;
      try {
        channel.removeEventListener('message', onGatedMessage);
        channel.close();
      } catch (_) { }
    }

    function leaderSessionCheck() {
      if (sessionChanged()) {
        resetSession();
        return true;
      }
      if (sessionGate()) {
        syncLeadership();
        return true;
      }
      return false;
    }

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

    const firstSeen = new Map();

    function render() {
      if (!view) return;
      const at = now();
      for (const [id, seenAt] of firstSeen) if (at - seenAt > PillState.OUTCOME_WINDOW_MS + PillState.COMPLETED_FADE_MS) firstSeen.delete(id);
      lastView = PillState.derivePill(current.snapshot, current.freshness, at, id => firstSeen.get(id));
      const id = lastView.transactionId;
      if (lastView.refreshAt !== null && id && !firstSeen.has(id) && !isHidden()) firstSeen.set(id, at);
      if (!view.host.isConnected) view.place();
      if (typeof onRender === 'function') {
        try { onRender({ view: lastView, snapshot: current.snapshot, freshness: current.freshness }); } catch (_) { }
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
      if (scheduler) scheduler.reschedule('freshness');
    }

    function rescheduleLocal() {
      if (!scheduler) return;
      scheduler.reschedule('tick');
      scheduler.reschedule('freshness');
    }

    function pollDelay(ctx) {
      if (!isLeader()) return null;
      if ((resyncSoon || refreshSoon) && !isHidden()) return Scheduler.POLL_BOUNDS_MS.min;
      if (deferredPollAt !== null && !isHidden()) return deferredPollAt - (ctx.lastRunAt === null ? jobsAddedAt : ctx.lastRunAt);
      return cadenceMs(isHidden());
    }

    function youngDataPollAt(fetchedAt) {
      const cadence = cadenceMs(false);
      const age = now() - fetchedAt;
      return fetchedAt !== null && cadence !== null && age >= 0 && age < cadence ? Math.max(fetchedAt + cadence, now() + Scheduler.POLL_BOUNDS_MS.min) : null;
    }

    function stillCurrent(runEpoch) {
      return started && runEpoch === epoch && isLeader();
    }

    function apply(snapshot, freshness, fetchedAt, extra) {
      current = { snapshot, freshness };
      if (freshness === 'live' && fetchedAt !== null) lastFetchedAt = fetchedAt;
      if (snapshot && fetchedAt !== null) cache.write(snapshot, fetchedAt);
      if (isLeader()) leader.broadcast(statePayload(snapshot, freshness, fetchedAt, extra));
      if (freshness === 'live' && snapshot && isLeader() && typeof onLiveSnapshot === 'function') {
        try { onLiveSnapshot(snapshot); } catch (_) {}
      }
      render();
      rescheduleLocal();
    }

    async function poll() {
      if (!started || !isLeader()) return;
      if (leaderSessionCheck()) return;
      deferredPollAt = null;
      refreshSoon = false;
      const runEpoch = epoch;
      const requestedAt = now();
      let result;
      try {
        result = await api.getState();
      } catch (error) {
        if (!stillCurrent(runEpoch)) return;
        if (isAuthError(error)) {
          expire();
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
          resetApi();
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
      if (!nowLeader) {
        epoch += 1;
        deferredPollAt = null;
      }
      if (!scheduler) return;
      if (nowLeader && deferredPollAt === null && current.freshness === 'live') deferredPollAt = youngDataPollAt(lastFetchedAt);
      if (nowLeader && deferredPollAt !== null) scheduler.reschedule('poll');
      else if (nowLeader) scheduler.trigger('poll');
      else scheduler.reschedule('poll');
      scheduler.reschedule('freshness');
    }

    function onStateRequest() {
      if (!started || !isLeader()) return;
      if (leaderSessionCheck()) return;
      leader.broadcast(statePayload(current.snapshot, current.freshness, lastFetchedAt));
    }

    function onRefreshRequest() {
      if (!started || !isLeader() || !scheduler) return;
      refreshSoon = true;
      deferredPollAt = null;
      scheduler.reschedule('poll');
    }

    function onBroadcast(payload) {
      if (!started || isLeader() || !payload || typeof payload !== 'object') return;
      if (sessionChanged()) {
        resetSession(true);
        return;
      }
      const own = session();
      if (!own.signedIn) return;
      const sender = Number(payload.tornId);
      if (own.tornId !== null && Number.isSafeInteger(sender) && sender > 0 && sender !== own.tornId) return;
      if (!ownedBySession(payload.snapshot)) return;
      if (authExpired) {
        if (payload.freshness === 'live' && payload.snapshot) resetSession(true);
        return;
      }
      if (payload.freshness === 'expired') {
        if (sessionSince !== null && Number.isFinite(payload.requestedAt) && payload.requestedAt < sessionSince) return;
        expire();
        current = { snapshot: null, freshness: 'expired' };
        syncLeadership();
        render();
        rescheduleLocal();
        return;
      }
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
      if (!isHidden() && sessionChanged()) {
        resetSession();
        return;
      }
      if (leader) leader.onVisibilityChange();
      scheduler.onVisibilityChange();
      if (isHidden()) return;
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
      refreshSoon = false;
      authExpired = false;
      knownSession = session();
      const gate = sessionGate();
      let cached = gate ? null : cache.read();
      if (cached && !ownedBySession(cached.snapshot)) {
        cache.clear();
        cached = null;
      }
      current = gate ? { snapshot: null, freshness: gate } : { snapshot: cached ? cached.snapshot : null, freshness: 'syncing' };
      deferredPollAt = cached ? youngDataPollAt(cached.fetchedAt) : null;
      view = PillView.mountDock({ document, window, onActivate, pda: isTornPda });
      view.setExpanded(sheetOpen);
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
      if (view) view.setExpanded(sheetOpen);
      if (!scheduler) return;
      scheduler.reschedule('poll');
      rescheduleLocal();
    }

    function refresh() {
      if (!scheduler) return;
      if (isLeader()) scheduler.trigger('poll');
      else if (leader && !sessionGate() && !isHidden()) leader.requestRefresh();
    }

    function relayout() {
      if (!view) return;
      view.place();
      view.refreshTheme();
    }

    function resetSession(fromBroadcast = false) {
      const wasStarted = started;
      const nowSession = session();
      let keepCache = false;
      if (fromBroadcast === true && nowSession.signedIn && nowSession.tornId !== null) {
        const cached = cache.read();
        keepCache = Boolean(cached && cached.snapshot && cached.snapshot.me && Number(cached.snapshot.me.tornId) === nowSession.tornId);
      }
      stop();
      sessionSince = now();
      authExpired = false;
      current = { snapshot: null, freshness: 'syncing' };
      lastFetchedAt = null;
      if (!keepCache) cache.clear();
      resetApi(true);
      if (wasStarted) start();
    }

    return Object.freeze({
      start,
      stop,
      setSheetOpen,
      refresh,
      relayout,
      resetSession: () => resetSession(false),
      isStarted: () => started,
      isLeader,
      viewModel: () => lastView
    });
  }

  return Object.freeze({ createLiteEngine });
});
