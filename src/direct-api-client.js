(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayDirectApiClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

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

  function segment(id) {
    return encodeURIComponent(String(id || ''));
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
      call,
      setBoundToken(token) { boundToken = String(token || ''); },
      clearBoundToken() { boundToken = ''; },
      createRequest(preset) { return call('POST', '/v1/requests', preset); },
      cancelRequest(requestId) { return call('POST', `/v1/requests/${segment(requestId)}/cancel`); },
      getReviverQueue() { return call('GET', '/v1/reviver/queue'); },
      acceptRequest(requestId) { return call('POST', `/v1/requests/${segment(requestId)}/accept`); },
      checkPayment(transactionId) { return call('POST', `/v1/transactions/${segment(transactionId)}/check-payment`); },
      requestRetry(transactionId) { return call('POST', `/v1/transactions/${segment(transactionId)}/retry-request`); },
      respondRetry(transactionId, decision) {
        if (!['accept', 'decline'].includes(decision)) throw new DirectApiClientError('INVALID_RETRY_DECISION');
        return call('POST', `/v1/transactions/${segment(transactionId)}/retry-response`, { decision });
      },
      requestRefund(transactionId) { return call('POST', `/v1/transactions/${segment(transactionId)}/request-refund`); },
      checkRefund(transactionId) { return call('POST', `/v1/transactions/${segment(transactionId)}/check-refund`); }
    });
  }

  return {
    DirectApiClientError,
    mapHttpError,
    safeParseBody,
    segment,
    createDirectApiClient
  };
});
