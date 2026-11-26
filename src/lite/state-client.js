(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteStateClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATE_PATH = '/v1/state';
  const STATE_VERSION_PATTERN = /^[0-9a-f]{16}$/;
  const TORN_ID_PATTERN = /^[1-9][0-9]{0,11}$/;
  const BADGE_CACHE = Object.freeze({ ttlMs: 10 * 60 * 1000, maxEntries: 200, key: 'reviverelay_badge_cache_v1' });

  const directApi = () => globalThis.ReviveRelayDirectApiClient || require('../direct-api-client');

  function clientError(code, options) {
    const { DirectApiClientError } = directApi();
    return new DirectApiClientError(code, options);
  }

  const validBadge = body => Boolean(body && typeof body.requesterVerified === 'boolean' && typeof body.reviverVerified === 'boolean');

  function createStateClient({ baseUrl, request, getToken = () => '', clientVersion = '', releaseChannel = '', now = () => Date.now(), storage = null } = {}) {
    const base = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('A valid ReviveRelay baseUrl is required');
    if (typeof request !== 'function') throw new Error('request transport is required');

    let lastStateVersion = null;
    let badges = null;

    function badgeMap() {
      if (badges) return badges;
      badges = new Map();
      let stored = null;
      try { stored = storage ? storage.get(BADGE_CACHE.key, null) : null; } catch (_) { stored = null; }
      for (const entry of Array.isArray(stored) ? stored.slice(-BADGE_CACHE.maxEntries) : []) {
        const [key, value] = Array.isArray(entry) ? entry : [];
        if (TORN_ID_PATTERN.test(String(key)) && value && validBadge(value.badge) && Number.isFinite(value.expiresAt)) badges.set(String(key), value);
      }
      return badges;
    }

    function saveBadges() {
      try { if (storage) storage.set(BADGE_CACHE.key, [...badgeMap()]); } catch (_) {}
    }

    function headers(extra = {}) {
      const result = {
        Accept: 'application/json',
        'X-ReviveRelay-Version': String(clientVersion || ''),
        'X-ReviveRelay-Channel': String(releaseChannel || ''),
        ...extra
      };
      const token = String((typeof getToken === 'function' ? getToken() : '') || '').trim();
      if (token) result.Authorization = `Bearer ${token}`;
      return result;
    }

    async function send(path, extraHeaders) {
      try {
        return await request({ method: 'GET', url: `${base}${path}`, headers: headers(extraHeaders) });
      } catch (error) {
        const { DirectApiClientError } = directApi();
        if (error instanceof DirectApiClientError) throw error;
        throw clientError('NETWORK_ERROR', { retryable: true });
      }
    }

    async function getState() {
      const sentVersion = lastStateVersion;
      const response = await send(STATE_PATH, sentVersion ? { 'If-None-Match': `"${sentVersion}"` } : {});
      const status = Number(response && response.status) || 0;
      if (status === 304) {
        if (!sentVersion) throw clientError('INVALID_STATE_RESPONSE', { status, retryable: true });
        return Object.freeze({ notModified: true, stateVersion: sentVersion });
      }
      const body = directApi().safeParseBody(response);
      if (status < 200 || status >= 300) throw directApi().mapHttpError(status, body);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !STATE_VERSION_PATTERN.test(String(body.stateVersion || ''))) {
        throw clientError('INVALID_STATE_RESPONSE', { status, retryable: true });
      }
      lastStateVersion = body.stateVersion;
      return Object.freeze({ notModified: false, snapshot: body });
    }

    function rememberBadge(key, badge) {
      const map = badgeMap();
      map.delete(key);
      map.set(key, { badge, expiresAt: now() + BADGE_CACHE.ttlMs });
      while (map.size > BADGE_CACHE.maxEntries) map.delete(map.keys().next().value);
      saveBadges();
    }

    async function getPlayerBadge(tornId) {
      const key = String(tornId == null ? '' : tornId).trim();
      if (!TORN_ID_PATTERN.test(key)) throw clientError('INVALID_TORN_ID');
      const map = badgeMap();
      const cached = map.get(key);
      if (cached && cached.expiresAt > now()) {
        map.delete(key);
        map.set(key, cached);
        return cached.badge;
      }
      if (cached) map.delete(key);
      const response = await send(`/v1/players/${key}/badge`);
      const status = Number(response && response.status) || 0;
      const body = directApi().safeParseBody(response);
      if (status < 200 || status >= 300) throw directApi().mapHttpError(status, body);
      if (!validBadge(body) || String(body.tornId) !== key) {
        throw clientError('INVALID_BADGE_RESPONSE', { status, retryable: true });
      }
      const badge = Object.freeze({
        tornId: Number(key),
        requesterVerified: body.requesterVerified === true,
        reviverVerified: body.reviverVerified === true
      });
      rememberBadge(key, badge);
      return badge;
    }

    return Object.freeze({
      getState,
      getPlayerBadge,
      lastStateVersion: () => lastStateVersion,
      reset() {
        lastStateVersion = null;
      },
      clearBadges() {
        badges = new Map();
        saveBadges();
      },
      badgeCacheSize: () => badgeMap().size
    });
  }

  return Object.freeze({ STATE_PATH, BADGE_CACHE, createStateClient });
});
