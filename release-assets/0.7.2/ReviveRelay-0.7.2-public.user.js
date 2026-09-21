// ==UserScript==
// @name         ReviveRelay
// @namespace    https://voidsmithindustries.com/
// @version      0.7.2
// @description  Direct certified revive requests and Reviver Pro tools for Torn.
// @author       Voidsmith Industries
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_notification
// @connect      reviverelay.voidsmithindustries.com
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%2311170d%22%2F%3E%3Crect%20x%3D%2211%22%20y%3D%2218%22%20width%3D%2242%22%20height%3D%2234%22%20rx%3D%227%22%20fill%3D%22%23f3f7ee%22%2F%3E%3Cpath%20d%3D%22M24%2018v-3c0-3%202-5%205-5h6c3%200%205%202%205%205v3%22%20fill%3D%22none%22%20stroke%3D%22%23d9ff52%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%2F%3E%3Cpath%20d%3D%22M28%2025h8v7h7v8h-7v7h-8v-7h-7v-8h7z%22%20fill%3D%22%23d9ff52%22%2F%3E%3C%2Fsvg%3E
// @supportURL   https://voidsmithindustries.com/torn/support.html
// @updateURL    https://voidsmithindustries.com/torn/install/reviverelay.user.js
// @downloadURL  https://voidsmithindustries.com/torn/install/reviverelay.user.js
// ReviveRelay-Build-Commit: e361e8d2aa1cea2599c2e4dd15d06f5efa1ad195
// ReviveRelay-Build-Timestamp: 2026-09-21T08:15:00.000Z
// ==/UserScript==

/* ReviveRelay bundled module: src/platform.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayPlatform = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RUNTIME_TORNPDA = 'tornpda';
  const RUNTIME_USERSCRIPT = 'userscript';
  const DEFAULT_TIMEOUT_MS = 15000;
  const STORAGE_INIT_TIMEOUT_MS = 3000;
  const STORAGE_WRITE_TIMEOUT_MS = 3000;
  const FALLBACK_DIRTY_KEY = 'reviverelay_pda_fallback_dirty';

  function timeoutError(code) {
    return Object.assign(new Error(code), { code, retryable: true });
  }

  function withTimeout(promise, timeoutMs, code) {
    const ms = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(code)), ms);
      })
    ]).finally(() => clearTimeout(timer));
  }

  function detectRuntime(globalObject = globalThis) {
    const pdaStorage = globalObject && globalObject.PDA_storage;
    const hasPdaStorage = Boolean(
      pdaStorage
      && typeof pdaStorage.loadAll === 'function'
      && typeof pdaStorage.set === 'function'
    );
    const hasPdaHttp = Boolean(
      globalObject
      && typeof globalObject.PDA_httpGet === 'function'
      && typeof globalObject.PDA_httpPost === 'function'
    );
    const hasFlutterBridge = Boolean(
      globalObject
      && (globalObject.flutter_inappwebview || globalObject.window?.flutter_inappwebview)
    );
    // TornPDA injects its bridge/helpers independently. Treat the Flutter
    // bridge as authoritative when it is already present, and also accept the
    // complete storage+HTTP helper pair if the bridge is temporarily absent.
    // Requiring all three signals at one instant can misclassify TornPDA during
    // userscript startup and strand mobile-only UI recovery paths.
    const isTornPda = hasFlutterBridge || (hasPdaStorage && hasPdaHttp);
    return Object.freeze({
      kind: isTornPda ? RUNTIME_TORNPDA : RUNTIME_USERSCRIPT,
      isTornPda,
      hasPdaStorage,
      hasPdaHttp,
      hasFlutterBridge
    });
  }

  function createStorage({
    runtime,
    pdaStorage,
    gmGetValue,
    gmSetValue,
    keys = [],
    legacyDefaults = {},
    onError = () => {}
  }) {
    const cache = Object.create(null);
    let initialized = false;
    let backend = 'gm';

    function readGm(key, fallback) {
      if (typeof gmGetValue !== 'function') return fallback;
      try {
        const value = gmGetValue(key, fallback);
        return value === undefined ? fallback : value;
      } catch (error) {
        onError(error, 'storage.gm.read');
        return fallback;
      }
    }

    function writeGm(key, value) {
      if (typeof gmSetValue !== 'function') return;
      try { gmSetValue(key, value); } catch (error) { onError(error, 'storage.gm.write'); }
    }

    function migrateCacheToGm() {
      if (initialized && backend === 'gm') return;
      backend = 'gm';
      for (const [key, value] of Object.entries(cache)) writeGm(key, value);
      writeGm(FALLBACK_DIRTY_KEY, true);
    }

    async function writeManyPda(values) {
      const entries = Object.entries(values);
      if (!entries.length) return;
      if (typeof pdaStorage.setMany === 'function') {
        await withTimeout(pdaStorage.setMany(values), STORAGE_WRITE_TIMEOUT_MS, 'TORNPDA_STORAGE_TIMEOUT');
        return;
      }
      await withTimeout(
        Promise.all(entries.map(([key, value]) => Promise.resolve().then(() => pdaStorage.set(key, value)))),
        STORAGE_WRITE_TIMEOUT_MS,
        'TORNPDA_STORAGE_TIMEOUT'
      );
    }

    async function initialize() {
      if (initialized) return;
      if (runtime.isTornPda && pdaStorage && typeof pdaStorage.loadAll === 'function' && typeof pdaStorage.set === 'function') {
        try {
          const stored = await withTimeout(
            pdaStorage.loadAll(),
            STORAGE_INIT_TIMEOUT_MS,
            'TORNPDA_STORAGE_TIMEOUT'
          );
          if (stored && typeof stored === 'object' && !Array.isArray(stored)) Object.assign(cache, stored);

          if (readGm(FALLBACK_DIRTY_KEY, false) === true) {
            const recovery = {};
            for (const key of keys) {
              const sentinel = `\u0000ReviveRelayMissing:${key}`;
              const fallbackValue = readGm(key, sentinel);
              if (fallbackValue !== sentinel) recovery[key] = fallbackValue;
            }
            Object.assign(cache, recovery);
            await writeManyPda(recovery);
            for (const key of Object.keys(recovery)) {
              writeGm(key, Object.prototype.hasOwnProperty.call(legacyDefaults, key) ? legacyDefaults[key] : null);
            }
            writeGm(FALLBACK_DIRTY_KEY, false);
            backend = 'pda';
            initialized = true;
            return;
          }

          const migrate = {};
          for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(cache, key)) continue;
            const sentinel = `\u0000ReviveRelayMissing:${key}`;
            const legacy = readGm(key, sentinel);
            if (legacy !== sentinel) {
              cache[key] = legacy;
              migrate[key] = legacy;
            }
          }
          await writeManyPda(migrate);
          for (const key of Object.keys(migrate)) {
            writeGm(key, Object.prototype.hasOwnProperty.call(legacyDefaults, key) ? legacyDefaults[key] : null);
          }
          writeGm(FALLBACK_DIRTY_KEY, false);
          backend = 'pda';
        } catch (error) {
          onError(error, 'storage.pda.initialize');
          if (Object.keys(cache).length) migrateCacheToGm();
          else backend = 'gm';
        }
      }
      initialized = true;
    }

    function get(key, fallback) {
      if (backend === 'pda') {
        if (!Object.prototype.hasOwnProperty.call(cache, key)) return fallback;
        const value = cache[key];
        return value === undefined ? fallback : value;
      }
      return readGm(key, fallback);
    }

    function set(key, value) {
      if (backend === 'pda') {
        cache[key] = value;
        withTimeout(
          Promise.resolve().then(() => pdaStorage.set(key, value)),
          STORAGE_WRITE_TIMEOUT_MS,
          'TORNPDA_STORAGE_TIMEOUT'
        ).catch(error => {
          onError(error, 'storage.pda.write');
          migrateCacheToGm();
        });
        return;
      }
      if (runtime.isTornPda) cache[key] = value;
      writeGm(key, value);
    }

    return Object.freeze({
      initialize,
      get,
      set,
      mode: () => backend,
      runtime
    });
  }

  function normalizeResponse(response) {
    const status = Number(response && response.status) || 0;
    const responseText = response && typeof response.responseText === 'string' ? response.responseText : '';
    let body = {};
    if (response && response.body && typeof response.body === 'object') {
      body = response.body;
    } else if (responseText) {
      try { body = JSON.parse(responseText); } catch (_) { body = {}; }
    }
    return { status, responseText, body };
  }

  function createGmRequest(gmXmlHttpRequest) {
    if (typeof gmXmlHttpRequest !== 'function') return null;
    return function gmRequest(input) {
      return new Promise((resolve, reject) => {
        const headers = { ...(input.headers || {}) };
        let data;
        if (input.body !== undefined) {
          data = JSON.stringify(input.body);
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        }
        gmXmlHttpRequest({
          method: input.method || 'GET',
          url: input.url,
          headers,
          data,
          timeout: Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS,
          onload: response => resolve(normalizeResponse(response)),
          onerror: () => reject(timeoutError('NETWORK_ERROR')),
          ontimeout: () => reject(timeoutError('NETWORK_ERROR'))
        });
      });
    };
  }

  function createRequestAdapter({ runtime, globalObject = globalThis, gmXmlHttpRequest }) {
    const gmRequest = createGmRequest(gmXmlHttpRequest);
    const methodMap = Object.freeze({
      GET: 'PDA_httpGet',
      POST: 'PDA_httpPost',
      PUT: 'PDA_httpPut',
      DELETE: 'PDA_httpDelete',
      PATCH: 'PDA_httpPatch'
    });

    if (!runtime.isTornPda) {
      if (!gmRequest) throw new Error('GM_xmlhttpRequest is required');
      return gmRequest;
    }

    return async function pdaRequest(input) {
      const method = String(input.method || 'GET').toUpperCase();
      if (method === 'DELETE' && input.body !== undefined) {
        throw Object.assign(new Error('TORNPDA_DELETE_BODY_UNSUPPORTED'), {
          code: 'TORNPDA_DELETE_BODY_UNSUPPORTED',
          retryable: false
        });
      }

      const fnName = methodMap[method];
      const fn = fnName && globalObject && globalObject[fnName];
      if (typeof fn !== 'function') {
        if (gmRequest) return gmRequest(input);
        throw Object.assign(new Error('TORNPDA_HTTP_UNAVAILABLE'), {
          code: 'TORNPDA_HTTP_UNAVAILABLE',
          retryable: true
        });
      }

      const headers = { ...(input.headers || {}) };
      const hasBodyMethod = method === 'POST' || method === 'PUT' || method === 'PATCH';
      let body;
      if (hasBodyMethod) {
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        body = input.body === undefined ? '{}' : JSON.stringify(input.body);
      }

      let nativePromise;
      if (method === 'GET' || method === 'DELETE') nativePromise = fn(input.url, headers);
      else nativePromise = fn(input.url, headers, body);

      try {
        const response = await withTimeout(
          nativePromise,
          Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS,
          'NETWORK_ERROR'
        );
        return normalizeResponse(response);
      } catch (error) {
        if (error && error.code) throw error;
        throw timeoutError('NETWORK_ERROR');
      }
    };
  }

  function createNotifier({ runtime, document, gmNotification, onError = () => {} }) {
    function showPdaToast({ title, text, timeout = 12000, onclick }) {
      if (!document || !document.body) return false;
      let stack = document.getElementById('rr-pda-toast-stack');
      if (!stack) {
        stack = document.createElement('div');
        stack.id = 'rr-pda-toast-stack';
        stack.className = 'rr-pda-toast-stack';
        stack.setAttribute('aria-live', 'polite');
        document.body.appendChild(stack);
      }
      const toast = document.createElement('button');
      toast.type = 'button';
      toast.className = 'rr-pda-toast';
      toast.setAttribute('aria-label', title || 'ReviveRelay notification');
      const heading = document.createElement('strong');
      const message = document.createElement('span');
      heading.textContent = String(title || 'ReviveRelay');
      message.textContent = String(text || '');
      toast.append(heading, message);
      toast.addEventListener('click', () => {
        try { if (typeof onclick === 'function') onclick(); } finally { toast.remove(); }
      });
      stack.appendChild(toast);
      setTimeout(() => toast.remove(), Math.max(3000, Number(timeout) || 12000));
      return true;
    }

    return function notify(options = {}) {
      if (runtime.isTornPda) return showPdaToast(options);
      if (typeof gmNotification !== 'function') return false;
      try { gmNotification(options); return true; } catch (error) { onError(error, 'notification.gm'); return false; }
    };
  }

  function installResumeHooks({ runtime, window, document, callback }) {
    if (!runtime.isTornPda || typeof callback !== 'function') return () => {};
    let timer = null;
    const schedule = () => {
      if (document && document.visibilityState && document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      timer = setTimeout(() => callback(), 100);
    };
    const onVisibility = () => {
      if (!document || document.visibilityState === 'visible') schedule();
    };
    window?.addEventListener?.('focus', schedule);
    window?.addEventListener?.('pageshow', schedule);
    document?.addEventListener?.('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      window?.removeEventListener?.('focus', schedule);
      window?.removeEventListener?.('pageshow', schedule);
      document?.removeEventListener?.('visibilitychange', onVisibility);
    };
  }

  function createPlatform({
    globalObject = globalThis,
    window = globalThis.window,
    document = globalThis.document,
    gm = {},
    storageKeys = [],
    legacyDefaults = {},
    onError = () => {}
  } = {}) {
    const runtime = detectRuntime(globalObject);
    const storage = createStorage({
      runtime,
      pdaStorage: globalObject && globalObject.PDA_storage,
      gmGetValue: gm.getValue,
      gmSetValue: gm.setValue,
      keys: storageKeys,
      legacyDefaults,
      onError
    });
    const request = createRequestAdapter({
      runtime,
      globalObject,
      gmXmlHttpRequest: gm.xmlHttpRequest
    });
    const notify = createNotifier({
      runtime,
      document,
      gmNotification: gm.notification,
      onError
    });

    function addStyle(css) {
      if (typeof gm.addStyle === 'function') return gm.addStyle(css);
      if (!document || !document.head) return null;
      const style = document.createElement('style');
      style.textContent = String(css || '');
      document.head.appendChild(style);
      return style;
    }

    function openUrl(url) {
      if (!window) return false;
      let target;
      try {
        target = new URL(String(url || ''), window.location?.href || undefined);
      } catch (_) {
        return false;
      }
      if (target.protocol !== 'https:') return false;
      const allowedHosts = new Set(['torn.com', 'www.torn.com', 'reviverelay.voidsmithindustries.com', 'voidsmithindustries.com']);
      if (!allowedHosts.has(target.hostname)) return false;
      if (runtime.isTornPda) {
        if (window.location && typeof window.location.assign === 'function') {
          window.location.assign(target.href);
          return true;
        }
        return false;
      }
      window.open(target.href, '_blank', 'noopener,noreferrer');
      return true;
    }

    return Object.freeze({
      runtime,
      storage,
      request,
      notify,
      addStyle,
      openUrl,
      initialize: () => storage.initialize(),
      onResume: callback => installResumeHooks({ runtime, window, document, callback })
    });
  }

  return Object.freeze({
    RUNTIME_TORNPDA,
    RUNTIME_USERSCRIPT,
    DEFAULT_TIMEOUT_MS,
    STORAGE_INIT_TIMEOUT_MS,
    STORAGE_WRITE_TIMEOUT_MS,
    FALLBACK_DIRTY_KEY,
    withTimeout,
    detectRuntime,
    createStorage,
    createRequestAdapter,
    createNotifier,
    installResumeHooks,
    createPlatform
  });
});
/* ReviveRelay end bundled module: src/platform.js */

/* ReviveRelay bundled module: src/core.js */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TornReviveCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ABROAD_LOCATIONS = [
    'Mexico', 'Cayman Islands', 'Canada', 'Hawaii', 'United Kingdom',
    'Argentina', 'Switzerland', 'Japan', 'China', 'UAE', 'South Africa'
  ];

  const KNOWN_CHAT_TYPES = [
    ['global', /\bglobal\b/i],
    ['trade', /\btrade\b/i],
    ['hospital', /\bhospital\b/i],
    ['jail', /\bjail\b/i],
    ['faction', /\bfaction\b/i],
    ['company', /\bcompany\b/i],
    ['new-player', /new\s*player/i]
  ];

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function hashString(input) {
    let hash = 0x811c9dc5;
    const text = String(input ?? '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function inferAbroadLocation(conversationName) {
    const normalized = normalizeText(conversationName).toLowerCase();
    const match = ABROAD_LOCATIONS.find((name) => normalized === name.toLowerCase());
    return match || '';
  }

  function inferConversationType(conversationName) {
    const name = normalizeText(conversationName);
    if (!name) return 'unknown';
    if (inferAbroadLocation(name)) return 'travel';
    for (const [type, pattern] of KNOWN_CHAT_TYPES) {
      if (pattern.test(name)) return type;
    }
    return 'private';
  }

  function fingerprintMessage(message) {
    const sourceId = normalizeText(message.sourceMessageId);
    const timestamp = normalizeText(message.messageTimestamp);
    const fallbackBucket = message.capturedAt
      ? String(message.capturedAt).slice(0, 16)
      : '';
    const identityTime = sourceId || timestamp || fallbackBucket;
    const identity = [
      normalizeText(message.conversationId || message.conversationName).toLowerCase(),
      normalizeText(message.senderId || message.senderName).toLowerCase(),
      identityTime,
      normalizeText(message.text)
    ].join('|');
    return `trcc-${hashString(identity)}`;
  }

  function splitTimestamp(isoValue) {
    const value = String(isoValue || '');
    const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    if (match) return { date: match[1], time: match[2] };
    return { date: '', time: '' };
  }

  const PANEL_TABS = Object.freeze(['request', 'reviver', 'activity', 'settings']);

  function clampPanelPosition(position = {}, viewport = {}, panel = {}, margin = 8) {
    const safeMargin = Number.isFinite(Number(margin)) && Number(margin) >= 0 ? Number(margin) : 8;
    const viewportWidth = Math.max(0, Number(viewport.width) || 0);
    const viewportHeight = Math.max(0, Number(viewport.height) || 0);
    const panelWidth = Math.max(0, Number(panel.width) || 0);
    const panelHeight = Math.max(0, Number(panel.height) || 0);
    const rawX = Number(position.x);
    const rawY = Number(position.y);
    const minX = safeMargin;
    const minY = safeMargin;
    const maxX = Math.max(minX, viewportWidth - panelWidth - safeMargin);
    const maxY = Math.max(minY, viewportHeight - panelHeight - safeMargin);
    const x = Number.isFinite(rawX) ? rawX : minX;
    const y = Number.isFinite(rawY) ? rawY : minY;
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y))
    };
  }

  function normalizePanelTab(value) {
    const tab = String(value || '').trim().toLowerCase();
    return PANEL_TABS.includes(tab) ? tab : 'request';
  }

  function buildSheetRecord(message) {
    const effectiveTimestamp = message.messageTimestamp || message.capturedAt || new Date().toISOString();
    const parts = splitTimestamp(effectiveTimestamp);
    const chatName = normalizeText(message.conversationName) || 'Unknown';
    const type = message.conversationType || inferConversationType(chatName);
    const record = {
      date: parts.date,
      time: parts.time,
      chat: chatName,
      chatType: type,
      abroadLocation: message.abroadLocation || inferAbroadLocation(chatName),
      player: normalizeText(message.senderName),
      playerId: normalizeText(message.senderId),
      message: String(message.text ?? '').trim(),
      messageTimestamp: String(message.messageTimestamp || ''),
      capturedAt: String(message.capturedAt || ''),
      pageUrl: String(message.pageUrl || ''),
      conversationId: String(message.conversationId || ''),
      sourceMessageId: String(message.sourceMessageId || '')
    };
    record.fingerprint = message.fingerprint || fingerprintMessage({ ...message, conversationType: type });
    return record;
  }

  return {
    ABROAD_LOCATIONS,
    normalizeText,
    hashString,
    inferAbroadLocation,
    inferConversationType,
    fingerprintMessage,
    buildSheetRecord,
    clampPanelPosition,
    normalizePanelTab
  };
});
/* ReviveRelay end bundled module: src/core.js */

