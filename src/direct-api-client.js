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
      revokeVerificationCredential() { return call('DELETE', '/v1/verification-credential'); },
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
