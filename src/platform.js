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
    const readyPromise = globalObject && globalObject.__PDA_platformReadyPromise;
    const hasPdaReadyPromise = Boolean(readyPromise && typeof readyPromise.then === 'function');
    // TornPDA injects its bridge/helpers independently. Its own HTTP helpers
    // wait on __PDA_platformReadyPromise before using flutter_inappwebview, so
    // the ready promise is a reliable early marker even when the native bridge
    // itself has not appeared yet on a cold/recovered WebView.
    const isTornPda = hasPdaReadyPromise || hasFlutterBridge || (hasPdaStorage && hasPdaHttp);
    return Object.freeze({
      kind: isTornPda ? RUNTIME_TORNPDA : RUNTIME_USERSCRIPT,
      isTornPda,
      hasPdaStorage,
      hasPdaHttp,
      hasFlutterBridge,
      hasPdaReadyPromise
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