/* ReviveRelay bundled module: src/direct-api-client.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayDirectApiClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PLAN_IDS = Object.freeze(['monthly', 'six_months', 'yearly']);
  const PRO_CURRENCIES = Object.freeze(['xanax', 'cash']);
  const ACCOUNT_DELETE_CONFIRMATION = 'DELETE REVIVERELAY ACCOUNT';
  const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
  const SAFE_DETAIL_KEYS = Object.freeze(['error', 'latestVersion', 'minimumVersion', 'installUrl', 'state', 'missing']);

  class DirectApiClientError extends Error {
    constructor(code, options = {}) {
      super(code);
      this.name = 'DirectApiClientError';
      this.code = code;
      this.status = Number(options.status) || 0;
      this.retryable = Boolean(options.retryable);
      this.details = options.details || null;
    }
  }

  function normalizeBaseUrl(value) {
    const baseUrl = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('A valid ReviveRelay baseUrl is required');
    return baseUrl;
  }

  function versioning() {
    if (typeof globalThis !== 'undefined' &&
        globalThis.ReviveRelayVersioning &&
        typeof globalThis.ReviveRelayVersioning.compareVersions === 'function') {
      return globalThis.ReviveRelayVersioning;
    }
    if (typeof require === 'function') return require('./versioning');
    throw new Error('ReviveRelay versioning unavailable');
  }

  function incompatibleRuntime(reason) {
    return Object.freeze({ compatible:false, reason, subscription:null });
  }

  function validateReviewRuntime(runtime, { clientVersion = '', releaseChannel = '' } = {}) {
    if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
      return incompatibleRuntime('RUNTIME_MISSING');
    }
    if (releaseChannel !== 'review') return incompatibleRuntime('CLIENT_CHANNEL_INVALID');
    if (runtime.releaseChannel !== 'review') return incompatibleRuntime('RUNTIME_CHANNEL_MISMATCH');

    const subscription = runtime.subscription;
    if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription) ||
        !['free','review','live'].includes(subscription.mode)) {
      return incompatibleRuntime('RUNTIME_SUBSCRIPTION_INVALID');
    }

    try {
      const { compareVersions } = versioning();
      compareVersions(runtime.serverVersion, '0.0.0');
      compareVersions(runtime.minimumClientVersion, '0.0.0');
      compareVersions(clientVersion, '0.0.0');
      if (compareVersions(clientVersion, runtime.minimumClientVersion) < 0) {
        return incompatibleRuntime('CLIENT_TOO_OLD');
      }
    } catch (_) {
      return incompatibleRuntime('RUNTIME_VERSION_INVALID');
    }

    return Object.freeze({ compatible:true, reason:null, subscription });
  }

  function safeParseBody(response) {
    if (response && response.body && typeof response.body === 'object') return response.body;
    const raw = response && typeof response.responseText === 'string' ? response.responseText : '';
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }

  function safeErrorCode(body) {
    const value = body && typeof body.error === 'string' ? body.error.trim() : '';
    return SAFE_ERROR_CODE.test(value) ? value : '';
  }

  function safeDetails(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    const result = {};
    for (const key of SAFE_DETAIL_KEYS) {
      const value = body[key];
      if (key === 'error') {
        const code = safeErrorCode(body);
        if (code) result.error = code;
        continue;
      }
      if (typeof value === 'string' && value.length <= 500) result[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
      else if (typeof value === 'boolean') result[key] = value;
      else if (Array.isArray(value)) {
        const bounded = value.slice(0, 32).filter(item => typeof item === 'string' && item.length <= 160);
        if (bounded.length) result[key] = bounded;
      }
    }
    return result;
  }

  function fallbackHttpCode(status) {
    if (status === 401) return 'AUTH_REQUIRED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 409) return 'CONFLICT';
    if (status === 422) return 'INVALID_REQUEST';
    if (status === 426) return 'CLIENT_UPDATE_REQUIRED';
    if (status === 429) return 'RATE_LIMITED';
    if (status >= 500) return 'SERVER_UNAVAILABLE';
    return 'REQUEST_FAILED';
  }

  function mapHttpError(status, body) {
    const serverCode = safeErrorCode(body);
    const retryable = status === 429 || status >= 500;
    return new DirectApiClientError(serverCode || fallbackHttpCode(status), {
      status,
      retryable,
      details: safeDetails(body)
    });
  }

  function createGmRequestAdapter(gmXmlHttpRequest) {
    if (typeof gmXmlHttpRequest !== 'function') throw new Error('GM_xmlhttpRequest is required');
    return function gmRequest(input) {
      return new Promise((resolve, reject) => {
        const headers = { ...(input.headers || {}) };
        let data;
        if (input.body !== undefined) {
          data = JSON.stringify(input.body);
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        }
        gmXmlHttpRequest({
          method: input.method || 'GET',
          url: input.url,
          headers,
          data,
          timeout: Number(input.timeoutMs) || 15000,
          onload: response => resolve({
            status: Number(response.status) || 0,
            body: safeParseBody(response),
            responseText: response.responseText
          }),
          onerror: () => reject(new DirectApiClientError('NETWORK_ERROR', { retryable: true })),
          ontimeout: () => reject(new DirectApiClientError('NETWORK_ERROR', { retryable: true }))
        });
      });
    };
  }

  function validateInvoiceSelection(selection) {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw new DirectApiClientError('INVALID_INVOICE_SELECTION');
    }
    const keys = Object.keys(selection).sort();
    if (keys.length !== 2 || keys[0] !== 'currency' || keys[1] !== 'planId') {
      throw new DirectApiClientError('INVALID_INVOICE_SELECTION');
    }
    if (!PLAN_IDS.includes(selection.planId) || !PRO_CURRENCIES.includes(selection.currency)) {
      throw new DirectApiClientError('INVALID_INVOICE_SELECTION');
    }
    return { planId: selection.planId, currency: selection.currency };
  }

  function validateInvoiceId(invoiceId) {
    const normalized = String(invoiceId || '').trim();
    if (!normalized) throw new DirectApiClientError('INVALID_INVOICE_ID');
    return normalized;
  }

  function createDirectApiClient({ baseUrl, getToken = () => '', request, clientVersion = '', releaseChannel = '' }) {
    const normalizedBase = normalizeBaseUrl(baseUrl);
    if (typeof request !== 'function') throw new Error('request transport is required');
    const readStoredToken = typeof getToken === 'function' ? getToken : () => '';
    let boundToken = '';

    async function call(method, path, body, options = {}) {
      const headers = {
        Accept: 'application/json',
        'X-ReviveRelay-Version': String(clientVersion || ''),
        'X-ReviveRelay-Channel': String(releaseChannel || '')
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.auth !== false) {
        const token = String(boundToken || readStoredToken() || '').trim();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      let response;
      try {
        response = await request({ method, url: `${normalizedBase}${path}`, headers, body });
      } catch (error) {
        if (error instanceof DirectApiClientError) throw error;
        throw new DirectApiClientError('NETWORK_ERROR', { retryable: true });
      }
      const status = Number(response && response.status) || 0;
      const responseBody = safeParseBody(response);
      if (status >= 200 && status < 300) return responseBody;
      throw mapHttpError(status, responseBody);
    }

    return Object.freeze({
      async bind(apiKey, version = clientVersion) {
        const result = await call('POST', '/v1/auth/bind', { apiKey: String(apiKey || ''), clientVersion: String(version || '') }, { auth: false });
        if (result && result.token) boundToken = String(result.token);
        return result;
      },
      clearBoundToken() { boundToken = ''; },
      getMe() { return call('GET', '/v1/me'); },
      getClientVersionManifest() { return call('GET', '/v1/client/version', undefined, { auth: false }); },
      submitTelemetry(errors) { return call('POST', '/v1/telemetry/errors', { errors: Array.isArray(errors) ? errors : [] }); },
      createRequest(preset) { return call('POST', '/v1/requests', preset); },
      getActiveRequest() { return call('GET', '/v1/requests/active'); },
      cancelRequest(requestId) { return call('POST', `/v1/requests/${encodeURIComponent(String(requestId || ''))}/cancel`); },
      getVerificationCredential() { return call('GET', '/v1/verification-credential'); },
      bindVerificationCredential(apiKey) { return call('POST', '/v1/verification-credential', { apiKey: String(apiKey || '') }); },
      revokeVerificationCredential() { return call('POST', '/v1/verification-credential/revoke'); },
      getReviverEligibility() { return call('GET', '/v1/reviver/eligibility'); },
      registerReviver() { return call('POST', '/v1/reviver/register'); },
      getReviverQueue() { return call('GET', '/v1/reviver/queue'); },
      acceptRequest(requestId) { return call('POST', `/v1/requests/${encodeURIComponent(String(requestId || ''))}/accept`); },
      getTransaction(transactionId) { return call('GET', `/v1/transactions/${encodeURIComponent(String(transactionId || ''))}`); },
      checkPayment(transactionId) { return call('POST', `/v1/transactions/${encodeURIComponent(String(transactionId || ''))}/check-payment`); },
      requestRetry(transactionId) { return call('POST', `/v1/transactions/${encodeURIComponent(String(transactionId || ''))}/retry-request`); },
      respondRetry(transactionId, decision) {
        if (!['accept', 'decline'].includes(decision)) throw new DirectApiClientError('INVALID_RETRY_DECISION');
        return call('POST', `/v1/transactions/${encodeURIComponent(String(transactionId || ''))}/retry-response`, { decision });
      },
      requestRefund(transactionId) { return call('POST', `/v1/transactions/${encodeURIComponent(String(transactionId || ''))}/request-refund`); },
      checkRefund(transactionId) { return call('POST', `/v1/transactions/${encodeURIComponent(String(transactionId || ''))}/check-refund`); },
      getProStatus() { return call('GET', '/v1/pro/status'); },
      startProTrial() { return call('POST', '/v1/pro/trial'); },
      getProPlans() { return call('GET', '/v1/pro/plans'); },
      async createProInvoice(selection) {
        return call('POST', '/v1/pro/invoices', validateInvoiceSelection(selection));
      },
      async getProInvoice(invoiceId) {
        return call('GET', `/v1/pro/invoices/${encodeURIComponent(validateInvoiceId(invoiceId))}`);
      },
      deleteAccount() { return call('POST', '/v1/account/delete', { confirm: ACCOUNT_DELETE_CONFIRMATION }); }
    });
  }

  return {
    PLAN_IDS,
    PRO_CURRENCIES,
    ACCOUNT_DELETE_CONFIRMATION,
    DirectApiClientError,
    safeDetails,
    mapHttpError,
    validateReviewRuntime,
    createGmRequestAdapter,
    createDirectApiClient
  };
});
/* ReviveRelay end bundled module: src/direct-api-client.js */

/* ReviveRelay bundled module: src/versioning.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayVersioning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function parseVersion(value) {
    const match = String(value ?? '').trim().match(/^([0-9])\.([0-9])\.([0-9])$/);
    if (!match) throw new Error('Invalid ReviveRelay version: each numeric component must be 0-9');
    return match.slice(1).map(Number);
  }
  function compareVersions(a, b) {
    const left = parseVersion(a); const right = parseVersion(b);
    for (let i = 0; i < 3; i += 1) {
      if (left[i] > right[i]) return 1;
      if (left[i] < right[i]) return -1;
    }
    return 0;
  }
  function isNewer(latest, current) { return compareVersions(latest, current) > 0; }
  return Object.freeze({ parseVersion, compareVersions, isNewer });
});
/* ReviveRelay end bundled module: src/versioning.js */

/* ReviveRelay bundled module: src/update-manager.js */
(function(root, factory) {
  const api = factory(root && root.ReviveRelayVersioning);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayUpdateManager = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(browserVersioning) {
  'use strict';

  const DAY_MS = 86_400_000;
  const UPDATE_CHECK_MS = 43_200_000;
  const UPDATE_STATE_SOURCE = 'distribution-meta-v1';
  const CHANNELS = Object.freeze(['review', 'stable']);
  const DISTRIBUTION_ORIGIN = 'https://reviverelay.voidsmithindustries.com';
  const PUBLIC_REVIEW_INSTALL_URL = 'https://voidsmithindustries.com/torn/install/reviverelay.user.js';

  function versioning() {
    if (browserVersioning) return browserVersioning;
    if (typeof require === 'function') return require('./versioning');
    throw new Error('ReviveRelay versioning unavailable');
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function validChannel(channel) {
    return CHANNELS.includes(String(channel || ''));
  }

  function distributionUrls(channel) {
    if (!validChannel(channel)) throw new Error('Invalid distribution metadata');
    const base = `${DISTRIBUTION_ORIGIN}/dist/${channel}`;
    return Object.freeze({
      metaUrl: `${base}/ReviveRelay.meta.js`,
      userUrl: `${base}/ReviveRelay.user.js`
    });
  }

  function validateVersion(value) {
    const normalized = String(value || '').trim();
    const { compareVersions } = versioning();
    compareVersions(normalized, normalized);
    return normalized;
  }

  function metadataValues(header, field) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^//\\s+@${escaped}\\s+(.+?)\\s*$`, 'gm');
    return [...header.matchAll(regex)].map(match => String(match[1] || '').trim());
  }

  function parseDistributionMetadata(input, expectedChannel) {
    try {
      if (!validChannel(expectedChannel) || typeof input !== 'string') throw new Error('invalid');
      const startMarker = '// ==UserScript==';
      const endMarker = '// ==/UserScript==';
      const start = input.indexOf(startMarker);
      const end = input.indexOf(endMarker);
      if (start < 0 || end <= start) throw new Error('invalid');
      const header = input.slice(start, end + endMarker.length);
      const versions = metadataValues(header, 'version');
      const updateUrls = metadataValues(header, 'updateURL');
      const downloadUrls = metadataValues(header, 'downloadURL');
      if (versions.length !== 1 || updateUrls.length !== 1 || downloadUrls.length !== 1) throw new Error('invalid');

      const latestVersion = validateVersion(versions[0]);
      const expected = distributionUrls(expectedChannel);
      if (updateUrls[0] !== expected.metaUrl || downloadUrls[0] !== expected.userUrl) throw new Error('invalid');

      return Object.freeze({
        latestVersion,
        releaseChannel: expectedChannel,
        install: Object.freeze({
          installUrl: expected.userUrl,
          metaUrl: expected.metaUrl
        }),
        mandatory: false
      });
    } catch (_) {
      throw new Error('Invalid distribution metadata');
    }
  }

  function validateDistributionRelease(input, expectedChannel) {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) || !validChannel(expectedChannel)) throw new Error('invalid');
      if (input.releaseChannel !== expectedChannel || input.mandatory !== false) throw new Error('invalid');
      const latestVersion = validateVersion(input.latestVersion);
      const expected = distributionUrls(expectedChannel);
      if (!input.install || input.install.installUrl !== expected.userUrl || input.install.metaUrl !== expected.metaUrl) throw new Error('invalid');
      return {
        latestVersion,
        releaseChannel: expectedChannel,
        install: { installUrl: expected.userUrl, metaUrl: expected.metaUrl },
        mandatory: false
      };
    } catch (_) {
      throw new Error('Invalid distribution metadata');
    }
  }

  // Retained for validating immutable server release manifests used by the
  // compatibility boundary and existing security tests. The client updater
  // itself now reads the distribution metadata feed directly.
  function validateManifest(input, expectedChannel = null) {
    const { compareVersions } = versioning();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid manifest');
    for (const key of ['latestVersion', 'minimumVersion', 'buildTimestamp', 'releaseNotes', 'gitCommit', 'releaseChannel', 'sha256', 'apiCompatibility', 'install', 'mandatory']) {
      if (!(key in input)) throw new Error('Invalid manifest');
    }
    compareVersions(input.latestVersion, input.minimumVersion);
    if (compareVersions(input.minimumVersion, input.latestVersion) > 0) throw new Error('Invalid manifest minimum');
    if (!validChannel(input.releaseChannel) || expectedChannel && input.releaseChannel !== expectedChannel) throw new Error('Invalid manifest channel');
    if (typeof input.releaseNotes !== 'string' || input.releaseNotes.length > 4000 || typeof input.buildTimestamp !== 'string' || Number.isNaN(Date.parse(input.buildTimestamp)) || typeof input.gitCommit !== 'string' || !/^[0-9a-f]{40}$/.test(input.gitCommit) || typeof input.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.sha256) || typeof input.mandatory !== 'boolean') throw new Error('Invalid manifest');
    const expectedReleaseBase = `${DISTRIBUTION_ORIGIN}/releases/${input.releaseChannel}/${input.latestVersion}`;
    if (!input.install || input.install.installUrl !== `${expectedReleaseBase}/ReviveRelay-${input.latestVersion}.user.js` || input.install.metaUrl !== `${expectedReleaseBase}/ReviveRelay-${input.latestVersion}.meta.js`) throw new Error('Invalid manifest');
    if (!input.apiCompatibility || !Number.isInteger(input.apiCompatibility.minimum) || !Number.isInteger(input.apiCompatibility.current) || input.apiCompatibility.current < input.apiCompatibility.minimum) throw new Error('Invalid manifest');
    return clone(input);
  }

  function createUpdateManager({ currentVersion, channel, fetchText, getState, saveState, now = Date.now, openUrl }) {
    const { compareVersions } = versioning();
    validateVersion(currentVersion);
    if (!validChannel(channel) || typeof fetchText !== 'function' || typeof getState !== 'function' || typeof saveState !== 'function' || typeof openUrl !== 'function') {
      throw new Error('Update manager dependencies are required');
    }
    const urls = distributionUrls(channel);

    function read() {
      const value = getState();
      return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
    }

    function validatedStoredRelease(state) {
      if (!state || state.source !== UPDATE_STATE_SOURCE || !state.lastManifest) return null;
      try {
        return validateDistributionRelease(state.lastManifest, channel);
      } catch (_) {
        return null;
      }
    }

    function write(state) {
      let release = null;
      if (state.lastManifest) {
        try { release = validateDistributionRelease(state.lastManifest, channel); } catch (_) {}
      }
      const next = {
        source: UPDATE_STATE_SOURCE,
        lastCheckedAt: Number(state.lastCheckedAt || 0),
        lastManifest: release ? clone(release) : null,
        dismissedVersion: state.dismissedVersion || null
      };
      saveState(next);
      return next;
    }

    function describe(release, state, extra = {}) {
      if (!release) return { updateAvailable: false, mandatory: false, supported: true, ...extra };
      const updateAvailable = compareVersions(release.latestVersion, currentVersion) > 0;
      const dismissed = Boolean(updateAvailable && state.dismissedVersion === release.latestVersion);
      return {
        manifest: clone(release),
        latestVersion: release.latestVersion,
        minimumVersion: null,
        updateAvailable,
        mandatory: false,
        supported: true,
        dismissed,
        ...extra
      };
    }

    async function check({ force = false } = {}) {
      let state = read();
      const timestamp = Number(now());
      const previous = validatedStoredRelease(state);
      const canThrottle = state.source === UPDATE_STATE_SOURCE && Number.isFinite(state.lastCheckedAt) && state.lastCheckedAt > 0;
      if (!force && canThrottle && timestamp - Number(state.lastCheckedAt) < UPDATE_CHECK_MS) {
        return describe(previous, state, { skipped: true, lastCheckedAt: Number(state.lastCheckedAt) });
      }

      try {
        const release = parseDistributionMetadata(await fetchText(urls.metaUrl), channel);
        if (state.dismissedVersion && state.dismissedVersion !== release.latestVersion) state.dismissedVersion = null;
        state = write({ ...state, lastCheckedAt: timestamp, lastManifest: release });
        return describe(release, state, { skipped: false, lastCheckedAt: timestamp });
      } catch (_) {
        state = write({ ...state, lastCheckedAt: timestamp, lastManifest: previous });
        return describe(previous, state, {
          error: 'UPDATE_CHECK_FAILED',
          skipped: false,
          lastCheckedAt: timestamp
        });
      }
    }

    function dismiss(version) {
      let state = read();
      const release = validatedStoredRelease(state);
      if (!release || release.latestVersion !== version || compareVersions(release.latestVersion, currentVersion) <= 0) return false;
      state = write({ ...state, dismissedVersion: version });
      return Boolean(state.dismissedVersion === version);
    }

    function openUpdate() {
      const state = read();
      const release = validatedStoredRelease(state);
      if (!release || compareVersions(release.latestVersion, currentVersion) <= 0) return false;
      const installUrl = channel === 'review' ? PUBLIC_REVIEW_INSTALL_URL : release.install.installUrl;
      return openUrl(installUrl) === true;
    }

    return Object.freeze({ check, dismiss, openUpdate, getState: read });
  }

  return Object.freeze({
    DAY_MS,
    UPDATE_CHECK_MS,
    UPDATE_STATE_SOURCE,
    PUBLIC_REVIEW_INSTALL_URL,
    distributionUrls,
    parseDistributionMetadata,
    validateManifest,
    createUpdateManager
  });
});
/* ReviveRelay end bundled module: src/update-manager.js */

