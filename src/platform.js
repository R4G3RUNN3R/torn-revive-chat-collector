(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayPlatform = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RUNTIME_TORNPDA = 'tornpda';
  const RUNTIME_USERSCRIPT = 'userscript';

  function detectRuntime(globalObject = globalThis) {
    const hasPdaStorage = Boolean(globalObject && globalObject.PDA_storage && typeof globalObject.PDA_storage.loadAll === 'function');
    const hasPdaHttp = Boolean(globalObject && (typeof globalObject.PDA_httpGet === 'function' || globalObject.window?.flutter_inappwebview));
    return Object.freeze({
      kind: hasPdaStorage || hasPdaHttp ? RUNTIME_TORNPDA : RUNTIME_USERSCRIPT,
      isTornPda: hasPdaStorage || hasPdaHttp,
      hasPdaStorage,
      hasPdaHttp
    });
  }

  function createStorage({ runtime, pdaStorage, gmGetValue, gmSetValue, keys = [], onError = () => {} }) {
    const cache = Object.create(null);
    let initialized = false;

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

    async function initialize() {
      if (initialized) return;
      if (runtime.isTornPda && pdaStorage && typeof pdaStorage.loadAll === 'function') {
        try {
          const stored = await pdaStorage.loadAll();
          if (stored && typeof stored === 'object' && !Array.isArray(stored)) Object.assign(cache, stored);
          const migrate = {};
          for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(cache, key)) continue;
            const sentinel = Object.freeze({});
            const legacy = readGm(key, sentinel);
            if (legacy !== sentinel) {
              cache[key] = legacy;
              migrate[key] = legacy;
            }
          }
          if (Object.keys(migrate).length && typeof pdaStorage.setMany === 'function') await pdaStorage.setMany(migrate);
        } catch (error) {
          onError(error, 'storage.pda.initialize');
          for (const key of keys) cache[key] = readGm(key, undefined);
        }
      }
      initialized = true;
    }

    function get(key, fallback) {
      if (runtime.isTornPda && initialized && Object.prototype.hasOwnProperty.call(cache, key)) {
        const value = cache[key];
        return value === undefined ? fallback : value;
      }
      if (runtime.isTornPda && initialized) return fallback;
      return readGm(key, fallback);
    }

    function set(key, value) {
      if (runtime.isTornPda && initialized) {
        cache[key] = value;
        if (pdaStorage && typeof pdaStorage.set === 'function') {
          Promise.resolve(pdaStorage.set(key, value)).catch(error => onError(error, 'storage.pda.write'));
        }
        return;
      }
      if (typeof gmSetValue === 'function') {
        try { gmSetValue(key, value); } catch (error) { onError(error, 'storage.gm.write'); }
      }
    }

    return Object.freeze({ initialize, get, set, runtime });
  }

  function normalizeResponse(response) {
    const status = Number(response && response.status) || 0;
    const responseText = response && typeof response.responseText === 'string' ? response.responseText : '';
    let body = {};
    if (responseText) {
      try { body = JSON.parse(responseText); } catch (_) { body = {}; }
    }
    return { status, responseText, body };
  }

  function createRequestAdapter({ runtime, globalObject = globalThis, gmXmlHttpRequest }) {
    const methodMap = Object.freeze({
      GET: 'PDA_httpGet',
      POST: 'PDA_httpPost',
      PUT: 'PDA_httpPut',
      DELETE: 'PDA_httpDelete',
      PATCH: 'PDA_httpPatch'
    });

    if (runtime.isTornPda) {
      return async function pdaRequest(input) {
        const method = String(input.method || 'GET').toUpperCase();
        const fnName = methodMap[method];
        const fn = fnName && globalObject && globalObject[fnName];
        if (typeof fn !== 'function') throw Object.assign(new Error('TORNPDA_HTTP_UNAVAILABLE'), { code: 'TORNPDA_HTTP_UNAVAILABLE' });
        const headers = { ...(input.headers || {}) };
        const hasBody = input.body !== undefined;
        if (hasBody && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
        if (method === 'DELETE' && hasBody) {
          throw Object.assign(new Error('TORNPDA_DELETE_BODY_UNSUPPORTED'), { code: 'TORNPDA_DELETE_BODY_UNSUPPORTED' });
        }
        const body = hasBody ? JSON.stringify(input.body) : undefined;
        const response = (method === 'GET' || method === 'DELETE')
          ? await fn(input.url, headers)
          : await fn(input.url, headers, body);
        return normalizeResponse(response);
      };
    }

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
          onload: response => resolve(normalizeResponse(response)),
          onerror: () => reject(Object.assign(new Error('NETWORK_ERROR'), { code: 'NETWORK_ERROR', retryable: true })),
          ontimeout: () => reject(Object.assign(new Error('NETWORK_ERROR'), { code: 'NETWORK_ERROR', retryable: true }))
        });
      });
    };
  }

  function createNotifier({ runtime, document, gmNotification, onError = () => {} }) {
    function showPdaToast({ title, text, timeout = 12000, onclick }) {
      if (!document || !document.body) return false;
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
      document.body.appendChild(toast);
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
    const onVisibility = () => { if (!document || document.visibilityState === 'visible') schedule(); };
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
    onError = () => {}
  } = {}) {
    const runtime = detectRuntime(globalObject);
    const storage = createStorage({
      runtime,
      pdaStorage: globalObject && globalObject.PDA_storage,
      gmGetValue: gm.getValue,
      gmSetValue: gm.setValue,
      keys: storageKeys,
      onError
    });
    const request = createRequestAdapter({ runtime, globalObject, gmXmlHttpRequest: gm.xmlHttpRequest });
    const notify = createNotifier({ runtime, document, gmNotification: gm.notification, onError });

    function addStyle(css) {
      if (typeof gm.addStyle === 'function') return gm.addStyle(css);
      if (!document || !document.head) return null;
      const style = document.createElement('style');
      style.textContent = String(css || '');
      document.head.appendChild(style);
      return style;
    }

    function openUrl(url) {
      if (!window) return null;
      return window.open(url, '_blank', 'noopener,noreferrer');
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
    detectRuntime,
    createStorage,
    createRequestAdapter,
    createNotifier,
    installResumeHooks,
    createPlatform
  });
});
