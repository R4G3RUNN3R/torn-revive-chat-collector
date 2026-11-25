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
    onActivate = () => {}
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

    function isHidden() {
      return document.visibilityState === 'hidden' || document.hidden === true;
    }

    function isLeader() {
      return Boolean(leader && leader.isLeader());
    }

    function render() {
      if (!view) return;
      lastView = PillState.derivePill(current.snapshot, current.freshness, now());
      view.update(lastView);
    }

    function needsTick() {
      return Boolean(sheetOpen || (lastView && (lastView.timer || lastView.refreshAt !== null)));
    }

    function pollDelay() {
      if (!isLeader()) return null;
      const snapshot = current.snapshot || {};
      return Scheduler.pollDelayMs({
        hidden: isHidden(),
        nextPollMs: snapshot.nextPollMs,
        hasActive: Boolean(snapshot.activeRequest || (Array.isArray(snapshot.activeTransactions) && snapshot.activeTransactions.length)),
        isReviver: Boolean(snapshot.me && Array.isArray(snapshot.me.roles) && snapshot.me.roles.includes('reviver')),
        sheetOpen
      });
    }

    function apply(snapshot, freshness, fetchedAt) {
      current = { snapshot, freshness };
      if (snapshot && fetchedAt !== null) cache.write(snapshot, fetchedAt);
      if (isLeader()) leader.broadcast({ snapshot, freshness, fetchedAt });
      render();
      if (scheduler) scheduler.reschedule('tick');
    }

    async function poll() {
      if (!isLeader()) return;
      const runEpoch = epoch;
      let result;
      try {
        result = await api.getState();
      } catch (error) {
        if (started && runEpoch === epoch) apply(current.snapshot, 'offline', null);
        throw error;
      }
      if (!started || runEpoch !== epoch) return;
      const snapshot = result && result.notModified ? current.snapshot : result && result.snapshot;
      if (!snapshot) return;
      apply(snapshot, 'live', now());
    }

    function onLeaderChange(nowLeader) {
      if (!scheduler) return;
      if (nowLeader) scheduler.trigger('poll');
      else scheduler.reschedule('poll');
    }

    function onBroadcast(payload) {
      if (!started || isLeader() || !payload || typeof payload !== 'object') return;
      const freshness = PillState.FRESHNESS.includes(payload.freshness) ? payload.freshness : 'syncing';
      current = { snapshot: payload.snapshot || current.snapshot, freshness };
      render();
      if (scheduler) scheduler.reschedule('tick');
    }

    function onVisibilityChange() {
      if (!started) return;
      leader.onVisibilityChange();
      scheduler.onVisibilityChange();
      if (!isHidden()) render();
    }

    function start() {
      if (started) return;
      started = true;
      epoch += 1;
      const cached = cache.read();
      current = { snapshot: cached ? cached.snapshot : null, freshness: 'syncing' };
      view = PillView.mountPill({ document, window, onActivate, headerSelectors });
      render();
      scheduler = Scheduler.createScheduler({ setTimeout: setTimer, clearTimeout: clearTimer, now, random, isHidden });
      scheduler.addJob('poll', { delay: pollDelay, run: poll });
      scheduler.addJob('tick', { delay: () => (needsTick() ? Scheduler.CADENCE_MS.TICK : null), run: () => render() });
      leader = TabLeader.createTabLeader({
        tabId,
        locks,
        createChannel,
        createAbortController: AbortControllerCtor ? () => new AbortControllerCtor() : null,
        isHidden,
        setTimeout: setTimer,
        clearTimeout: clearTimer,
        onChange: onLeaderChange,
        onSnapshot: onBroadcast
      });
      document.addEventListener('visibilitychange', onVisibilityChange);
      scheduler.start();
      leader.start();
    }

    function stop() {
      if (!started) return;
      started = false;
      epoch += 1;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      leader.stop();
      scheduler.clear();
      view.destroy();
      leader = null;
      scheduler = null;
      view = null;
      lastView = null;
    }

    function setSheetOpen(open) {
      sheetOpen = Boolean(open);
      if (!scheduler) return;
      scheduler.reschedule('poll');
      scheduler.reschedule('tick');
    }

    function refresh() {
      if (scheduler && isLeader()) scheduler.trigger('poll');
    }

    return Object.freeze({
      start,
      stop,
      setSheetOpen,
      refresh,
      isStarted: () => started,
      isLeader,
      viewModel: () => lastView
    });
  }

  return Object.freeze({ createLiteEngine });
});