/* ReviveRelay bundled module: src/telemetry-client.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayTelemetryClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SAFE_CONTEXT_KEYS = Object.freeze([
    'operation', 'route', 'jobType', 'httpStatus', 'tornStatus', 'state',
    'method', 'retryable', 'releaseChannel'
  ]);
  const MESSAGE_LIMIT = 1000;
  const STACK_LIMIT = 8000;
  const CONTEXT_STRING_LIMIT = 250;
  const QUEUE_LIMIT = 100;
  const BATCH_LIMIT = 20;
  const COALESCE_WINDOW_MS = 60_000;
  const REDACTED = '[REDACTED]';

  function redactString(value) {
    let text = String(value ?? '');
    text = text.replace(/\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi, REDACTED);
    text = text.replace(/\b(https?:\/\/)[^\s\/@:]+:[^\s\/@]+@([^\s\/'"<>]+)/gi, '$1[REDACTED]@$2');
    text = text.replace(/([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|key|secret|password|session|authorization|cookie)=)[^&#\s"']*/gi, '$1[REDACTED]');
    text = text.replace(/\bAuthorization\s*:\s*(?:Bearer\s+)?[^\s,;]+/gi, 'Authorization: [REDACTED]');
    text = text.replace(/\bCookie\s*:\s*[^\r\n]+/gi, 'Cookie: [REDACTED]');
    text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/=\-]{6,}/gi, `Bearer ${REDACTED}`);
    text = text.replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|cookie|session)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (_match, name) => name.toLowerCase() === 'cookie' ? REDACTED : `${name}=${REDACTED}`);
    text = text.replace(/\b(?:sk|pk|tok)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/gi, REDACTED);
    text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/gi, REDACTED);
    text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){1,2}\b/g, REDACTED);
    return text;
  }

  function sanitizeBoundedString(value, limit) {
    return redactString(redactString(value).slice(0, limit)).slice(0, limit);
  }

  function sanitizeContext(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const output = {};
    for (const key of SAFE_CONTEXT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
      const value = input[key];
      if (typeof value === 'string') output[key] = sanitizeBoundedString(value, CONTEXT_STRING_LIMIT);
      else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
      else if (typeof value === 'boolean') output[key] = value;
    }
    return output;
  }

  function sanitizeClientEnvelope(input = {}) {
    const output = {
      component: 'client',
      version: sanitizeBoundedString(input.version || 'unknown', CONTEXT_STRING_LIMIT),
      severity: sanitizeBoundedString(input.severity || 'error', CONTEXT_STRING_LIMIT),
      message: sanitizeBoundedString(input.message || 'Unknown client error', MESSAGE_LIMIT),
      context: sanitizeContext(input.context)
    };
    if (input.buildCommit) output.buildCommit = sanitizeBoundedString(input.buildCommit, CONTEXT_STRING_LIMIT);
    if (input.errorName) output.errorName = sanitizeBoundedString(input.errorName, CONTEXT_STRING_LIMIT);
    if (input.errorCode) output.errorCode = sanitizeBoundedString(input.errorCode, CONTEXT_STRING_LIMIT);
    if (input.stack) output.stack = sanitizeBoundedString(input.stack, STACK_LIMIT);

    const parsed = new Date(input.occurredAt || Date.now());
    output.occurredAt = Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
    return output;
  }

  function normalizeCoalesceText(value) {
    return String(value || '')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,36}\b/gi, '<uuid>')
      .replace(/\b\d+\b/g, '<n>')
      .replace(/https?:\/\/[^\s)]+/gi, '<url>')
      .replace(/:\d+:\d+/g, ':<line>:<col>')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function coalesceKey(envelope) {
    const stack = String(envelope.stack || '').split('\n').slice(0, 3).join('\n');
    return [
      envelope.errorName || '',
      normalizeCoalesceText(envelope.message),
      normalizeCoalesceText(stack),
      String(envelope.context?.operation || '').trim().toLowerCase(),
      normalizeCoalesceText(envelope.context?.route || '')
    ].join('|');
  }

  function createTelemetryClient({ submit, getStoredQueue, saveStoredQueue, version, buildCommit, now }) {
    if (typeof submit !== 'function') throw new Error('submit is required');
    if (typeof getStoredQueue !== 'function') throw new Error('getStoredQueue is required');
    if (typeof saveStoredQueue !== 'function') throw new Error('saveStoredQueue is required');
    const clock = typeof now === 'function' ? now : Date.now;
    const recent = new Map();
    let droppedCount = 0;
    let draining = false;

    function readSafeQueue() {
      const stored = getStoredQueue();
      if (!Array.isArray(stored)) return [];
      return stored.map(sanitizeClientEnvelope).slice(-QUEUE_LIMIT);
    }

    function captureError(error, context = {}) {
      const timestamp = Number(clock());
      const source = error instanceof Error ? error : new Error(String(error || 'Unknown client error'));
      const envelope = sanitizeClientEnvelope({
        component: 'client',
        version,
        buildCommit,
        severity: 'error',
        errorName: source.name || 'Error',
        errorCode: typeof source.code === 'string' || typeof source.code === 'number' ? String(source.code) : undefined,
        message: source.message || String(source),
        stack: source.stack || undefined,
        context,
        occurredAt: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString()
      });

      const key = coalesceKey(envelope);
      const last = recent.get(key);
      if (Number.isFinite(last) && timestamp - last <= COALESCE_WINDOW_MS) return false;
      recent.set(key, timestamp);
      for (const [candidate, seenAt] of recent) {
        if (timestamp - seenAt > COALESCE_WINDOW_MS) recent.delete(candidate);
      }

      const queue = readSafeQueue();
      queue.push(envelope);
      if (queue.length > QUEUE_LIMIT) {
        const excess = queue.length - QUEUE_LIMIT;
        queue.splice(0, excess);
        droppedCount += excess;
      }
      saveStoredQueue(queue);
      return true;
    }

    async function drain() {
      if (draining) return { sent: 0, remaining: readSafeQueue().length };
      const queue = readSafeQueue();
      if (!queue.length) {
        saveStoredQueue([]);
        return { sent: 0, remaining: 0 };
      }

      const batch = queue.slice(0, BATCH_LIMIT);
      draining = true;
      try {
        await submit({ errors: batch });
        const latest = readSafeQueue();
        const remaining = latest.slice(Math.min(batch.length, latest.length));
        saveStoredQueue(remaining);
        return { sent: batch.length, remaining: remaining.length };
      } catch (_) {
        saveStoredQueue(queue);
        return { sent: 0, remaining: queue.length };
      } finally {
        draining = false;
      }
    }

    return Object.freeze({
      captureError,
      drain,
      getDroppedCount: () => droppedCount
    });
  }

  return Object.freeze({
    SAFE_CONTEXT_KEYS,
    sanitizeClientEnvelope,
    createTelemetryClient
  });
});
/* ReviveRelay end bundled module: src/telemetry-client.js */

/* ReviveRelay bundled module: src/request-preset.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayRequestPreset = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ALLOWED_FIELDS = Object.freeze(['paymentMethod', 'offerAmount', 'comment']);

  function fail(error) {
    return { ok: false, error };
  }

  function validatePreset(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_PRESET');
    const keys = Object.keys(input);
    if (keys.some(key => !ALLOWED_FIELDS.includes(key))) return fail('UNKNOWN_FIELD');

    const paymentMethod = input.paymentMethod;
    const offerAmount = Number(input.offerAmount);
    if (paymentMethod !== 'cash' && paymentMethod !== 'xanax') return fail('INVALID_PAYMENT_METHOD');
    if (!Number.isSafeInteger(offerAmount)) return fail('INVALID_OFFER_AMOUNT');
    if (paymentMethod === 'cash' && offerAmount < 500000) return fail('INVALID_OFFER_AMOUNT');
    if (paymentMethod === 'xanax' && offerAmount < 1) return fail('INVALID_OFFER_AMOUNT');

    let comment = null;
    if (input.comment != null) {
      if (typeof input.comment !== 'string') return fail('INVALID_COMMENT');
      const trimmed = input.comment.trim();
      if (trimmed.length > 500) return fail('INVALID_COMMENT');
      comment = trimmed || null;
    }

    return {
      ok: true,
      preset: Object.freeze({ paymentMethod, offerAmount, comment })
    };
  }

  function deriveSidebarState({ sessionToken, preset, submitting = false, activeRequest = null, lastError = null } = {}) {
    if (submitting) return 'SUBMITTING';
    if (activeRequest) return 'ACTIVE';
    if (lastError) return 'ERROR';
    if (!String(sessionToken || '').trim()) return 'SETUP_REQUIRED';
    if (!validatePreset(preset).ok) return 'SETUP_REQUIRED';
    return 'READY';
  }

  return Object.freeze({
    ALLOWED_FIELDS,
    validatePreset,
    deriveSidebarState
  });
});
/* ReviveRelay end bundled module: src/request-preset.js */

/* ReviveRelay bundled module: src/sidebar-action.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelaySidebarAction = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACTION_SELECTOR = '[data-reviverelay-sidebar-action]';
  const GEAR_SELECTOR = '[data-reviverelay-sidebar-gear]';
  const NAV_SELECTORS = Object.freeze([
    '#sidebar',
    '#sidebarroot',
    'nav[aria-label="Primary"]',
    'nav[aria-label="Main"]',
    '[role="navigation"][class*="sidebar"]',
    '[class*="sidebar"] nav'
  ]);
  const VALID_STATES = new Set(['READY', 'SETUP_REQUIRED', 'SUBMITTING', 'ACTIVE', 'ERROR']);

  function createSidebarController({ document, window, label, onActivate, getState, gearLabel, getMinimized, onRestore }) {
    if (!document || typeof document.createElement !== 'function' || typeof document.querySelector !== 'function') {
      throw new Error('document is required');
    }
    if (!window) throw new Error('window is required');
    const visibleLabel = String(label || '').trim();
    if (!visibleLabel) throw new Error('label is required');
    if (typeof onActivate !== 'function') throw new Error('onActivate is required');
    if (typeof getState !== 'function') throw new Error('getState is required');
    const visibleGearLabel = String(gearLabel || 'Restore ReviveRelay').trim();
    const restoreHandler = typeof onRestore === 'function' ? onRestore : null;
    const minimizedGetter = typeof getMinimized === 'function' ? getMinimized : () => false;
    const gearEnabled = () => Boolean(restoreHandler) && Boolean(minimizedGetter());

    let destroyed = false;
    let observer = null;
    let observedTarget = null;
    let debounceTimer = null;
    let explicitState = null;
    let captureListener = null;
    let pointerDownCaptureListener = null;
    let pointerUpCaptureListener = null;
    let pointerCancelCaptureListener = null;
    let pendingPointer = null;
    let suppressClickUntil = 0;
    const boundActions = new WeakSet();
    const handledEvents = new WeakSet();

    function findSidebar() {
      for (const selector of NAV_SELECTORS) {
        const target = document.querySelector(selector);
        if (target) return target;
      }
      return null;
    }

    function resolvedState() {
      const candidate = explicitState || getState();
      return VALID_STATES.has(candidate) ? candidate : 'SETUP_REQUIRED';
    }

    function applyState(action, state) {
      action.setAttribute('data-state', state);
      action.setAttribute('aria-label', visibleLabel);
      action.setAttribute('title', `${visibleLabel} · ${state.replaceAll('_', ' ').toLowerCase()}`);
      action.setAttribute('aria-busy', state === 'SUBMITTING' ? 'true' : 'false');
      action.disabled = state === 'SUBMITTING';
      if (action.style) {
        action.style.opacity = state === 'SUBMITTING' ? '0.72' : '1';
        action.style.cursor = state === 'SUBMITTING' ? 'wait' : 'pointer';
      }
    }

    function applyActionLayout(action, minimizedWithGear) {
      if (!action || !action.style) return;
      if (minimizedWithGear) {
        action.style.display = 'inline-flex';
        action.style.width = 'calc(100% - 50px)';
        action.style.margin = '4px 2px 4px 6px';
      } else {
        action.style.display = 'flex';
        action.style.width = 'calc(100% - 12px)';
        action.style.margin = '4px 6px';
      }
    }

    function activateFromEvent(event, controlType) {
      if (event && typeof event === 'object') {
        if (handledEvents.has(event)) return;
        handledEvents.add(event);
      }
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      if (controlType === 'gear') {
        if (restoreHandler) restoreHandler();
        return;
      }
      const state = resolvedState();
      if (state === 'SUBMITTING') return;
      onActivate(state);
    }

    function eventTargetsSelector(event, attribute, selector) {
      const path = event && typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (Array.isArray(path) && path.some(node => node && typeof node.getAttribute === 'function' && node.getAttribute(attribute) !== null)) {
        return true;
      }
      const target = event?.target;
      return Boolean(target && typeof target.closest === 'function' && target.closest(selector));
    }

    function eventTargetsAction(event) {
      return eventTargetsSelector(event, 'data-reviverelay-sidebar-action', ACTION_SELECTOR);
    }

    function eventTargetsGear(event) {
      return eventTargetsSelector(event, 'data-reviverelay-sidebar-gear', GEAR_SELECTOR);
    }

    function clickActivation(event, controlType) {
      if (Date.now() <= suppressClickUntil) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
        return;
      }
      activateFromEvent(event, controlType);
    }

    function bindActivation(button, controlType) {
      if (boundActions.has(button)) return;
      button.addEventListener('click', event => clickActivation(event, controlType));
      boundActions.add(button);
    }

    if (typeof window.addEventListener === 'function') {
      captureListener = event => {
        if (eventTargetsAction(event)) { clickActivation(event, 'action'); return; }
        if (eventTargetsGear(event)) clickActivation(event, 'gear');
      };
      window.addEventListener('click', captureListener, true);

      pointerDownCaptureListener = event => {
        if (event?.button != null && event.button !== 0) return;
        let controlType = null;
        if (eventTargetsAction(event)) controlType = 'action';
        else if (eventTargetsGear(event)) controlType = 'gear';
        if (!controlType) return;
        pendingPointer = {
          controlType,
          pointerId: event?.pointerId ?? null,
          startedAt: Date.now(),
          clientX: Number.isFinite(event?.clientX) ? event.clientX : null,
          clientY: Number.isFinite(event?.clientY) ? event.clientY : null
        };
      };
      pointerUpCaptureListener = event => {
        if (!pendingPointer) return;
        if (pendingPointer.pointerId != null && event?.pointerId != null && event.pointerId !== pendingPointer.pointerId) return;
        const pending = pendingPointer;
        pendingPointer = null;
        if (Date.now() - pending.startedAt > 2_000) return;
        if (pending.clientX != null && pending.clientY != null && Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
          const dx = event.clientX - pending.clientX;
          const dy = event.clientY - pending.clientY;
          if (Math.hypot(dx, dy) > 32) return;
        }
        suppressClickUntil = Date.now() + 1_000;
        activateFromEvent(event, pending.controlType);
      };
      pointerCancelCaptureListener = event => {
        if (!pendingPointer) return;
        if (pendingPointer.pointerId == null || event?.pointerId == null || event.pointerId === pendingPointer.pointerId) pendingPointer = null;
      };
      window.addEventListener('pointerdown', pointerDownCaptureListener, true);
      window.addEventListener('pointerup', pointerUpCaptureListener, true);
      window.addEventListener('pointercancel', pointerCancelCaptureListener, true);
    }

    function createAction() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rr-sidebar-action';
      button.setAttribute('data-reviverelay-sidebar-action', '1');
      button.setAttribute('aria-label', visibleLabel);
      if (button.style) {
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.gap = '8px';
        button.style.width = 'calc(100% - 12px)';
        button.style.boxSizing = 'border-box';
        button.style.border = '1px solid #d04a4a';
        button.style.background = '#a4161a';
        button.style.color = '#fff';
        button.style.font = 'inherit';
        button.style.fontWeight = '700';
        button.style.padding = '6px 8px';
        button.style.margin = '4px 6px';
        button.style.borderRadius = '5px';
        button.style.textAlign = 'left';
        button.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.12)';
      }

      const icon = document.createElement('span');
      icon.setAttribute('data-rr-sidebar-icon', '1');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '✚';
      if (icon.style) {
        icon.style.color = '#fff';
        icon.style.fontWeight = '900';
        icon.style.fontSize = '14px';
        icon.style.lineHeight = '1';
        icon.style.flexShrink = '0';
      }

      const text = document.createElement('span');
      text.setAttribute('data-rr-sidebar-label', '1');
      text.textContent = visibleLabel;

      button.appendChild(icon);
      button.appendChild(text);
      bindActivation(button, 'action');
      return button;
    }

    function createGearButton() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rr-sidebar-gear';
      button.setAttribute('data-reviverelay-sidebar-gear', '1');
      button.setAttribute('aria-label', visibleGearLabel);
      if (button.style) {
        button.style.display = 'inline-flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.width = '34px';
        button.style.boxSizing = 'border-box';
        button.style.border = '1px solid #46515b';
        button.style.background = '#20272e';
        button.style.color = '#d9e0e6';
        button.style.font = 'inherit';
        button.style.fontWeight = '700';
        button.style.padding = '6px 0';
        button.style.margin = '4px 6px 4px 2px';
        button.style.borderRadius = '5px';
        button.style.cursor = 'pointer';
        button.style.verticalAlign = 'top';
      }

      const icon = document.createElement('span');
      icon.setAttribute('data-rr-sidebar-gear-icon', '1');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⚙';

      button.appendChild(icon);
      bindActivation(button, 'gear');
      return button;
    }

    function scheduleReconcile() {
      if (destroyed || debounceTimer != null) return;
      const schedule = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : setTimeout;
      debounceTimer = schedule(() => {
        debounceTimer = null;
        reconcile();
      }, 75);
    }

    function attachObserver(target) {
      if (observedTarget === target && observer) return;
      if (observer && typeof observer.disconnect === 'function') observer.disconnect();
      observer = null;
      observedTarget = target;
      if (!target || typeof window.MutationObserver !== 'function') return;
      observer = new window.MutationObserver(() => scheduleReconcile());
      observer.observe(target, { childList: true, subtree: true });
    }

    function reconcile() {
      if (destroyed) return null;
      const target = findSidebar();
      if (!target) {
        attachObserver(null);
        return null;
      }

      const all = Array.from(document.querySelectorAll(ACTION_SELECTOR) || []);
      let action = null;
      for (const node of all) {
        if (!action && node.parentNode === target) action = node;
        else if (typeof node.remove === 'function') node.remove();
      }
      if (!action) action = createAction();
      bindActivation(action, 'action');

      const nativeChildren = Array.from(target.children || []).filter(node => node !== action);
      const nearTopAnchor = nativeChildren[1] || nativeChildren[0] || null;
      if (nearTopAnchor && typeof target.insertBefore === 'function') target.insertBefore(action, nearTopAnchor);
      else if (action.parentNode !== target) target.appendChild(action);

      applyState(action, resolvedState());
      const showGear = gearEnabled();
      applyActionLayout(action, showGear);

      const allGears = Array.from(document.querySelectorAll(GEAR_SELECTOR) || []);
      let gear = allGears.find(node => node.parentNode === target) || allGears[0] || null;
      for (const node of allGears) {
        if (node !== gear && typeof node.remove === 'function') node.remove();
      }
      if (showGear) {
        if (!gear) gear = createGearButton();
        bindActivation(gear, 'gear');
        const siblings = Array.from(target.children || []).filter(node => node !== gear);
        const actionIndex = siblings.indexOf(action);
        const anchor = siblings[actionIndex + 1] || null;
        if (anchor && typeof target.insertBefore === 'function') target.insertBefore(gear, anchor);
        else target.appendChild(gear);
      } else if (gear && typeof gear.remove === 'function') {
        gear.remove();
      }

      attachObserver(target);
      return action;
    }

    function setState(state) {
      if (!VALID_STATES.has(state)) throw new Error('Invalid ReviveRelay sidebar state');
      explicitState = state;
      const actions = Array.from(document.querySelectorAll(ACTION_SELECTOR) || []);
      for (const action of actions) applyState(action, state);
      return state;
    }

    function destroy() {
      destroyed = true;
      if (debounceTimer != null && typeof window.clearTimeout === 'function') window.clearTimeout(debounceTimer);
      debounceTimer = null;
      if (observer && typeof observer.disconnect === 'function') observer.disconnect();
      observer = null;
      observedTarget = null;
      if (captureListener && typeof window.removeEventListener === 'function') {
        window.removeEventListener('click', captureListener, true);
      }
      if (pointerDownCaptureListener && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pointerdown', pointerDownCaptureListener, true);
      }
      if (pointerUpCaptureListener && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pointerup', pointerUpCaptureListener, true);
      }
      if (pointerCancelCaptureListener && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pointercancel', pointerCancelCaptureListener, true);
      }
      captureListener = null;
      pointerDownCaptureListener = null;
      pointerUpCaptureListener = null;
      pointerCancelCaptureListener = null;
      pendingPointer = null;
      for (const action of Array.from(document.querySelectorAll(ACTION_SELECTOR) || [])) {
        if (typeof action.remove === 'function') action.remove();
      }
      for (const gear of Array.from(document.querySelectorAll(GEAR_SELECTOR) || [])) {
        if (typeof gear.remove === 'function') gear.remove();
      }
    }

    return Object.freeze({ reconcile, destroy, setState });
  }

  return Object.freeze({
    ACTION_SELECTOR,
    GEAR_SELECTOR,
    NAV_SELECTORS,
    createSidebarController
  });
});
/* ReviveRelay end bundled module: src/sidebar-action.js */

