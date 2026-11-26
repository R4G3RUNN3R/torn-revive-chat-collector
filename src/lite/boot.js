(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteBoot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RELAYOUT_DELAYS_MS = Object.freeze([150, 1000, 3000]);
  const BADGES_KEY = 'reviverelay_badges_enabled';

  const dependency = (globalName, path) => globalThis[globalName] || require(path);

  function createLiteBoot({
    platform,
    window,
    document,
    baseUrl,
    clientVersion = '',
    releaseChannel = '',
    getToken = () => '',
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
    const { createBadges } = dependency('ReviveRelayLiteBadges', './badges');

    const now = typeof clock.now === 'function' ? clock.now : () => Date.now();
    const random = typeof clock.random === 'function' ? clock.random : Math.random;
    const setTimer = typeof clock.setTimeout === 'function' ? clock.setTimeout : (fn, ms) => globalThis.setTimeout(fn, ms);
    const clearTimer = typeof clock.clearTimeout === 'function' ? clock.clearTimeout : handle => globalThis.clearTimeout(handle);

    const tabId = `rr-${now().toString(36)}-${random().toString(36).slice(2, 10)}`;
    const api = createStateClient({ baseUrl, request: platform.request, getToken, clientVersion, releaseChannel, storage: platform.storage });
    const badges = createBadges({ document, window, api, enabled: () => Boolean(getToken()) && platform.storage.get(BADGES_KEY, true) !== false });
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
          badges.scan();
        }, delay);
        relayoutTimers.add(handle);
      }
    }

    function onPageHide() {
      clearRelayout();
      engine.stop();
    }

    function onPageShow(event) {
      if (!event || event.persisted !== true) return;
      engine.stop();
      engine.start();
      scheduleRelayout();
    }

    function scanWhenVisible() {
      if (!document.hidden) badges.scan();
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
      document.addEventListener('visibilitychange', scanWhenVisible);
      engine.start();
      scheduleRelayout();
    }

    function stop() {
      if (!started) return;
      started = false;
      for (const [type, listener] of WINDOW_EVENTS) window.removeEventListener(type, listener);
      document.removeEventListener('visibilitychange', scanWhenVisible);
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

  return Object.freeze({ RELAYOUT_DELAYS_MS, BADGES_KEY, createLiteBoot });
});
