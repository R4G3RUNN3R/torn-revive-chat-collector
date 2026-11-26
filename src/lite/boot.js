(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteBoot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // After a start or a Torn SPA navigation the header renders late: re-place the pill a few times.
  const RELAYOUT_DELAYS_MS = Object.freeze([150, 1000, 3000]);

  function dependency(globalName, path) {
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
    if (typeof require === 'function') return require(path);
    throw new Error(`${globalName} unavailable`);
  }

  function createLiteBoot({
    platform,
    window,
    document,
    baseUrl,
    clientVersion = '',
    releaseChannel = '',
    getToken = () => '',
    // getSession is supplied by MAIN and handed to the engine unchanged. It MUST read SHARED
    // storage on every call (the persisted session token and persisted identity tornId via
    // platform.storage), never one tab's in-memory state, so a sign-in/out in one tab is seen
    // by the others. Returns { signedIn, tornId }.
    getSession = null,
    onActivate = () => {},
    onRender = null,
    clock = {},
    headerSelectors
  } = {}) {
    if (!platform || typeof platform.request !== 'function' || !platform.storage) throw new Error('platform with request and storage is required');
    if (!window || typeof window.addEventListener !== 'function') throw new Error('window is required');
    const { createStateClient } = dependency('ReviveRelayLiteStateClient', './state-client');
    const { createLiteEngine } = dependency('ReviveRelayLiteEngine', './engine');

    const now = typeof clock.now === 'function' ? clock.now : () => Date.now();
    const random = typeof clock.random === 'function' ? clock.random : Math.random;
    const setTimer = typeof clock.setTimeout === 'function' ? clock.setTimeout : (fn, ms) => globalThis.setTimeout(fn, ms);
    const clearTimer = typeof clock.clearTimeout === 'function' ? clock.clearTimeout : handle => globalThis.clearTimeout(handle);

    // One id per page load, kept across BFCache restarts so leadership logs stay readable.
    const tabId = `rr-${now().toString(36)}-${random().toString(36).slice(2, 10)}`;
    const api = createStateClient({ baseUrl, request: platform.request, getToken, clientVersion, releaseChannel });
    const engine = createLiteEngine({
      platform,
      api,
      window,
      document,
      storage: platform.storage,
      clock,
      tabId,
      headerSelectors,
      onActivate,
      getSession,
      onRender
    });

    let started = false;
    const relayoutTimers = new Set();

    function clearRelayout() {
      for (const handle of relayoutTimers) clearTimer(handle);
      relayoutTimers.clear();
    }

    function scheduleRelayout() {
      clearRelayout();
      for (const delay of RELAYOUT_DELAYS_MS) {
        const handle = setTimer(() => {
          relayoutTimers.delete(handle);
          engine.relayout();
        }, delay);
        relayoutTimers.add(handle);
      }
    }

    function onPageHide() {
      clearRelayout();
      engine.stop();
    }

    function onPageShow(event) {
      // Only a BFCache restore needs a restart; a normal load already started.
      if (!event || event.persisted !== true) return;
      engine.stop();
      engine.start();
      scheduleRelayout();
    }

    const WINDOW_EVENTS = Object.freeze([
      ['pagehide', onPageHide],
      ['pageshow', onPageShow],
      ['popstate', scheduleRelayout],
      ['hashchange', scheduleRelayout],
      ['flutterInAppWebViewPlatformReady', scheduleRelayout]
    ]);

    function start() {
      if (started) return;
      started = true;
      for (const [type, listener] of WINDOW_EVENTS) window.addEventListener(type, listener);
      engine.start();
      scheduleRelayout();
    }

    function stop() {
      if (!started) return;
      started = false;
      for (const [type, listener] of WINDOW_EVENTS) window.removeEventListener(type, listener);
      clearRelayout();
      engine.stop();
    }

    return Object.freeze({
      start,
      stop,
      resetSession: () => engine.resetSession(),
      setPanelOpen: open => engine.setSheetOpen(open),
      refresh: () => engine.refresh(),
      tabId,
      api,
      engine
    });
  }

  return Object.freeze({ RELAYOUT_DELAYS_MS, createLiteBoot });
});
