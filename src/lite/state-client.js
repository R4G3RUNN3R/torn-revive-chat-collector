(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteStateClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATE_PATH = '/v1/state';
  const STATE_VERSION_PATTERN = /^[0-9a-f]{16}$/;
  const TORN_ID_PATTERN = /^[1-9][0-9]{0,11}$/;
  const BADGE_CACHE = Object.freeze({ ttlMs: 10 * 60 * 1000, maxEntries: 200 });


  const directApi = () => globalThis.ReviveRelayDirectApiClient || require('../direct-api-client');

  function clientError(code, options) {
    const { DirectApiClientError } = directApi();
    return new DirectApiClientError(code, options);
  }

  function createStateClient({ baseUrl, request, getToken = () => '', clientVersion = '', releaseChannel = '', now = () => Date.now() } = {}) {
    const base = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('A valid ReviveRelay baseUrl is required');
    if (typeof request !== 'function') throw new Error('request transport is required');

    let lastStateVersion = null;
    const badges = new Map();

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
      badges.delete(key);
      badges.set(key, { badge, expiresAt: now() + BADGE_CACHE.ttlMs });
      while (badges.size > BADGE_CACHE.maxEntries) badges.delete(badges.keys().next().value);
    }

    async function getPlayerBadge(tornId) {
      const key = String(tornId == null ? '' : tornId).trim();
      if (!TORN_ID_PATTERN.test(key)) throw clientError('INVALID_TORN_ID');
      const cached = badges.get(key);
      if (cached && cached.expiresAt > now()) {
        badges.delete(key);
        badges.set(key, cached);
        return cached.badge;
      }
      if (cached) badges.delete(key);
      const response = await send(`/v1/players/${key}/badge`);
      const status = Number(response && response.status) || 0;
      const body = directApi().safeParseBody(response);
      if (status < 200 || status >= 300) throw directApi().mapHttpError(status, body);
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
        badges.clear();
      },
      badgeCacheSize: () => badges.size
    });
  }

  return Object.freeze({ STATE_PATH, BADGE_CACHE, createStateClient });
});