(function () {
  'use strict';

  const VERSION = '0.7.2';
  const UPDATE_CHANNEL = 'review';
  const BUILD_COMMIT = 'e361e8d2aa1cea2599c2e4dd15d06f5efa1ad195';
  const BUILD_TIMESTAMP = '2026-09-21T08:15:00.000Z';
  const API_BASE = 'https://reviverelay.voidsmithindustries.com/review';
  const REQUEST_POLL_MS = 10_000;
  const PRO_POLL_MS = 60_000;
  const QUEUE_POLL_MS = 10_000;
  const INVOICE_POLL_MS = 15_000;
  const SIDEBAR_RECONCILE_MS = 5_000;
  const TELEMETRY_DRAIN_MS = 30_000;
  const REVIVER_ELIGIBILITY_TIMEOUT_MS = 12_000;
  const MAX_SEEN_REQUEST_IDS = 200;
  const REVIVERELAY_API_KEY_URL = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=ReviveRelay&user=basic,profile,revives,log,perks&logIds=14,15,16,17';
  const MASKED_VERIFICATION_KEY = '••••••••••••••••';

  const KEYS = Object.freeze({
    sessionToken: 'reviverelay_session_token',
    publicIdentity: 'reviverelay_public_identity',
    requestPreset: 'reviverelay_request_preset',
    seenRequestIds: 'reviverelay_seen_request_ids',
    minimized: 'reviverelay_panel_minimized',
    panelPosition: 'reviverelay_panel_position',
    panelTab: 'reviverelay_panel_tab',
    updateState: 'reviverelay_update_state',
    desktopNotificationsEnabled: 'reviverelay_desktop_notifications_enabled',
    clientDiagnosticsEnabled: 'reviverelay_client_diagnostics_enabled',
    telemetryOutbox: 'reviverelay_telemetry_outbox'
  });

  const Platform = globalThis.ReviveRelayPlatform;
  const LEGACY_DEFAULTS = Object.freeze({
    [KEYS.sessionToken]: '',
    [KEYS.publicIdentity]: null,
    [KEYS.requestPreset]: null,
    [KEYS.seenRequestIds]: [],
    [KEYS.minimized]: false,
    [KEYS.panelPosition]: null,
    [KEYS.panelTab]: 'request',
    [KEYS.updateState]: {},
    [KEYS.desktopNotificationsEnabled]: true,
    [KEYS.clientDiagnosticsEnabled]: false,
    [KEYS.telemetryOutbox]: []
  });

  const Core = globalThis.TornReviveCore;
  const DirectApiClient = globalThis.ReviveRelayDirectApiClient;
  const UpdateManager = globalThis.ReviveRelayUpdateManager;
  const TelemetryClient = globalThis.ReviveRelayTelemetryClient;
  const RequestPreset = globalThis.ReviveRelayRequestPreset;
  const SidebarAction = globalThis.ReviveRelaySidebarAction;

  if (!Platform || !Core || !DirectApiClient || !UpdateManager || !TelemetryClient || !RequestPreset || !SidebarAction) {
    console.error('[ReviveRelay] Required direct-runtime dependency unavailable.');
    return;
  }

  const platform = Platform.createPlatform({
    globalObject: globalThis,
    window,
    document,
    gm: {
      getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
      setValue: typeof GM_setValue === 'function' ? GM_setValue : null,
      xmlHttpRequest: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
      addStyle: typeof GM_addStyle === 'function' ? GM_addStyle : null,
      notification: typeof GM_notification === 'function' ? GM_notification : null
    },
    storageKeys: Object.values(KEYS),
    legacyDefaults: LEGACY_DEFAULTS,
    onError: (error, context) => console.warn('[ReviveRelay]', context, error?.message || error)
  });
  const storage = platform.storage;
  const requestTransport = platform.request;
  const state = {
    api: null,
    telemetry: null,
    updateManager: null,
    sessionToken: '',
    identity: null,
    preset: null,
    activeRequest: null,
    activeTransaction: null,
    verificationCredential: null,
    verificationEditing: false,
    reviverEligibility: null,
    reviverQueue: [],
    queuePaymentFilter: 'all',
    queueMinCash: 0,
    queueMinXanax: 0,
    queueSort: 'newest',
    queueGroup: 'payment',
    proStatus: null,
    runtime: null,
    runtimeCompatibility: 'unknown',
    runtimeCompatibilityReason: null,
    subscription: null,
    proPlans: [],
    currentInvoice: null,
    submittingRequest: false,
    sidebarController: null,
    settingsOpen: false,
    settingsSection: null,
    minimized: false,
    panelPosition: null,
    panelTab: 'request'
  };

  let panel = null;
  let body = null;
  let connectionPill = null;
  let pdaLauncher = null;
  let statusMessage = '';
  let statusIsError = false;
  let lastRequestError = null;
  let updateResult = null;
  let requestTimer = null;
  let proTimer = null;
  let queueTimer = null;
  let invoiceTimer = null;
  let sidebarTimer = null;
  let telemetryTimer = null;
  let clockTimer = null;
  let updateTimer = null;
  const pollFlights = new Map();
  const mutationFlights = new Set();
  const authoritativeStateRevisions = new Map();

  state.api = DirectApiClient.createDirectApiClient({
    baseUrl: API_BASE,
    getToken: () => state.sessionToken,
    request: requestTransport,
    clientVersion: VERSION,
    releaseChannel: UPDATE_CHANNEL
  });

  state.telemetry = TelemetryClient.createTelemetryClient({
    submit: payload => state.api.submitTelemetry(payload.errors),
    getStoredQueue: () => storage.get(KEYS.telemetryOutbox, []),
    saveStoredQueue: queue => storage.set(KEYS.telemetryOutbox, Array.isArray(queue) ? queue : []),
    version: VERSION,
    buildCommit: BUILD_COMMIT
  });

  state.updateManager = UpdateManager.createUpdateManager({
    currentVersion: VERSION,
    channel: UPDATE_CHANNEL,
    fetchText: async url => {
      const response = await requestTransport({
        method: 'GET',
        url,
        headers: { Accept: 'text/plain' },
        timeoutMs: 10_000
      });
      if (!response || response.status < 200 || response.status >= 300 || typeof response.responseText !== 'string') {
        throw new Error('ReviveRelay update metadata unavailable');
      }
      return response.responseText;
    },
    getState: () => storage.get(KEYS.updateState, {}),
    saveState: value => storage.set(KEYS.updateState, value),
    openUrl: url => platform.openUrl(url)
  });

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatMoney(value) {
    return `$${Math.max(0, Number(value) || 0).toLocaleString('en-US')}`;
  }

  function formatOffer(method, amount) {
    return method === 'xanax'
      ? `${Number(amount) || 0} Xanax`
      : formatMoney(amount);
  }

  function formatDate(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
  }

  function deadlineRemaining(value) {
    if (!value) return '—';
    const target = new Date(value).getTime();
    if (!Number.isFinite(target)) return '—';
    const seconds = Math.max(0, Math.floor((target - Date.now()) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function formatCountdown(value) {
    return deadlineRemaining(value);
  }

  function requestAge(value) {
    const started = new Date(value).getTime();
    if (!Number.isFinite(started)) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  function hasRole(role) {
    return Boolean(state.identity && Array.isArray(state.identity.roles) && state.identity.roles.includes(role));
  }

  function hasCredentialCapability(role) {
    return Boolean(
      state.verificationCredential
      && state.verificationCredential.usable
      && state.verificationCredential.capabilities
      && state.verificationCredential.capabilities[role] === true
    );
  }

  function isProActive() {
    return state.proStatus?.state === 'TRIAL' || state.proStatus?.state === 'ACTIVE' || state.proStatus?.state === 'OWNER';
  }

  function runtimeCompatible() {
    return state.runtimeCompatibility === 'compatible';
  }

  function subscriptionMode() {
    if (state.runtimeCompatibility !== 'compatible') return 'unknown';
    return ['free', 'review', 'live'].includes(state.subscription?.mode)
      ? state.subscription.mode
      : 'unknown';
  }

  function subscriptionPaymentsEnabled() {
    return state.runtimeCompatibility === 'compatible' && state.subscription?.paymentsEnabled === true;
  }

  function hasReviverSubscriptionAccess() {
    if (state.runtimeCompatibility !== 'compatible') return false;
    if (state.proStatus?.state === 'REVOKED' || state.reviverEligibility?.status === 'DENIED') return false;
    return subscriptionMode() === 'free' || isProActive();
  }

  function applyRuntimeContract(runtime) {
    const result = DirectApiClient.validateReviewRuntime(runtime, {
      clientVersion: VERSION,
      releaseChannel: UPDATE_CHANNEL
    });
    state.runtime = runtime && typeof runtime === 'object' ? runtime : null;
    state.runtimeCompatibility = result.compatible ? 'compatible' : 'incompatible';
    state.runtimeCompatibilityReason = result.reason || null;
    if (result.compatible) {
      state.subscription = result.subscription;
      state.proPlans = Array.isArray(result.subscription?.plans) ? result.subscription.plans : [];
    } else {
      invalidateAuthoritativeState('pro');
      invalidateAuthoritativeState('queue');
      invalidateAuthoritativeState('eligibility');
      invalidateAuthoritativeState('invoice');
      state.subscription = null;
      state.proPlans = [];
      state.proStatus = null;
      state.reviverQueue = [];
      state.reviverEligibility = null;
    }
    return result;
  }

  function runtimeCompatibilityMessage() {
    if (state.runtimeCompatibility === 'unknown') return 'Checking the ReviveRelay review backend…';
    if (state.runtimeCompatibilityReason === 'RUNTIME_CHANNEL_MISMATCH') return 'This review client reached the wrong ReviveRelay backend. Protected actions are disabled.';
    if (state.runtimeCompatibilityReason === 'CLIENT_TOO_OLD') return 'This ReviveRelay review build is too old for the review backend. Update ReviveRelay before continuing.';
    return 'ReviveRelay review backend is incompatible or unavailable. Protected actions are disabled.';
  }

  function withTimeout(promise, ms, code) {
    let timer;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms);
    });
    return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
  }

  function runSingleFlightPoll(key, operation) {
    const existing = pollFlights.get(key);
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (pollFlights.get(key) === promise) pollFlights.delete(key);
      });
    pollFlights.set(key, promise);
    return promise;
  }

  function beginAuthoritativeRefresh(key) {
    const revision = (authoritativeStateRevisions.get(key) || 0) + 1;
    authoritativeStateRevisions.set(key, revision);
    return revision;
  }

  function invalidateAuthoritativeState(key) {
    return beginAuthoritativeRefresh(key);
  }

  function applyAuthoritativeState(key, revision, apply) {
    if (authoritativeStateRevisions.get(key) !== revision) return false;
    apply();
    return true;
  }

  function mutationBusy(key) {
    return mutationFlights.has(key);
  }

  function disabledAttr(key) {
    return mutationBusy(key) ? ' disabled aria-disabled="true"' : '';
  }

  async function runMutation(key, operation) {
    if (mutationFlights.has(key)) return null;
    mutationFlights.add(key);
    try {
      renderLiveState();
      renderProPanel();
      if (state.settingsOpen) renderSettingsDrawer();
      return await operation();
    } finally {
      mutationFlights.delete(key);
      renderLiveState();
      renderProPanel();
      if (state.settingsOpen) renderSettingsDrawer();
    }
  }

  function hasConfirmedReviveAbility() {
    return state.reviverEligibility?.canRevive === true;
  }

  function publicIdentity() {
    if (!state.identity) return null;
    return { tornId: state.identity.tornId, name: state.identity.name };
  }

  function captureClientError(error, operation) {
    if (!storage.get(KEYS.clientDiagnosticsEnabled, false)) return;
    try {
      state.telemetry.captureError(error, { operation });
    } catch (_) {
      // Diagnostics must never block ReviveRelay.
    }
  }

  function setStatus(message, isError = false) {
    statusMessage = String(message || '');
    statusIsError = Boolean(isError);
    renderStatus();
  }

  function renderStatus() {
    const target = document.getElementById('rr-status');
    if (!target) return;
    target.textContent = statusMessage;
    target.className = statusIsError ? 'rr-status rr-status-error' : 'rr-status';
  }

  function apiErrorCode(error) {
    if (error && typeof error.code === 'string') return error.code;
    if (error && error.details && typeof error.details.error === 'string') return error.details.error;
    return 'REQUEST_FAILED';
  }

  function userFacingApiErrorMessage(error, fallback = 'ReviveRelay request failed.') {
    const code = apiErrorCode(error);
    const messages = {
      REVIVE_ABILITY_NOT_UNLOCKED: 'This Torn account does not currently have permanent revive ability.',
      REVIVE_ABILITY_PERMISSION_REQUIRED: 'Update your Torn API key so ReviveRelay can confirm your revive ability.',
      VERIFICATION_CREDENTIAL_INSUFFICIENT: 'Your Torn API key does not have the permissions required by ReviveRelay. Replace it with a correctly configured Torn API key.',
      REQUESTER_VERIFICATION_REQUIRED: 'The requester has not connected a suitable Torn API key yet. This request cannot be accepted until requester evidence is ready.',
      INVOICE_NOT_FOUND: 'This Pro invoice is unavailable for your account.',
      INVOICE_EXPIRED: 'This Pro invoice has expired. Create a new invoice.',
      CLIENT_UPDATE_REQUIRED: 'Update ReviveRelay before continuing.',
      TORN_UNAVAILABLE: 'Torn is temporarily unavailable. Try again shortly.',
      SUBSCRIPTION_PAYMENTS_DISABLED: 'Reviver Pro payments are not required in the current subscription mode.'
    };
    return messages[code] || fallback;
  }

  function handleApiFailure(error, operation, userMessage = 'ReviveRelay request failed.') {
    captureClientError(error, operation);
    if (apiErrorCode(error) === 'AUTH_REQUIRED') {
      clearSession('Your ReviveRelay session expired. Verify & connect again.');
      return;
    }
    setStatus(userFacingApiErrorMessage(error, userMessage), true);
  }

  function clearSession(message = 'Disconnected from ReviveRelay.') {
    state.api.clearBoundToken();
    invalidateAuthoritativeState('pro');
    invalidateAuthoritativeState('queue');
    invalidateAuthoritativeState('invoice');
    state.sessionToken = '';
    state.identity = null;
    state.activeRequest = null;
    state.activeTransaction = null;
    state.verificationCredential = null;
    state.verificationEditing = false;
    state.reviverEligibility = null;
    state.reviverQueue = [];
    state.proStatus = null;
    state.runtime = null;
    state.runtimeCompatibility = 'unknown';
    state.runtimeCompatibilityReason = null;
    state.subscription = null;
    state.proPlans = [];
    state.currentInvoice = null;
    state.submittingRequest = false;
    lastRequestError = null;
    storage.set(KEYS.sessionToken, '');
    storage.set(KEYS.publicIdentity, null);
    setStatus(message, false);
    refreshSidebarState();
    renderAll();
  }

  async function refreshMe() {
    if (!state.sessionToken) return null;
    const revision = beginAuthoritativeRefresh('pro');
    const me = await state.api.getMe();
    applyAuthoritativeState('pro', revision, () => {
      state.identity = {
        ...(me?.user || {}),
        roles: Array.isArray(me?.roles) ? me.roles : []
      };
      const runtimeResult = applyRuntimeContract(me?.runtime || null);
      state.proStatus = runtimeResult.compatible && me?.pro ? me.pro : null;
      storage.set(KEYS.publicIdentity, publicIdentity());
    });
    return me;
  }

  async function connectIdentity() {
    const apiKeyInput = document.getElementById('rr-api-key');
    const apiKey = String(apiKeyInput?.value || '').trim();
    if (!apiKey) {
      setStatus('Enter your Torn API key first.', true);
      return;
    }
    setStatus('Connecting your Torn API key…');
    try {
      const result = await state.api.bind(apiKey, VERSION);
      const verificationResult = await state.api.bindVerificationCredential(apiKey);
      state.sessionToken = String(result?.token || '');
      state.identity = result?.user ? { ...result.user, roles: ['requester'] } : null;
      state.verificationCredential = verificationResult?.credential || null;
      state.verificationEditing = false;
      if (apiKeyInput) apiKeyInput.value = '';
      storage.set(KEYS.sessionToken, state.sessionToken);
      storage.set(KEYS.publicIdentity, publicIdentity());
      await refreshMarketplaceState({ includePlans: true });
      setStatus(runtimeCompatible() ? 'ReviveRelay connected with your Torn API key.' : runtimeCompatibilityMessage(), !runtimeCompatible());
      refreshSidebarState();
      renderAll();
    } catch (error) {
      state.api.clearBoundToken();
      state.sessionToken = '';
      state.identity = null;
      state.verificationCredential = null;
      if (apiKeyInput) apiKeyInput.value = '';
      handleApiFailure(error, 'identity.bind', 'Torn API key connection failed.');
    }
  }

  async function restoreSession() {
    if (!state.sessionToken) return;
    try {
      await refreshMarketplaceState({ includePlans: true });
    } catch (error) {
      if (Number(error && error.status) === 401) clearSession('Your ReviveRelay session expired. Verify & connect again.');
      else handleApiFailure(error, 'session.restore', 'Could not restore ReviveRelay state.');
    }
  }

  async function refreshProState({ includePlans = false } = {}) {
    return runSingleFlightPoll('pro', async () => {
      if (!state.sessionToken) {
        state.proStatus = null;
        state.runtime = null;
        state.runtimeCompatibility = 'unknown';
        state.runtimeCompatibilityReason = null;
        state.subscription = null;
        state.proPlans = [];
        return;
      }
      const revision = beginAuthoritativeRefresh('pro');
      const result = await state.api.getProStatus();
      applyAuthoritativeState('pro', revision, () => {
        const runtimeResult = applyRuntimeContract(result?.runtime || null);
        state.proStatus = runtimeResult.compatible ? (result?.pro || null) : null;
      });
    });
  }

  async function refreshActiveRequest() {
    return runSingleFlightPoll('request', async () => {
      if (!state.sessionToken || !runtimeCompatible()) {
        state.activeRequest = null;
        return;
      }
      const result = await state.api.getActiveRequest();
      state.activeRequest = result?.request || null;
      if (state.activeRequest?.transactionId) await refreshActiveTransaction(state.activeRequest.transactionId);
      else if (state.activeTransaction?.participantRole === 'requester') state.activeTransaction = null;
      refreshSidebarState();
    });
  }

  async function refreshActiveTransaction(transactionId = null) {
    return runSingleFlightPoll('transaction', async () => {
      const id = transactionId || state.activeTransaction?.id || state.activeRequest?.transactionId;
      if (!state.sessionToken || !runtimeCompatible() || !id) return;
      const result = await state.api.getTransaction(id);
      state.activeTransaction = result?.transaction || result || null;
    });
  }

  async function refreshVerificationCredential() {
    if (!state.sessionToken || !runtimeCompatible()) {
      state.verificationCredential = null;
      state.reviverEligibility = null;
      return;
    }
    const result = await state.api.getVerificationCredential();
    state.verificationCredential = result?.credential || null;
    if (!hasCredentialCapability('reviver')) state.reviverEligibility = null;
  }

  async function refreshReviverEligibility() {
    return runSingleFlightPoll('eligibility', async () => {
      if (state.reviverEligibility?.status === 'UNAVAILABLE') return;
      if (!state.sessionToken || !hasReviverSubscriptionAccess() || !hasCredentialCapability('reviver')) {
        state.reviverEligibility = null;
        return;
      }
      const revision = beginAuthoritativeRefresh('eligibility');
      try {
        const result = await withTimeout(state.api.getReviverEligibility(), REVIVER_ELIGIBILITY_TIMEOUT_MS, 'REVIVER_ELIGIBILITY_TIMEOUT');
        applyAuthoritativeState('eligibility', revision, () => {
          state.reviverEligibility = result?.eligibility || null;
        });
      } catch (error) {
        const timedOut = error && error.code === 'REVIVER_ELIGIBILITY_TIMEOUT';
        applyAuthoritativeState('eligibility', revision, () => {
          state.reviverEligibility = { status: timedOut ? 'TIMEOUT' : 'UNAVAILABLE', canRevive: null };
        });
        captureClientError(error, 'reviver.eligibility');
      }
    });
  }

  function readSeenRequestIds() {
    const stored = storage.get(KEYS.seenRequestIds, []);
    return Array.isArray(stored) ? stored.map(String).slice(-MAX_SEEN_REQUEST_IDS) : [];
  }

  function writeSeenRequestIds(ids) {
    const bounded = Array.from(new Set(ids.map(String))).slice(-MAX_SEEN_REQUEST_IDS);
    storage.set(KEYS.seenRequestIds, bounded);
  }

  function desktopNotificationsEnabled() {
    return Boolean(storage.get(KEYS.desktopNotificationsEnabled, true));
  }

  function notifyNewQueueRequests(requests) {
    if (!hasReviverSubscriptionAccess() || !hasRole('reviver') || !hasCredentialCapability('reviver') || !hasConfirmedReviveAbility()) return;
    const seen = new Set(readSeenRequestIds());
    const next = [...seen];
    const canNotify = desktopNotificationsEnabled() && typeof platform.notify === 'function';
    for (const request of Array.isArray(requests) ? requests : []) {
      const id = String(request?.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
      const offer = formatOffer(request.paymentMethod, request.offerAmount);
      const requester = `${request.requesterName || 'Player'} [${request.requesterTornId || '?'}]`;
      if (!canNotify) continue;
      try {
        platform.notify({
          title: 'ReviveRelay · Certified request',
          text: `${requester} · ${offer}`,
          timeout: 12_000,
          onclick: () => {
            try { window.focus(); } catch (_) {}
            activatePanelTab('reviver');
          }
        });
      } catch (error) {
        captureClientError(error, 'notification.certified_request');
      }
    }
    writeSeenRequestIds(next);
  }

  async function refreshReviverQueue() {
    return runSingleFlightPoll('queue', async () => {
      if (!state.sessionToken || !hasReviverSubscriptionAccess()) {
        state.reviverQueue = [];
        return;
      }
      if (!hasRole('reviver') || !hasCredentialCapability('reviver') || !hasConfirmedReviveAbility()) {
        state.reviverQueue = [];
        return;
      }
      const revision = beginAuthoritativeRefresh('queue');
      const result = await state.api.getReviverQueue();
      applyAuthoritativeState('queue', revision, () => {
        state.reviverQueue = Array.isArray(result?.requests) ? result.requests : [];
        notifyNewQueueRequests(state.reviverQueue);
      });
    });
  }

  async function refreshCurrentInvoice() {
    return runSingleFlightPoll('invoice', async () => {
      if (!state.sessionToken || !runtimeCompatible() || state.currentInvoice?.state !== 'PENDING' || !state.currentInvoice?.id) return;
      const revision = beginAuthoritativeRefresh('invoice');
      const result = await state.api.getProInvoice(state.currentInvoice.id);
      const applied = applyAuthoritativeState('invoice', revision, () => {
        state.currentInvoice = {
          ...(result?.invoice || {}),
          paymentTarget: result?.paymentTarget || state.currentInvoice.paymentTarget || null
        };
      });
      if (!applied) return;
      if (state.currentInvoice.state === 'PAID') {
        await refreshProState({ includePlans: false });
        await refreshVerificationCredential();
        await refreshReviverEligibility();
        await refreshReviverQueue();
      }
    });
  }

  async function refreshMarketplaceState({ includePlans = false } = {}) {
    if (!state.sessionToken) return;
    await refreshMe();
    if (!runtimeCompatible()) return;
    await refreshProState({ includePlans });
    if (!runtimeCompatible()) return;
    await refreshActiveRequest();
    await refreshVerificationCredential();
    await refreshReviverEligibility();
    await refreshReviverQueue();
    if (state.activeTransaction?.id) await refreshActiveTransaction(state.activeTransaction.id);
  }

  async function requestReviveFromSidebar() {
    const validation = RequestPreset.validatePreset(state.preset);
    if (!state.sessionToken || !runtimeCompatible() || !validation.ok || state.submittingRequest || state.activeRequest) return;
    return runMutation('request-create', async () => {
      state.submittingRequest = true;
      lastRequestError = null;
      refreshSidebarState();
      renderAll();
      try {
        const result = await state.api.createRequest(validation.preset);
        state.activeRequest = result?.request || null;
        setStatus(hasCredentialCapability('requester')
          ? 'Certified revive request submitted.'
          : 'Certified revive request submitted. Requester verification is required before a reviver can accept it.');
      } catch (error) {
        lastRequestError = apiErrorCode(error);
        handleApiFailure(error, 'request.create', 'Could not create revive request.');
      } finally {
        state.submittingRequest = false;
        refreshSidebarState();
        renderAll();
      }
    });
  }

  async function cancelActiveRequest() {
    if (!runtimeCompatible() || !state.activeRequest?.id) return;
    return runMutation('request-cancel', async () => {
      try {
        await state.api.cancelRequest(state.activeRequest.id);
        state.activeRequest = null;
        state.activeTransaction = null;
        lastRequestError = null;
        setStatus('Revive request cancelled.');
        await refreshActiveRequest();
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'request.cancel', 'Request could not be cancelled.');
      }
    });
  }

  async function deleteReviveRelayAccount() {
    if (!state.sessionToken || !runtimeCompatible()) return;
    const confirmed = window.confirm(
      'Delete ReviveRelay account/data? This immediately removes or invalidates your verification credential, active sessions, service preferences, and active reviver registration where safe. Minimal billing/payment and security/audit evidence may be retained to prevent payment reuse and support refunds or disputes.'
    );
    if (!confirmed) return;
    return runMutation('account-delete', async () => {
      try {
        await state.api.deleteAccount();
        state.api.clearBoundToken();
        invalidateAuthoritativeState('pro');
        invalidateAuthoritativeState('queue');
        invalidateAuthoritativeState('eligibility');
        invalidateAuthoritativeState('invoice');
        state.sessionToken = '';
        state.identity = null;
        state.preset = null;
        state.activeRequest = null;
        state.activeTransaction = null;
        state.verificationCredential = null;
        state.verificationEditing = false;
        state.reviverEligibility = null;
        state.reviverQueue = [];
        state.proStatus = null;
        state.runtime = null;
        state.runtimeCompatibility = 'unknown';
        state.runtimeCompatibilityReason = null;
        state.subscription = null;
        state.proPlans = [];
        state.currentInvoice = null;
        storage.set(KEYS.sessionToken, '');
        storage.set(KEYS.publicIdentity, null);
        storage.set(KEYS.requestPreset, null);
        storage.set(KEYS.seenRequestIds, []);
        storage.set(KEYS.updateState, {});
        storage.set(KEYS.clientDiagnosticsEnabled, false);
        storage.set(KEYS.telemetryOutbox, []);
        setStatus('ReviveRelay account data deletion completed. Minimal billing/security evidence may remain only where required for payment-reuse prevention, refunds, disputes, or audit history.');
        refreshSidebarState();
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'account.delete', 'ReviveRelay account deletion failed.');
      }
    });
  }

  function saveRequestPreset() {
    const method = document.getElementById('rr-preset-method')?.value;
    const rawAmount = document.getElementById('rr-preset-amount')?.value;
    const comment = document.getElementById('rr-preset-comment')?.value ?? '';
    const validation = RequestPreset.validatePreset({
      paymentMethod: method,
      offerAmount: Number(rawAmount),
      comment
    });
    if (!validation.ok) {
      setStatus(`Preset not saved (${validation.error}).`, true);
      return;
    }
    state.preset = validation.preset;
    storage.set(KEYS.requestPreset, validation.preset);
    lastRequestError = null;
    setStatus('Revive Me preset saved.');
    refreshSidebarState();
    renderAll();
  }

  async function startProTrial() {
    if (!runtimeCompatible()) {
      setStatus(runtimeCompatibilityMessage(), true);
      return;
    }
    return runMutation('trial-start', async () => {
      try {
        const result = await state.api.startProTrial();
        invalidateAuthoritativeState('pro');
        state.proStatus = result?.pro || null;
        setStatus('7-day Reviver Pro trial activated.');
        await refreshVerificationCredential();
        await refreshReviverQueue();
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'pro.trial', 'Trial could not be activated.');
      }
    });
  }

  async function createProInvoice() {
    if (!runtimeCompatible()) {
      setStatus(runtimeCompatibilityMessage(), true);
      return;
    }
    if (!subscriptionPaymentsEnabled()) {
      setStatus('Reviver Pro payments are not required in the current subscription mode.');
      return;
    }
    const planId = document.getElementById('rr-pro-plan')?.value;
    const currency = document.getElementById('rr-pro-currency')?.value;
    return runMutation('invoice-create', async () => {
      try {
        const result = await state.api.createProInvoice({ planId, currency });
        invalidateAuthoritativeState('invoice');
        state.currentInvoice = {
          ...(result?.invoice || {}),
          paymentTarget: result?.paymentTarget || null
        };
        setStatus('Pro payment invoice created.');
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'pro.invoice.create', 'Pro invoice could not be created.');
      }
    });
  }

  async function bindVerificationKey() {
    if (!state.sessionToken || !runtimeCompatible()) return;
    const verificationKeyInput = document.getElementById('rr-verification-key');
    const key = String(verificationKeyInput?.value || '').trim();
    if (!key) {
      setStatus('Paste your Torn API key.', true);
      return;
    }
    return runMutation('verification-bind', async () => {
      try {
        const result = await state.api.bindVerificationCredential(key);
        if (verificationKeyInput) verificationKeyInput.value = '';
        state.verificationCredential = result?.credential || null;
        state.verificationEditing = false;
        setStatus('Torn API key connected.');
        await refreshMe();
        await refreshReviverEligibility();
        await refreshReviverQueue();
        renderAll();
      } catch (error) {
        if (verificationKeyInput) verificationKeyInput.value = '';
        handleApiFailure(error, 'verification.bind', 'Torn API key could not be connected.');
      }
    });
  }

  function beginVerificationReplacement() {
    state.verificationEditing = true;
    renderSettingsDrawer();
    setTimeout(() => document.getElementById('rr-verification-key')?.focus(), 0);
  }

  async function revokeVerificationKey() {
    if (!runtimeCompatible()) return;
    return runMutation('verification-revoke', async () => {
      try {
        await state.api.revokeVerificationCredential();
        invalidateAuthoritativeState('queue');
        invalidateAuthoritativeState('eligibility');
        state.verificationCredential = null;
        state.verificationEditing = false;
        state.reviverEligibility = null;
        state.reviverQueue = [];
        setStatus('Torn API key disconnected from ReviveRelay.');
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'verification.revoke', 'Torn API key could not be disconnected.');
      }
    });
  }

  async function registerMarketplaceReviver() {
    if (!hasReviverSubscriptionAccess() || !hasCredentialCapability('reviver') || !hasConfirmedReviveAbility()) return;
    return runMutation('reviver-register', async () => {
      try {
        await state.api.registerReviver();
        await refreshMe();
        await refreshReviverQueue();
        setStatus('Reviver Pro queue access registered.');
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'reviver.register', 'Reviver registration failed.');
      }
    });
  }

  function isValidTornProfileId(value) {
    return /^[1-9][0-9]*$/.test(String(value ?? '').trim());
  }

  function tornProfileNavigationUrl(tornId) {
    return `https://www.torn.com/profiles.php?XID=${encodeURIComponent(String(tornId).trim())}`;
  }

  async function acceptMarketplaceRequest(requestId) {
    if (!hasReviverSubscriptionAccess() || !hasRole('reviver') || !hasCredentialCapability('reviver') || !hasConfirmedReviveAbility()) return;
    const targetRequest = state.reviverQueue.find(request => String(request?.id) === String(requestId));
    const targetTornId = targetRequest?.requesterTornId;
    return runMutation('request-accept', async () => {
      try {
        const result = await state.api.acceptRequest(requestId);
        state.activeTransaction = result?.transaction || null;
        if (isValidTornProfileId(targetTornId)) {
          setStatus('Certified revive request accepted. Opening the requester’s Torn profile…');
          window.location.href = tornProfileNavigationUrl(targetTornId);
          return;
        }
        await refreshReviverQueue();
        setStatus('Certified revive request accepted, but the requester profile could not be opened automatically.', true);
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'reviver.accept', 'Request could not be accepted.');
      }
    });
  }

  async function runTransactionAction(action, decision = null) {
    if (!runtimeCompatible() || !state.activeTransaction?.id) return;
    const id = state.activeTransaction.id;
    try {
      if (action === 'check-payment') await state.api.checkPayment(id);
      else if (action === 'retry-request') await state.api.requestRetry(id);
      else if (action === 'retry-accept') await state.api.respondRetry(id, 'accept');
      else if (action === 'retry-decline') await state.api.respondRetry(id, 'decline');
      else if (action === 'refund-request') await state.api.requestRefund(id);
      else if (action === 'check-refund') await state.api.checkRefund(id);
      else return;
      await refreshActiveTransaction(id);
      setStatus('Transaction state refreshed.');
      renderAll();
    } catch (error) {
      handleApiFailure(error, `transaction.${action}`, 'Transaction action failed.');
    }
  }

  function sidebarState() {
    return RequestPreset.deriveSidebarState({
      sessionToken: state.sessionToken,
      preset: state.preset,
      submitting: state.submittingRequest,
      activeRequest: state.activeRequest,
      lastError: state.sessionToken && !runtimeCompatible() ? 'RUNTIME_INCOMPATIBLE' : lastRequestError
    });
  }

  function refreshSidebarState() {
    syncPdaLauncher();
    if (!state.sidebarController) return;
    try {
      state.sidebarController.setState(sidebarState());
      state.sidebarController.reconcile();
    } catch (error) {
      captureClientError(error, 'sidebar.reconcile');
    }
  }

  function handleSidebarActivate(currentState) {
    if (currentState === 'READY') {
      requestReviveFromSidebar();
      return;
    }
    if (currentState === 'SETUP_REQUIRED') {
      if (state.sessionToken) openSettingsDrawer('preset');
      else activatePanelTab('request');
    } else activatePanelTab('request');
  }

  function transactionDeadlineRows(transaction) {
    if (!transaction) return '';
    const rows = [
      ['Payment', transaction.paymentDeadline],
      ['Revive', transaction.reviveDeadline],
      ['Retry response', transaction.retryResponseDeadline],
      ['Refund', transaction.refundDeadline]
    ].filter(([, value]) => value);
    if (!rows.length) return '';
    return `<div class="rr-deadlines">${rows.map(([label, value]) => `
      <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatCountdown(value))}</strong></div>`).join('')}</div>`;
  }

  function transactionActions(transaction) {
    if (!transaction) return '';
    const role = transaction.participantRole;
    const actions = [];
    if (role === 'requester' && ['WAITING_FOR_PAYMENT', 'PAYMENT_PENDING'].includes(transaction.state)) actions.push(['check-payment', 'Check payment']);
    if (role === 'requester' && transaction.state === 'REVIVE_FAILED') actions.push(['retry-request', 'Request retry'], ['refund-request', 'Request refund']);
    if (role === 'reviver' && transaction.state === 'RETRY_REQUESTED') actions.push(['retry-accept', 'Accept retry'], ['retry-decline', 'Decline retry']);
    if (role === 'requester' && String(transaction.state || '').includes('REFUND')) actions.push(['check-refund', 'Check refund']);
    if (!actions.length) return '';
    return `<div class="rr-actions">${actions.map(([action, label]) => `<button data-rr-tx-action="${action}">${escapeHtml(label)}</button>`).join('')}</div>`;
  }

  function renderTransactionCard(transaction, heading = 'Transaction') {
    if (!transaction) return `<div class="rr-muted">No active transaction.</div>`;
    const terms = transaction.terms || {};
    return `<div class="rr-card rr-transaction-card">
      <div class="rr-card-title">${escapeHtml(heading)}</div>
      <div class="rr-kv"><span>State</span><strong>${escapeHtml(transaction.state || 'Unknown')}</strong></div>
      ${terms.paymentMethod ? `<div class="rr-kv"><span>Terms</span><strong>${escapeHtml(formatOffer(terms.paymentMethod, terms.offerAmount))}</strong></div>` : ''}
      ${transaction.requester ? `<div class="rr-kv"><span>Requester</span><strong>${escapeHtml(transaction.requester.name)} [${escapeHtml(transaction.requester.tornId)}]</strong></div>` : ''}
      ${transaction.reviver ? `<div class="rr-kv"><span>Reviver</span><strong>${escapeHtml(transaction.reviver.name)} [${escapeHtml(transaction.reviver.tornId)}]</strong></div>` : ''}
      ${transactionDeadlineRows(transaction)}
      ${transactionActions(transaction)}
    </div>`;
  }

  function renderOnboarding() {
    return `<div class="rr-card rr-onboarding">
      <div class="rr-card-title">Connect ReviveRelay</div>
      <p>ReviveRelay uses one Torn API key to verify your identity and provide the limited revive, eligibility and payment evidence needed by the service.</p>
      <p class="rr-muted">Recommended: create the Custom Torn API key below. The same key is used for your whole ReviveRelay account, encrypted server-side after connection, and never stored in Tampermonkey.</p>
      <button id="rr-create-api-key" type="button">Create ReviveRelay API Key</button>
      <label class="rr-label" for="rr-api-key">Torn API key</label>
      <input id="rr-api-key" type="password" autocomplete="off" placeholder="Paste Torn API key">
      <button id="rr-connect">Connect ReviveRelay</button>
    </div>`;
  }

  function renderRequestPanel() {
    const target = document.getElementById('rr-requester');
    if (!target) return;
    if (!state.sessionToken || !state.identity) {
      target.innerHTML = renderOnboarding();
      return;
    }
    if (!runtimeCompatible()) {
      target.innerHTML = `<div class="rr-card rr-warning">
        <div class="rr-card-title">Review backend unavailable</div>
        <p>${escapeHtml(runtimeCompatibilityMessage())}</p>
      </div>`;
      return;
    }
    const validation = RequestPreset.validatePreset(state.preset);
    const presetText = validation.ok
      ? `${formatOffer(validation.preset.paymentMethod, validation.preset.offerAmount)}${validation.preset.comment ? ` · “${escapeHtml(validation.preset.comment)}”` : ''}`
      : 'Not configured';
    const request = state.activeRequest;
    const requesterVerification = request && !hasCredentialCapability('requester')
      ? `<div class="rr-warning"><strong>Torn API key update required</strong><p>Your connected Torn API key must include the ReviveRelay permissions required before a reviver can accept this request.</p><button data-rr-open-settings="verification">Update Torn API key</button></div>`
      : '';
    target.innerHTML = `<div class="rr-card">
      <div class="rr-card-title">Revive Me</div>
      <p>Use Torn's left sidebar action <strong>ReviveRelay → Revive Me!</strong> for the one-click certified request.</p>
      <div class="rr-kv"><span>Saved preset</span><strong>${presetText}</strong></div>
      ${validation.ok ? '' : '<button data-rr-open-settings="preset">Configure Revive Me preset</button>'}
    </div>
    <div class="rr-card" id="rr-request-card">
      <div class="rr-card-title">Active certified request</div>
      ${request ? `
        <div class="rr-certified-line"><span class="rr-star">★</span><strong>CERTIFIED REQUEST</strong></div>
        <div class="rr-kv"><span>State</span><strong>${escapeHtml(request.state)}</strong></div>
        <div class="rr-kv"><span>Offer</span><strong>${escapeHtml(formatOffer(request.paymentMethod, request.offerAmount))}</strong></div>
        <div class="rr-kv"><span>Message</span><strong>${escapeHtml(request.comment || '—')}</strong></div>
        <div class="rr-kv"><span>Created</span><strong>${escapeHtml(formatDate(request.createdAt))}</strong></div>
        ${requesterVerification}
        <button id="rr-cancel-request"${disabledAttr('request-cancel')}>Cancel request</button>
      ` : '<div class="rr-muted">No active certified request.</div>'}
    </div>
    ${state.activeTransaction ? renderTransactionCard(state.activeTransaction, 'Your revive transaction') : ''}`;
  }

  function queueViewRequests(requests) {
    const paymentFilter = ['all', 'cash', 'xanax'].includes(state.queuePaymentFilter) ? state.queuePaymentFilter : 'all';
    const minimumCash = Math.max(0, Number(state.queueMinCash) || 0);
    const minimumXanax = Math.max(0, Number(state.queueMinXanax) || 0);
    const sortMode = ['newest', 'oldest', 'offer-desc', 'offer-asc'].includes(state.queueSort) ? state.queueSort : 'newest';
    const timestamp = value => {
      const parsed = new Date(value).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const list = (Array.isArray(requests) ? requests : []).filter(request => {
      const method = request?.paymentMethod;
      if (paymentFilter !== 'all' && method !== paymentFilter) return false;
      const offer = Math.max(0, Number(request?.offerAmount) || 0);
      if (method === 'cash' && offer < minimumCash) return false;
      if (method === 'xanax' && offer < minimumXanax) return false;
      return true;
    });
    const tieBreak = (a, b) => String(a?.id || '').localeCompare(String(b?.id || ''));
    return list.sort((a, b) => {
      if (sortMode === 'oldest') return timestamp(a?.createdAt) - timestamp(b?.createdAt) || tieBreak(a, b);
      if (sortMode === 'offer-desc' || sortMode === 'offer-asc') {
        const methodOrder = String(a?.paymentMethod || '').localeCompare(String(b?.paymentMethod || ''));
        if (methodOrder) return methodOrder;
        const amountOrder = (Number(a?.offerAmount) || 0) - (Number(b?.offerAmount) || 0);
        if (amountOrder) return sortMode === 'offer-desc' ? -amountOrder : amountOrder;
        return timestamp(b?.createdAt) - timestamp(a?.createdAt) || tieBreak(a, b);
      }
      return timestamp(b?.createdAt) - timestamp(a?.createdAt) || tieBreak(a, b);
    });
  }

  function groupQueueRequests(requests) {
    const list = Array.isArray(requests) ? requests : [];
    if (state.queueGroup !== 'payment') return [{ key: 'all', label: 'All requests', requests: list }];
    const definitions = [
      ['cash', 'Cash'],
      ['xanax', 'Xanax'],
      ['other', 'Other']
    ];
    return definitions.map(([key, label]) => ({
      key,
      label,
      requests: list.filter(request => key === 'other'
        ? !['cash', 'xanax'].includes(request?.paymentMethod)
        : request?.paymentMethod === key)
    })).filter(group => group.requests.length > 0);
  }

  function renderCertifiedRequest(request) {
    const certified = request?.certified === true;
    return `<div class="rr-card rr-queue-card ${certified ? 'rr-certified-card' : ''}">
      <div class="rr-queue-head">
        <div><span class="rr-star">${certified ? '★' : ''}</span> <strong>${escapeHtml(request.requesterName || 'Player')}</strong> [${escapeHtml(request.requesterTornId || '?')}]</div>
        ${certified ? '<span class="rr-chip">CERTIFIED REQUEST</span>' : ''}
      </div>
      <div class="rr-offer">${escapeHtml(formatOffer(request.paymentMethod, request.offerAmount))}</div>
      <div class="rr-comment">${escapeHtml(request.comment || 'Revive requested')}</div>
      <div class="rr-muted">${escapeHtml(requestAge(request.createdAt))}</div>
      <button data-rr-accept="${escapeHtml(request.id)}"${disabledAttr('request-accept')}>Accept</button>
    </div>`;
  }

  function renderReviverPanel() {
    const target = document.getElementById('rr-reviver-content');
    if (!target) return;
    if (!state.sessionToken) {
      target.innerHTML = '<div class="rr-card">Connect ReviveRelay first.</div>';
      return;
    }
    if (!runtimeCompatible()) {
      target.innerHTML = `<div class="rr-card rr-warning">
        <div class="rr-card-title">Review backend unavailable</div>
        <p>${escapeHtml(runtimeCompatibilityMessage())}</p>
      </div>`;
      return;
    }
    if (!hasReviverSubscriptionAccess()) {
      target.innerHTML = `<div class="rr-card rr-pro-gate">
        <div class="rr-card-title">Reviver Pro required</div>
        <p>The certified request queue, notifications and Accept are Reviver Pro features.</p>
        ${state.proStatus?.trialEligible ? `<button id="rr-start-trial-inline"${disabledAttr('trial-start')}>Start 7-day Reviver Pro trial</button>` : '<button data-rr-open-pro>Open ReviveRelay Pro</button>'}
      </div>`;
      return;
    }
    if (!hasCredentialCapability('reviver')) {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Torn API key permissions required</div>
        <p>Your Torn API key must include the limited ReviveRelay permissions needed to confirm revives and payments.</p>
        <button data-rr-open-settings="verification">Update Torn API key</button>
      </div>`;
      return;
    }
    const eligibility = state.reviverEligibility;
    if (!eligibility) {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Checking revive ability</div>
        <p>ReviveRelay is confirming that this Torn account has permanently unlocked reviving.</p>
      </div>`;
      return;
    }
    if (eligibility.status === 'PERMISSION_REQUIRED') {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Revive ability could not be verified</div>
        <p>Your connected Torn API key does not include the <strong>Perks</strong> permission needed to confirm revive ability.</p>
        <button data-rr-open-settings="verification">Update Torn API key</button>
      </div>`;
      return;
    }
    if (eligibility.status === 'NOT_UNLOCKED') {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Reviving not unlocked</div>
        <p>This Torn account does not have the permanent revive ability. Reach <strong>Brain Surgeon</strong> in the Medical starter job to permanently unlock reviving.</p>
      </div>`;
      return;
    }
    if (!hasConfirmedReviveAbility()) {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Revive ability could not be verified</div>
        <p>ReviveRelay will not provide reviver queue access until Torn confirms the revive ability.</p>
      </div>`;
      return;
    }
    if (!hasRole('reviver')) {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Register as reviver</div>
        <p>Torn confirmed that this account has the permanent revive ability.</p>
        <button id="rr-register-reviver"${disabledAttr('reviver-register')}>Register as reviver</button>
      </div>`;
      return;
    }
    const visibleRequests = queueViewRequests(state.reviverQueue);
    const groupedRequests = groupQueueRequests(visibleRequests);
    const queueMarkup = visibleRequests.length
      ? groupedRequests.map(group => `${state.queueGroup === 'payment' ? `<div class="rr-queue-group-title">${escapeHtml(group.label)} <span>${group.requests.length}</span></div>` : ''}${group.requests.map(renderCertifiedRequest).join('')}`).join('')
      : '<div class="rr-card rr-muted">No certified requests match the current queue filters.</div>';
    target.innerHTML = `<div class="rr-card">
      <div class="rr-card-title">Certified revive queue</div>
      <div class="rr-muted">${visibleRequests.length} shown of ${state.reviverQueue.length} available request${state.reviverQueue.length === 1 ? '' : 's'}.</div>
      <div class="rr-queue-controls" aria-label="Certified revive queue controls">
        <label>Payment<select id="rr-queue-payment-filter">
          <option value="all" ${state.queuePaymentFilter === 'all' ? 'selected' : ''}>All</option>
          <option value="cash" ${state.queuePaymentFilter === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="xanax" ${state.queuePaymentFilter === 'xanax' ? 'selected' : ''}>Xanax</option>
        </select></label>
        <label>Sort<select id="rr-queue-sort">
          <option value="newest" ${state.queueSort === 'newest' ? 'selected' : ''}>Newest first</option>
          <option value="oldest" ${state.queueSort === 'oldest' ? 'selected' : ''}>Oldest first</option>
          <option value="offer-desc" ${state.queueSort === 'offer-desc' ? 'selected' : ''}>Offer high to low</option>
          <option value="offer-asc" ${state.queueSort === 'offer-asc' ? 'selected' : ''}>Offer low to high</option>
        </select></label>
        <label>Min cash<input id="rr-queue-min-cash" type="number" min="0" step="50000" value="${escapeHtml(state.queueMinCash)}"></label>
        <label>Min Xanax<input id="rr-queue-min-xanax" type="number" min="0" step="1" value="${escapeHtml(state.queueMinXanax)}"></label>
        <label>Group<select id="rr-queue-group">
          <option value="payment" ${state.queueGroup === 'payment' ? 'selected' : ''}>Payment type</option>
          <option value="none" ${state.queueGroup === 'none' ? 'selected' : ''}>No grouping</option>
        </select></label>
        <button id="rr-refresh-queue" type="button">Refresh queue</button>
      </div>
      <p class="rr-muted">Offer sorting is kept within each payment currency so Cash and Xanax are never treated as equivalent units.</p>
    </div>
    <div id="rr-reviver-queue">${queueMarkup}</div>
    <div id="rr-reviver-transaction">${state.activeTransaction?.participantRole === 'reviver' ? renderTransactionCard(state.activeTransaction, 'Accepted revive') : '<div class="rr-muted">No accepted revive transaction.</div>'}</div>`;
  }

  function renderActivityPanel() {
    const target = document.getElementById('rr-activity-ledger');
    if (!target) return;
    target.innerHTML = `<div class="rr-card">
      <div class="rr-card-title">ReviveRelay activity</div>
      <div class="rr-kv"><span>Identity</span><strong>${state.identity ? `${escapeHtml(state.identity.name)} [${escapeHtml(state.identity.tornId)}]` : 'Disconnected'}</strong></div>
      <div class="rr-kv"><span>Request</span><strong>${escapeHtml(state.activeRequest?.state || 'None')}</strong></div>
      <div class="rr-kv"><span>Transaction</span><strong>${escapeHtml(state.activeTransaction?.state || 'None')}</strong></div>
      <div class="rr-kv"><span>Reviver Pro</span><strong>${escapeHtml(state.proStatus?.state || 'NONE')}</strong></div>
      <div class="rr-kv"><span>Queue</span><strong>${state.reviverQueue.length}</strong></div>
      <p class="rr-muted">ReviveRelay uses direct certified requests. No public chat collection is required.</p>
    </div>`;
  }

  function selectedPlanOptions() {
    const plans = Array.isArray(state.subscription?.plans) ? state.subscription.plans : [];
    if (!plans.length) return '<option value="">Plans unavailable</option>';
    return plans.map(plan => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.label)} · ${plan.xanax} Xanax / ${formatMoney(plan.cash)}</option>`).join('');
  }

  function renderInvoice() {
    if (!state.currentInvoice) return '<div class="rr-muted">No open Pro invoice.</div>';
    const invoice = state.currentInvoice;
    const target = invoice.paymentTarget?.tornId;
    const displayState = invoice.state === 'PAID' && state.proStatus?.state === 'ACTIVE'
      ? 'PAID'
      : invoice.state === 'PAID' ? 'VERIFYING' : invoice.state;
    const expired = invoice.state === 'EXPIRED'
      ? '<div class="rr-warning">This invoice has expired. Create a new invoice if you still want Pro time.</div>'
      : '';
    return `<div class="rr-invoice">
      <div class="rr-kv"><span>State</span><strong>${escapeHtml(displayState)}</strong></div>
      <div class="rr-kv"><span>Amount</span><strong>${escapeHtml(formatOffer(invoice.currency, invoice.expectedAmount))}</strong></div>
      <div class="rr-kv"><span>Send to Torn ID</span><strong>${escapeHtml(target || '—')}</strong></div>
      <div class="rr-kv"><span>Expires</span><strong>${escapeHtml(formatDate(invoice.expiresAt))}</strong></div>
      ${expired}
      ${invoice.state === 'PENDING' ? '<button id="rr-refresh-invoice">Check payment status</button>' : ''}
    </div>`;
  }

  function renderVerificationSettings() {
    if (!state.sessionToken) return '<div class="rr-muted">Connect ReviveRelay first.</div>';
    const credential = state.verificationCredential;
    const usable = Boolean(credential?.usable);
    const requester = Boolean(credential?.capabilities?.requester);
    const reviver = Boolean(credential?.capabilities?.reviver);
    const broadAccess = Boolean(credential?.accessScope?.broadAccess);
    const eligibilityStatus = state.reviverEligibility?.status === 'ELIGIBLE'
      ? 'Confirmed'
      : state.reviverEligibility?.status === 'NOT_UNLOCKED'
        ? 'Not unlocked'
        : state.reviverEligibility?.status === 'PERMISSION_REQUIRED'
          ? 'Update key required'
          : state.reviverEligibility?.status === 'TIMEOUT'
            ? 'Check timed out - retry'
            : state.reviverEligibility?.status === 'UNAVAILABLE'
              ? 'Unavailable - retry'
              : reviver ? 'Checking…' : 'Not checked';
    const editing = !credential || state.verificationEditing;
    const keyInput = editing
      ? '<input id="rr-verification-key" type="password" autocomplete="off" placeholder="Paste Torn API key">'
      : `<input id="rr-verification-key" type="password" value="${MASKED_VERIFICATION_KEY}" readonly aria-label="Connected Torn API key (masked)">`;
    const keyAction = editing
      ? `<button id="rr-bind-verification"${disabledAttr('verification-bind')}>${credential ? 'Save replacement Torn API key' : 'Connect Torn API key'}</button>`
      : '<button id="rr-replace-verification" type="button">Replace Torn API key</button>';
    return `<div class="rr-kv"><span>Torn API key</span><strong>${usable ? 'Connected' : 'Not connected'}</strong></div>
      <div class="rr-kv"><span>Requester evidence</span><strong>${requester ? 'Ready' : 'Required before Accept'}</strong></div>
      <div class="rr-kv"><span>Reviver access</span><strong>${reviver ? 'Ready' : 'Not ready'}</strong></div>
      <div class="rr-kv"><span>Revive ability</span><strong>${escapeHtml(eligibilityStatus)}</strong></div>
      ${broadAccess ? '<div class="rr-warning"><strong>Full/Broad Access key accepted.</strong> This Torn API key grants more access than ReviveRelay requires. You can keep using it, or replace it with the recommended Custom Torn API key below.</div>' : ''}
      <p class="rr-muted">ReviveRelay uses one Torn API key for your account. The same key connects your Torn identity and supplies the limited revive, eligibility and payment evidence ReviveRelay needs. It is encrypted server-side and never stored in Tampermonkey.</p>
      ${credential ? '<p class="rr-muted">Disconnecting the stored Torn API key disables ReviveRelay evidence checks. To invalidate the key at Torn as well, delete it in <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener noreferrer">Torn API settings</a>.</p>' : ''}
      <div class="rr-permission-list">
        <strong>Recommended Custom Torn API key</strong>
        <span>Basic</span><span>Profile / hospital status</span><span>Revives</span><span>Perks (revive ability)</span>
        <span>Money incoming</span><span>Money outgoing</span><span>Items incoming</span><span>Items outgoing</span>
      </div>
      <div class="rr-setup-choice">
        <strong>Create the recommended key</strong>
        <p class="rr-muted">This one key covers both requester and reviver use, so you do not need a second key if you use both sides of ReviveRelay.</p>
        <button id="rr-create-api-key" type="button">Create ReviveRelay API Key</button>
      </div>
      <div class="rr-setup-choice">
        <strong>Or use an existing Torn API key</strong>
        <p class="rr-muted">A Full Access or broader custom key is accepted if it belongs to this Torn account and contains the required permissions, but the restricted Custom key above is recommended.</p>
        <label class="rr-label" for="rr-verification-key">Torn API key</label>
        ${keyInput}
        <div class="rr-actions">
          ${keyAction}
          ${credential ? `<button id="rr-revoke-verification"${disabledAttr('verification-revoke')}>Disconnect Torn API key</button>` : ''}
        </div>
      </div>`;
  }

  function renderProPanel() {
    const target = document.getElementById('rr-pro-content');
    if (!target) return;
    if (state.sessionToken && !runtimeCompatible()) {
      target.innerHTML = `<div class="rr-card rr-warning">
        <div class="rr-card-title">Review backend unavailable</div>
        <p>${escapeHtml(runtimeCompatibilityMessage())}</p>
        <p class="rr-muted">Trial, subscription, queue and Accept controls remain disabled until a compatible review runtime is confirmed.</p>
      </div>`;
      return;
    }
    const mode = subscriptionMode();
    const proState = state.proStatus?.state || 'NONE';
    const merchantName = state.subscription?.merchant?.name || 'Configured ReviveRelay merchant';
    const merchantTornId = state.subscription?.merchant?.tornId || null;
    const ownerAccess = proState === 'OWNER'
      ? `<div class="rr-owner-pro">
          <div class="rr-kv"><span>Reviver Pro</span><strong>Reviver Pro: OWNER</strong></div>
          <div class="rr-kv"><span>Access</span><strong>Access: Lifetime</strong></div>
          <div class="rr-kv"><span>Account</span><strong>Payment recipient account</strong></div>
        </div>`
      : '';
    const trialButton = proState !== 'OWNER' && mode !== 'free' && state.sessionToken && state.proStatus?.trialEligible
      ? `<button id="rr-start-trial"${disabledAttr('trial-start')}>Start 7-day Reviver Pro trial</button>` : '';
    const subscriptionBody = proState === 'OWNER'
      ? `<p class="rr-muted">Lifetime Reviver Pro access is included for the configured payment recipient. No trial or subscription payment is required.</p>`
      : mode === 'free'
        ? `<p class="rr-muted">Reviver access is currently free. No Pro payment is required while ReviveRelay is in free mode.</p>`
        : state.sessionToken && subscriptionPaymentsEnabled()
          ? `<div class="rr-kv"><span>Payment recipient</span><strong>${escapeHtml(merchantName)}${merchantTornId ? ` [${escapeHtml(merchantTornId)}]` : ''}</strong></div>
            <p class="rr-muted">Send payment manually in Torn after creating an invoice. ReviveRelay never sends cash or items for you.</p>
            <div class="rr-form-row">
              <select id="rr-pro-plan">${selectedPlanOptions()}</select>
              <select id="rr-pro-currency"><option value="xanax">Xanax</option><option value="cash">Torn cash</option></select>
              <button id="rr-create-pro-invoice"${disabledAttr('invoice-create')}>Create Pro invoice</button>
            </div><div id="rr-invoice-status">${renderInvoice()}</div>`
          : '<div class="rr-muted">Connect ReviveRelay to view Pro plans.</div>';
    target.innerHTML = `<div class="rr-card" id="rr-pro-settings">
      <div class="rr-card-title">ReviveRelay Pro</div>
      <p>Pro unlocks the certified reviver queue, request notifications and Accept controls when paid access is required.</p>
      <div class="rr-kv"><span>Mode</span><strong>${escapeHtml(mode)}</strong></div>
      <div class="rr-kv"><span>Status</span><strong id="rr-pro-state">${escapeHtml(proState)}</strong></div>
      <div class="rr-kv"><span>Valid until</span><strong id="rr-pro-valid-until">${escapeHtml(proState === 'OWNER' ? 'Lifetime' : (state.proStatus?.validUntil ? formatDate(state.proStatus.validUntil) : '—'))}</strong></div>
      ${ownerAccess}
      ${trialButton}
    </div>
    <div class="rr-card">
      <div class="rr-card-title">Subscription</div>
      ${subscriptionBody}
    </div>`;
  }

  function renderProStatus() {
    const stateTarget = document.getElementById('rr-pro-state');
    const validTarget = document.getElementById('rr-pro-valid-until');
    if (stateTarget) stateTarget.textContent = state.proStatus?.state || 'NONE';
    if (validTarget) validTarget.textContent = state.proStatus?.state === 'OWNER'
      ? 'Lifetime'
      : state.proStatus?.validUntil ? formatDate(state.proStatus.validUntil) : '—';
  }

  function renderSettingsDrawer() {
    const target = document.getElementById('rr-settings-drawer-content');
    if (!target) return;
    const validation = RequestPreset.validatePreset(state.preset);
    const preset = validation.ok ? validation.preset : { paymentMethod: 'cash', offerAmount: 500000, comment: '' };
    const requesterNeedsVerification = Boolean(state.activeRequest && !hasCredentialCapability('requester'));
    const reviverNeedsVerification = Boolean(hasRole('reviver') && hasReviverSubscriptionAccess() && !hasCredentialCapability('reviver'));
    const requestedSection = state.settingsSection;
    const presetOpen = !requestedSection || requestedSection === 'preset' ? ' open' : '';
    const verificationOpen = requestedSection === 'verification'
      || (!requestedSection && state.sessionToken && (requesterNeedsVerification || reviverNeedsVerification))
      ? ' open' : '';
    target.innerHTML = `<div class="rr-settings-heading">
      <div><strong>Settings</strong><span>Keep the everyday stuff simple. Advanced controls stay out of the way.</span></div>
      <button id="rr-settings-close" type="button" aria-label="Close ReviveRelay settings">Close</button>
    </div>
    <details class="rr-settings-section"${presetOpen}>
      <summary>Revive Me preset</summary>
      <div class="rr-settings-body">
        <p>This powers the red <strong>ReviveRelay → Revive Me!</strong> sidebar button.</p>
        <label class="rr-label" for="rr-preset-method">Payment</label>
        <select id="rr-preset-method">
          <option value="cash" ${preset.paymentMethod === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="xanax" ${preset.paymentMethod === 'xanax' ? 'selected' : ''}>Xanax</option>
        </select>
        <label class="rr-label" for="rr-preset-amount">Amount</label>
        <input id="rr-preset-amount" type="number" min="1" step="1" value="${escapeHtml(preset.offerAmount)}">
        <div class="rr-muted">Minimum: $500,000 Cash or 1 Xanax.</div>
        <label class="rr-label" for="rr-preset-comment">Default message</label>
        <textarea id="rr-preset-comment" maxlength="500" rows="2">${escapeHtml(preset.comment || '')}</textarea>
        <button id="rr-save-preset">Save Revive Me preset</button>
      </div>
    </details>
    <details class="rr-settings-section"${verificationOpen}>
      <summary>Torn API Key</summary>
      <div class="rr-settings-body">${renderVerificationSettings()}</div>
    </details>
    <details class="rr-settings-section">
      <summary>Notifications</summary>
      <div class="rr-settings-body">
        <label><input id="rr-desktop-notifications-enabled" type="checkbox" ${desktopNotificationsEnabled() ? 'checked' : ''}> Desktop notifications for new certified requests</label>
        <p class="rr-muted">Notifications are on by default while Reviver Pro is active and your reviver setup is complete. Turning them off does not affect the live queue or Accept controls.</p>
        <p class="rr-muted">ReviveRelay never auto-accepts a request.</p>
      </div>
    </details>
    <details class="rr-settings-section">
      <summary>Account</summary>
      <div class="rr-settings-body">
        <div class="rr-kv"><span>Connection</span><strong>${state.sessionToken ? 'Connected' : 'Disconnected'}</strong></div>
        <div class="rr-actions"><button id="rr-refresh">Refresh</button>${state.sessionToken ? '<button id="rr-disconnect">Disconnect</button>' : ''}</div>
      </div>
    </details>
    <details class="rr-settings-section">
      <summary>Updates</summary>
      <div class="rr-settings-body">
        <div class="rr-kv"><span>Current</span><strong id="rr-update-current">${escapeHtml(VERSION)}</strong></div>
        <div class="rr-kv"><span>Channel</span><strong id="rr-update-channel">${escapeHtml(UPDATE_CHANNEL)}</strong></div>
        <div class="rr-kv"><span>Latest</span><strong id="rr-update-latest">${escapeHtml(updateResult?.latestVersion || 'Unknown')}</strong></div>
        <div class="rr-kv"><span>Checked</span><strong id="rr-update-checked">${escapeHtml(updateResult?.lastCheckedAt ? formatDate(updateResult.lastCheckedAt) : 'Not yet')}</strong></div>
        <div id="rr-update-banner">${updateResult?.updateAvailable ? `Update ${escapeHtml(updateResult.latestVersion)} available.` : ''}</div>
        <p class="rr-muted">ReviveRelay checks the Voidsmith distribution feed at most once every 12 hours while Torn is running. Check updates validates the feed and, when a newer build exists, opens the trusted Voidsmith installer so Tampermonkey or TornPDA can perform the update.</p>
        <div class="rr-actions"><button id="rr-update-check">Check &amp; install update</button>${updateResult?.updateAvailable ? '<button id="rr-update-open">Install update</button>' : ''}</div>
      </div>
    </details>
    <details class="rr-settings-section">
      <summary>About &amp; Privacy</summary>
      <div class="rr-settings-body">
        <div class="rr-kv"><span>Version</span><strong>${escapeHtml(VERSION)}</strong></div>
        <div class="rr-kv"><span>Release channel</span><strong>${escapeHtml(UPDATE_CHANNEL)}</strong></div>
        <div class="rr-kv"><span>Payment recipient</span><strong>${escapeHtml(state.subscription?.merchant?.name || 'Not configured')}${state.subscription?.merchant?.tornId ? ` [${escapeHtml(state.subscription.merchant.tornId)}]` : ''}</strong></div>
        <p><strong>Torn API purpose.</strong> ReviveRelay uses Torn API data only to bind identity, verify reviver eligibility/revives and transaction or payment evidence, prevent abuse, and manage entitlement. No Torn password is requested.</p>
        <p><strong>Data stored.</strong> ReviveRelay stores the service data needed for your account, certified revive workflow, entitlement and limited security/audit history. Your Torn API key is encrypted at rest; plaintext credentials are never returned after connection and credentials are not sold or shared with advertisers or unrelated third parties.</p>
        <p><strong>Recommended permissions.</strong> Use one Custom Torn API key with Basic, Profile, Revives, Perks, and the restricted Money/Items incoming and outgoing log categories used for payment/refund evidence. A Broad/Full Access key may work, but grants more access than ReviveRelay needs.</p>
        <p><strong>Subscription terms.</strong> Requester access is free. Where Reviver Pro payments are enabled, subscriptions are prepaid and payment is sent manually in Torn to the server-listed Payment recipient. ReviveRelay never sends payment for you.</p>
        <p><strong>Diagnostics consent.</strong> Sanitized diagnostics are off by default and are sent only when you enable the Diagnostics option.</p>
        <p><strong>Revoke the Torn API key.</strong> Disconnect the stored key above, then delete the same key in Torn API settings if you want Torn to invalidate it completely.</p>
        <p><a href="https://github.com/R4G3RUNN3R/torn-revive-chat-collector/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer">Privacy document (PRIVACY.md)</a> · <a href="https://github.com/R4G3RUNN3R/torn-revive-chat-collector/tree/main/docs/review" target="_blank" rel="noopener noreferrer">Torn review documentation (docs/review)</a></p>
        ${state.sessionToken ? `<div class="rr-warning"><strong>Delete ReviveRelay account/data</strong><p>Operational account data is removed or invalidated immediately where safe. Minimal billing/payment and security/audit evidence may be retained to prevent payment evidence reuse and support refunds or disputes.</p><button id="rr-delete-account"${disabledAttr('account-delete')}>Delete ReviveRelay account/data</button></div>` : ''}
      </div>
    </details>
    <details class="rr-settings-section">
      <summary>Diagnostics / Advanced</summary>
      <div class="rr-settings-body">
        <label><input id="rr-diagnostics-enabled" type="checkbox" ${storage.get(KEYS.clientDiagnosticsEnabled, false) ? 'checked' : ''}> Send sanitized ReviveRelay error diagnostics</label>
        <p class="rr-muted">Diagnostics exclude API keys, bearer tokens, payment receiver credentials and public chat content.</p>
      </div>
    </details>`;
  }

  function renderSummary() {
    if (!panel) return;
    const requestSummary = panel.querySelector('#rr-summary-request');
    const proSummary = panel.querySelector('#rr-summary-pro');
    const queueSummary = panel.querySelector('#rr-summary-queue');
    if (requestSummary) requestSummary.textContent = state.activeRequest?.state || 'None';
    if (proSummary) proSummary.textContent = state.proStatus?.state || 'FREE';
    if (queueSummary) queueSummary.textContent = String(state.reviverQueue.length);
    if (connectionPill) {
      connectionPill.textContent = state.sessionToken ? 'CONNECTED' : 'OFFLINE';
      connectionPill.classList.toggle('rr-connected', Boolean(state.sessionToken));
    }
  }

  function renderInvoiceStatus() {
    const target = document.getElementById('rr-invoice-status');
    if (target) target.innerHTML = renderInvoice();
  }

  function renderLiveState() {
    if (!panel) return;
    renderSummary();
    renderRequestPanel();
    renderReviverPanel();
    renderActivityPanel();
    renderProStatus();
    renderInvoiceStatus();
    renderStatus();
    updateTabVisibility();
  }

  function renderAll() {
    if (!panel) return;
    renderLiveState();
    renderProPanel();
    renderSettingsDrawer();
    updateTabVisibility();
  }

  function updateTabVisibility() {
    if (!panel) return;
    const drawer = panel.querySelector('#rr-settings-drawer');
    const gear = panel.querySelector('#rr-settings-toggle');
    for (const button of panel.querySelectorAll('[data-rr-tab]')) {
      const selected = !state.settingsOpen && button.dataset.rrTab === state.panelTab;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.classList.toggle('rr-tab-active', selected);
    }
    for (const section of panel.querySelectorAll('[data-rr-panel]')) {
      const selected = !state.settingsOpen && section.dataset.rrPanel === state.panelTab;
      section.classList.toggle('rr-panel-active', selected);
      section.setAttribute('aria-hidden', selected ? 'false' : 'true');
    }
    if (drawer) {
      drawer.classList.toggle('rr-settings-open', state.settingsOpen);
      drawer.setAttribute('aria-hidden', state.settingsOpen ? 'false' : 'true');
    }
    if (gear) gear.setAttribute('aria-expanded', state.settingsOpen ? 'true' : 'false');
  }

  function openSettingsDrawer(section = null) {
    state.settingsSection = ['preset', 'verification'].includes(section) ? section : null;
    if (state.minimized) {
      state.minimized = false;
      storage.set(KEYS.minimized, state.minimized);
      if (panel) panel.style.display = '';
      refreshSidebarState();
    }
    state.settingsOpen = true;
    renderSettingsDrawer();
    updateTabVisibility();
  }

  function toggleSettingsDrawer() {
    const opening = !state.settingsOpen;
    if (opening) state.settingsSection = null;
    if (opening && state.minimized) {
      state.minimized = false;
      storage.set(KEYS.minimized, state.minimized);
      if (panel) panel.style.display = '';
      refreshSidebarState();
    }
    state.settingsOpen = opening;
    if (state.settingsOpen) renderSettingsDrawer();
    updateTabVisibility();
  }

  function activatePanelTab(tab) {
    state.settingsOpen = false;
    state.panelTab = Core.normalizePanelTab(tab);
    storage.set(KEYS.panelTab, state.panelTab);
    if (state.minimized) {
      state.minimized = false;
      storage.set(KEYS.minimized, state.minimized);
      if (panel) panel.style.display = state.minimized ? 'none' : '';
      refreshSidebarState();
    }
    updateTabVisibility();
    renderAll();
  }

  function panelViewport() {
    return { width: window.innerWidth || 0, height: window.innerHeight || 0 };
  }

  function panelSize() {
    if (!panel) return { width: 420, height: 560 };
    const rect = panel.getBoundingClientRect();
    return { width: rect.width || 420, height: rect.height || 560 };
  }

  function applyPanelPosition(position = state.panelPosition) {
    if (!panel) return;
    if (platform.runtime.isTornPda) {
      state.panelPosition = null;
      panel.style.left = '6px';
      panel.style.right = '6px';
      panel.style.top = 'max(6px, env(safe-area-inset-top, 0px))';
      panel.style.bottom = 'max(6px, env(safe-area-inset-bottom, 0px))';
      return;
    }
    const fallback = { x: Math.max(8, (window.innerWidth || 1200) - 438), y: 90 };
    const next = Core.clampPanelPosition(position || fallback, panelViewport(), panelSize(), 8);
    state.panelPosition = next;
    panel.style.left = `${Math.round(next.x)}px`;
    panel.style.top = `${Math.round(next.y)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function persistPanelPosition() {
    if (!state.panelPosition) return;
    storage.set(KEYS.panelPosition, state.panelPosition);
  }

  function resetPanelPosition() {
    state.panelPosition = null;
    storage.set(KEYS.panelPosition, null);
    applyPanelPosition(null);
    persistPanelPosition();
  }

  function installPanelDrag(header) {
    if (platform.runtime.isTornPda) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origin = null;
    header.addEventListener('pointerdown', event => {
      if (event.target?.closest?.('button,input,select,textarea,a')) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      origin = state.panelPosition || { x: panel.offsetLeft, y: panel.offsetTop };
      try { header.setPointerCapture(event.pointerId); } catch (_) {}
    });
    header.addEventListener('pointermove', event => {
      if (!dragging || !origin) return;
      const desired = { x: origin.x + (event.clientX - startX), y: origin.y + (event.clientY - startY) };
      state.panelPosition = Core.clampPanelPosition(desired, panelViewport(), panelSize(), 8);
      applyPanelPosition(state.panelPosition);
    });
    const finishDrag = event => {
      if (!dragging) return;
      dragging = false;
      try { header.releasePointerCapture(event.pointerId); } catch (_) {}
      persistPanelPosition();
    };
    header.addEventListener('pointerup', finishDrag);
    header.addEventListener('pointercancel', finishDrag);
    header.addEventListener('dblclick', event => {
      if (event.target?.closest?.('button,input,select,textarea,a')) return;
      resetPanelPosition();
    });
  }

  async function checkUpdates(force = false) {
    updateResult = await state.updateManager.check({ force });
    if (updateResult?.updateAvailable && !updateResult.skipped && !updateResult.error) {
      if (force) {
        if (state.updateManager.openUpdate()) {
          setStatus(`ReviveRelay ${updateResult.latestVersion} verified. Opening the installer now.`);
        } else {
          setStatus('The update was verified, but ReviveRelay could not open the trusted installer. Use Install update to retry.', true);
        }
      } else {
        setStatus(`ReviveRelay ${updateResult.latestVersion} update available. Open Settings → Updates to install it.`);
      }
    } else if (force && updateResult?.error) {
      setStatus('Update check failed. A previously detected update, if shown below, can still be retried manually.', true);
    } else if (force) {
      setStatus('ReviveRelay is already up to date.');
    }
    if (force || state.settingsOpen) renderSettingsDrawer();
  }

  function openAvailableUpdate() {
    if (!state.updateManager.openUpdate()) setStatus('No validated ReviveRelay update is available for this release channel.', true);
  }

  function restorePanelFromPdaLauncher() {
    state.minimized = false;
    storage.set(KEYS.minimized, false);
    if (panel) panel.style.display = '';
    applyPanelPosition(state.panelPosition);
    refreshSidebarState();
    renderAll();
  }

  function syncPdaLauncher() {
    if (!platform.runtime.isTornPda || !document.body) return null;
    if (!pdaLauncher || !pdaLauncher.isConnected) {
      pdaLauncher = document.getElementById('rr-pda-launcher');
      if (!pdaLauncher) {
        pdaLauncher = document.createElement('button');
        pdaLauncher.id = 'rr-pda-launcher';
        pdaLauncher.type = 'button';
        pdaLauncher.textContent = 'RR';
        pdaLauncher.setAttribute('aria-label', 'Open ReviveRelay');
        pdaLauncher.setAttribute('title', 'Open ReviveRelay');
        pdaLauncher.addEventListener('click', restorePanelFromPdaLauncher);
        document.body.appendChild(pdaLauncher);
      }
    }
    const shouldShow = Boolean(state.minimized);
    pdaLauncher.style.display = shouldShow ? 'inline-flex' : 'none';
    pdaLauncher.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    return pdaLauncher;
  }

  function createPanel() {
    platform.addStyle(`
      #rr-panel{position:fixed;z-index:999999;width:min(420px,calc(100vw - 16px));max-height:calc(100vh - 16px);background:#11161b;color:#d9e0e6;border:1px solid #3e4851;border-radius:9px;box-shadow:0 14px 40px rgba(0,0,0,.45);font:12px/1.45 Arial,sans-serif;overflow:hidden}
      #rr-header{display:flex;align-items:center;gap:9px;padding:9px 10px;background:#171d23;border-bottom:1px solid #343d45;cursor:move;user-select:none}
      .rr-brand{font-weight:800;letter-spacing:.06em}.rr-brand small{display:block;font-size:9px;color:#7f8b95;font-weight:500}.rr-spacer{flex:1}
      #rr-connection-pill{font-size:9px;padding:2px 6px;border-radius:8px;background:#3a2424;color:#eaa}.rr-connected{background:#21382d!important;color:#9ed8b6!important}
      #rr-settings-toggle,#rr-minimize{border:1px solid #46515b;background:#20272e;color:#d9e0e6;border-radius:5px;padding:2px 7px;cursor:pointer}
      #rr-settings-toggle{font-size:14px;line-height:1.2;padding:3px 7px}
      #rr-body{overflow:auto;max-height:calc(100vh - 58px)}.rr-tabs{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #303840;background:#12171c}
      .rr-tabs button{border:0;border-right:1px solid #2a3239;background:transparent;color:#87939d;padding:8px 4px;font:inherit}.rr-tabs button:last-child{border-right:0}.rr-tabs .rr-tab-active{color:#f0f4f7;background:#1d252c}
      .rr-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#303840}.rr-summary>div{background:#151b20;padding:7px;text-align:center}.rr-summary span{display:block;color:#76838d;font-size:9px}.rr-summary strong{font-size:11px}
      .rr-panel-content{display:none!important;padding:8px}.rr-panel-content.rr-panel-active{display:block!important}.rr-card{background:#171d22;border:1px solid #303a42;border-radius:7px;padding:9px;margin-bottom:8px}.rr-card-title{font-weight:800;margin-bottom:6px;color:#eef2f5}
      .rr-settings-drawer{display:none;padding:8px}.rr-settings-drawer.rr-settings-open{display:block}.rr-settings-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 1px 8px}.rr-settings-heading strong{display:block;font-size:13px}.rr-settings-heading span{display:block;color:#7f8b95;font-size:9px;margin-top:2px}.rr-settings-heading button{border:1px solid #48545e;background:#242d34;color:#e6ebee;border-radius:5px;padding:4px 7px;cursor:pointer}
      .rr-settings-section{background:#171d22;border:1px solid #303a42;border-radius:7px;margin-bottom:7px;overflow:hidden}.rr-settings-section>summary{cursor:pointer;list-style:none;padding:9px;font-weight:800;color:#eef2f5}.rr-settings-section>summary::-webkit-details-marker{display:none}.rr-settings-section>summary:after{content:'+';float:right;color:#7f8b95}.rr-settings-section[open]>summary:after{content:'−'}.rr-settings-body{padding:0 9px 9px;border-top:1px solid #283139}.rr-settings-body p{margin:8px 0}.rr-permission-list{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:8px 0;padding:7px;border:1px solid #303a42;border-radius:5px;background:#11161b}.rr-permission-list strong{grid-column:1/-1}.rr-permission-list span{font-size:10px;color:#aeb8c0}.rr-setup-choice{margin-top:9px;padding-top:9px;border-top:1px solid #303a42}.rr-warning{margin:8px 0;padding:7px;border:1px solid #806c3b;border-radius:5px;background:#2a2416;color:#dbc783}
      .rr-kv{display:flex;justify-content:space-between;gap:12px;padding:3px 0}.rr-kv span{color:#85919b}.rr-kv strong{text-align:right}.rr-muted{color:#798690;font-size:10px}.rr-status{padding:6px 9px;color:#8fa9ba;border-top:1px solid #303840;min-height:16px}.rr-status-error{color:#e4a1a1}
      .rr-actions,.rr-form-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.rr-label{display:block;color:#9aa6af;margin:7px 0 3px}.rr-card input,.rr-card select,.rr-card textarea,.rr-settings-section input,.rr-settings-section select,.rr-settings-section textarea{box-sizing:border-box;width:100%;border:1px solid #3a4650;background:#0f1418;color:#e0e5e9;border-radius:5px;padding:6px;font:inherit}.rr-card button,.rr-settings-section button{border:1px solid #48545e;background:#242d34;color:#e6ebee;border-radius:5px;padding:5px 8px;font:inherit;cursor:pointer}.rr-card button:disabled,.rr-settings-section button:disabled{opacity:.45;cursor:not-allowed}
      .rr-certified-card{border-color:#806c3b;box-shadow:inset 3px 0 0 #b89a52}.rr-certified-line,.rr-queue-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.rr-star{color:#d5b461}.rr-chip{font-size:8px;border:1px solid #88743e;color:#d9bc72;border-radius:8px;padding:1px 5px}.rr-offer{font-size:15px;font-weight:800;margin-top:7px}.rr-comment{margin:4px 0;color:#bcc5cc}.rr-deadlines{margin-top:6px}.rr-deadlines>div{display:flex;justify-content:space-between;color:#8e9aa3}.rr-invoice{margin-top:7px;padding-top:7px;border-top:1px solid #313a42}
      .rr-queue-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}.rr-queue-controls label{font-size:9px;color:#89959e}.rr-queue-controls select,.rr-queue-controls input{margin-top:2px}.rr-queue-controls button{align-self:end}.rr-queue-group-title{display:flex;justify-content:space-between;align-items:center;margin:10px 2px 6px;color:#b7c1c8;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.rr-queue-group-title span{color:#74818b}
      #rr-pda-launcher{position:fixed;z-index:1000002;right:calc(10px + env(safe-area-inset-right,0px));bottom:calc(10px + env(safe-area-inset-bottom,0px));width:48px;height:48px;align-items:center;justify-content:center;border:1px solid #e06565;border-radius:50%;background:#a4161a;color:#fff;font:800 12px/1 Arial,sans-serif;letter-spacing:.05em;box-shadow:0 8px 24px rgba(0,0,0,.5);touch-action:manipulation}
      .rr-pda-toast-stack{position:fixed;z-index:1000001;left:calc(10px + env(safe-area-inset-left,0px));right:calc(10px + env(safe-area-inset-right,0px));bottom:calc(10px + env(safe-area-inset-bottom,0px));display:grid;gap:6px;max-height:50dvh;overflow:auto}.rr-pda-toast{position:relative;width:100%;display:grid;gap:2px;text-align:left;border:1px solid #66727c;background:#151c22;color:#eef2f5;border-radius:9px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.5);font:12px/1.4 Arial,sans-serif}.rr-pda-toast strong{font-size:12px}.rr-pda-toast span{color:#b7c1c8}#rr-panel.rr-tornpda{width:auto;max-height:none;display:flex;flex-direction:column}#rr-panel.rr-tornpda button,#rr-panel.rr-tornpda input:not([type=checkbox]):not([type=radio]),#rr-panel.rr-tornpda select{min-height:44px}#rr-panel.rr-tornpda input[type=text],#rr-panel.rr-tornpda input[type=password],#rr-panel.rr-tornpda input[type=number],#rr-panel.rr-tornpda textarea,#rr-panel.rr-tornpda select{font-size:16px}#rr-panel.rr-tornpda #rr-header{cursor:default;touch-action:auto}#rr-panel.rr-tornpda #rr-body{max-height:none;min-height:0;flex:1;overscroll-behavior:contain}@media(max-width:520px){#rr-panel{width:calc(100vw - 16px)}#rr-panel.rr-tornpda{width:auto}.rr-tabs button{font-size:10px}.rr-queue-controls{grid-template-columns:1fr}}
    `);

    panel = document.createElement('section');
    panel.id = 'rr-panel';
    if (platform.runtime.isTornPda) panel.classList.add('rr-tornpda');
    panel.innerHTML = `<div id="rr-header">
      <div class="rr-brand">REVIVERELAY<small>VOIDsMITH INDUSTRIES · v${escapeHtml(VERSION)}</small></div>
      <div class="rr-spacer"></div>
      <span id="rr-connection-pill">OFFLINE</span>
      <button id="rr-settings-toggle" type="button" aria-label="Open ReviveRelay settings" aria-expanded="false">⚙</button>
      <button id="rr-minimize" type="button" aria-label="Minimize ReviveRelay">▾</button>
    </div>
    <div id="rr-body">
      <div class="rr-tabs" role="tablist">
        <button data-rr-tab="request" role="tab" aria-selected="false">Request</button>
        <button data-rr-tab="reviver" role="tab" aria-selected="false">Reviver</button>
        <button data-rr-tab="activity" role="tab" aria-selected="false">Activity</button>
        <button data-rr-tab="settings" role="tab" aria-selected="false">Pro</button>
      </div>
      <div class="rr-summary">
        <div><span>REQUEST</span><strong id="rr-summary-request">None</strong></div>
        <div><span>ACCESS</span><strong id="rr-summary-pro">FREE</strong></div>
        <div><span>QUEUE</span><strong id="rr-summary-queue">0</strong></div>
      </div>
      <section class="rr-panel-content" data-rr-panel="request"><div id="rr-requester"></div></section>
      <section class="rr-panel-content" data-rr-panel="reviver"><div id="rr-reviver-content"></div></section>
      <section class="rr-panel-content" data-rr-panel="activity"><div id="rr-activity-ledger"></div></section>
      <section class="rr-panel-content" data-rr-panel="settings"><div id="rr-pro-content"></div></section>
      <section id="rr-settings-drawer" class="rr-settings-drawer" aria-hidden="true"><div id="rr-settings-drawer-content"></div></section>
      <div id="rr-status" class="rr-status"></div>
    </div>`;
    document.body.appendChild(panel);
    body = panel.querySelector('#rr-body');
    connectionPill = panel.querySelector('#rr-connection-pill');
    panel.style.display = state.minimized ? 'none' : '';
    installPanelDrag(panel.querySelector('#rr-header'));
    applyPanelPosition(state.panelPosition);
    syncPdaLauncher();

    panel.addEventListener('click', event => {
      const target = event.target;
      const tab = target.closest?.('[data-rr-tab]');
      if (tab) return activatePanelTab(tab.dataset.rrTab);
      const accept = target.closest?.('[data-rr-accept]');
      if (accept) return acceptMarketplaceRequest(accept.dataset.rrAccept);
      const tx = target.closest?.('[data-rr-tx-action]');
      if (tx) return runTransactionAction(tx.dataset.rrTxAction);
      const settingsTarget = target.closest?.('[data-rr-open-settings]');
      if (settingsTarget) return openSettingsDrawer(settingsTarget.dataset.rrOpenSettings);
      if (target.closest?.('[data-rr-open-pro]')) return activatePanelTab('settings');
      if (target.id === 'rr-settings-toggle') return toggleSettingsDrawer();
      if (target.id === 'rr-settings-close') { state.settingsOpen = false; state.settingsSection = null; updateTabVisibility(); return; }
      if (target.id === 'rr-connect') return connectIdentity();
      if (target.id === 'rr-cancel-request') return cancelActiveRequest();
      if (target.id === 'rr-save-preset') return saveRequestPreset();
      if (target.id === 'rr-start-trial' || target.id === 'rr-start-trial-inline') return startProTrial();
      if (target.id === 'rr-create-pro-invoice') return createProInvoice();
      if (target.id === 'rr-refresh-invoice') return refreshCurrentInvoice().then(renderLiveState).catch(error => handleApiFailure(error, 'pro.invoice.refresh'));
      if (target.id === 'rr-create-api-key') return platform.openUrl(REVIVERELAY_API_KEY_URL);
      if (target.id === 'rr-replace-verification') return beginVerificationReplacement();
      if (target.id === 'rr-bind-verification') return bindVerificationKey();
      if (target.id === 'rr-revoke-verification') return revokeVerificationKey();
      if (target.id === 'rr-register-reviver') return registerMarketplaceReviver();
      if (target.id === 'rr-refresh-queue') return refreshReviverQueue().then(renderLiveState).catch(error => handleApiFailure(error, 'queue.manual', 'Queue refresh failed.'));
      if (target.id === 'rr-refresh') return refreshMarketplaceState({ includePlans: true }).then(renderAll).catch(error => handleApiFailure(error, 'manual.refresh'));
      if (target.id === 'rr-disconnect') return clearSession();
      if (target.id === 'rr-delete-account') return deleteReviveRelayAccount();
      if (target.id === 'rr-update-check') return checkUpdates(true);
      if (target.id === 'rr-update-open') return openAvailableUpdate();
      if (target.id === 'rr-minimize') {
        state.minimized = !state.minimized;
        storage.set(KEYS.minimized, state.minimized);
        panel.style.display = state.minimized ? 'none' : '';
        applyPanelPosition(state.panelPosition);
        refreshSidebarState();
      }
    });

    panel.addEventListener('change', event => {
      if (event.target?.id === 'rr-desktop-notifications-enabled') {
        storage.set(KEYS.desktopNotificationsEnabled, Boolean(event.target.checked));
      }
      if (event.target?.id === 'rr-diagnostics-enabled') {
        storage.set(KEYS.clientDiagnosticsEnabled, Boolean(event.target.checked));
      }
      if (event.target?.id === 'rr-queue-payment-filter') {
        state.queuePaymentFilter = ['all', 'cash', 'xanax'].includes(event.target.value) ? event.target.value : 'all';
        renderReviverPanel();
      }
      if (event.target?.id === 'rr-queue-sort') {
        state.queueSort = ['newest', 'oldest', 'offer-desc', 'offer-asc'].includes(event.target.value) ? event.target.value : 'newest';
        renderReviverPanel();
      }
      if (event.target?.id === 'rr-queue-group') {
        state.queueGroup = event.target.value === 'none' ? 'none' : 'payment';
        renderReviverPanel();
      }
      if (event.target?.id === 'rr-queue-min-cash') {
        state.queueMinCash = Math.max(0, Number(event.target.value) || 0);
        renderReviverPanel();
      }
      if (event.target?.id === 'rr-queue-min-xanax') {
        state.queueMinXanax = Math.max(0, Number(event.target.value) || 0);
        renderReviverPanel();
      }
    });

    window.addEventListener('resize', () => {
      applyPanelPosition(state.panelPosition);
      persistPanelPosition();
      refreshSidebarState();
    });
    renderAll();
  }

  function installGlobalErrorHooks() {
    window.addEventListener('error', event => {
      if (event?.error) captureClientError(event.error, 'window.error');
    });
    window.addEventListener('unhandledrejection', event => {
      captureClientError(event?.reason instanceof Error ? event.reason : new Error(String(event?.reason || 'Unhandled rejection')), 'window.unhandledrejection');
    });
  }

  function restorePanelFromMinimized() {
    if (!state.minimized) return;
    state.minimized = false;
    storage.set(KEYS.minimized, state.minimized);
    if (panel) panel.style.display = '';
    applyPanelPosition(state.panelPosition);
    refreshSidebarState();
  }

  function installSidebar() {
    state.sidebarController = SidebarAction.createSidebarController({
      document,
      window,
      label: 'ReviveRelay → Revive Me!',
      gearLabel: 'Restore ReviveRelay',
      getState: sidebarState,
      onActivate: handleSidebarActivate,
      getMinimized: () => state.minimized,
      onRestore: restorePanelFromMinimized
    });
    state.sidebarController.reconcile();
    window.addEventListener('popstate', () => setTimeout(refreshSidebarState, 150));
    window.addEventListener('hashchange', () => setTimeout(refreshSidebarState, 150));
  }

  function startTimers() {
    requestTimer = setInterval(() => {
      if (!state.sessionToken || !runtimeCompatible()) return;
      refreshActiveRequest().then(renderLiveState).catch(error => handleApiFailure(error, 'poll.request'));
    }, REQUEST_POLL_MS);
    proTimer = setInterval(() => {
      if (!state.sessionToken) return;
      const refresh = runtimeCompatible()
        ? refreshProState({ includePlans: false }).then(() => refreshVerificationCredential()).then(() => refreshReviverEligibility())
        : refreshMe();
      Promise.resolve(refresh).then(renderLiveState).catch(error => handleApiFailure(error, 'poll.pro'));
    }, PRO_POLL_MS);
    queueTimer = setInterval(() => {
      if (!state.sessionToken || !hasReviverSubscriptionAccess()) return;
      refreshReviverQueue().then(renderLiveState).catch(error => handleApiFailure(error, 'poll.queue'));
    }, QUEUE_POLL_MS);
    invoiceTimer = setInterval(() => {
      if (!runtimeCompatible() || state.minimized || document.visibilityState !== 'visible' || state.currentInvoice?.state !== 'PENDING') return;
      refreshCurrentInvoice().then(renderLiveState).catch(error => handleApiFailure(error, 'poll.invoice'));
    }, INVOICE_POLL_MS);
    sidebarTimer = setInterval(refreshSidebarState, SIDEBAR_RECONCILE_MS);
    telemetryTimer = setInterval(() => {
      if (!storage.get(KEYS.clientDiagnosticsEnabled, false)) return;
      state.telemetry.drain().catch(() => {});
    }, TELEMETRY_DRAIN_MS);
    clockTimer = setInterval(() => {
      if (!state.minimized && state.activeTransaction) renderLiveState();
    }, 1000);
    updateTimer = setInterval(() => {
      checkUpdates(false).catch(error => captureClientError(error, 'update.scheduled'));
    }, UpdateManager.UPDATE_CHECK_MS);
  }

  function hydratePersistentState() {
    state.sessionToken = String(storage.get(KEYS.sessionToken, '') || '');
    state.identity = storage.get(KEYS.publicIdentity, null) || null;
    state.preset = storage.get(KEYS.requestPreset, null) || null;
    state.minimized = Boolean(storage.get(KEYS.minimized, false));
    state.panelPosition = platform.runtime.isTornPda ? null : (storage.get(KEYS.panelPosition, null) || null);
    state.panelTab = Core.normalizePanelTab(storage.get(KEYS.panelTab, 'request'));
  }

  let resumeRefreshInFlight = null;
  function refreshAfterResume() {
    if (!platform.runtime.isTornPda || resumeRefreshInFlight) return resumeRefreshInFlight;
    resumeRefreshInFlight = Promise.resolve()
      .then(async () => {
        refreshSidebarState();
        if (!state.sessionToken) return;
        await refreshMarketplaceState({ includePlans: false });
        renderAll();
      })
      .catch(error => handleApiFailure(error, 'runtime.resume', 'ReviveRelay could not refresh after returning to Torn.'))
      .finally(() => { resumeRefreshInFlight = null; });
    return resumeRefreshInFlight;
  }

  async function init() {
    await platform.initialize();
    hydratePersistentState();
    createPanel();
    if (platform.runtime.isTornPda && storage.mode() !== 'pda') {
      setStatus('TornPDA durable storage is unavailable. ReviveRelay is using compatibility storage for this session.', true);
    }
    installSidebar();
    installGlobalErrorHooks();
    platform.onResume(refreshAfterResume);
    startTimers();
    refreshSidebarState();
    await restoreSession();
    renderAll();
    checkUpdates(false).catch(error => captureClientError(error, 'update.initial'));
  }

  function start() {
    init().catch(error => {
      console.error('[ReviveRelay] Initialization failed.', error);
      if (panel) setStatus('ReviveRelay could not finish initialization. Reload Torn to retry.', true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
