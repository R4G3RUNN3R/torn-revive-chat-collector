(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayApiClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RETRY_DELAYS_MS = Object.freeze([5_000, 15_000, 30_000, 60_000]);

  class ApiClientError extends Error {
    constructor(code, options = {}) {
      const safeCode = String(code || 'UNKNOWN_ERROR');
      super(options.message || safeCode);
      this.name = 'ApiClientError';
      this.code = safeCode;
      this.status = Number.isInteger(options.status) ? options.status : null;
      this.retryable = Boolean(options.retryable);
      this.details = options.details || null;
    }
  }

  function normalizeBaseUrl(value) {
    const baseUrl = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('A valid ReviveRelay baseUrl is required');
    return baseUrl;
  }

  function responseBody(response) {
    if (response?.body == null || typeof response.body === 'object') return response?.body || {};
    try {
      return JSON.parse(String(response.body));
    } catch (_) {
      return {};
    }
  }

  function mapHttpError(status, body) {
    const details = body && typeof body === 'object' ? body : {};
    if (status === 401 || status === 403) {
      return new ApiClientError('AUTH_REQUIRED', { status, retryable: false, details });
    }
    if (status === 409) {
      return new ApiClientError('CONFLICT', { status, retryable: false, details });
    }
    if (status === 426) {
      return new ApiClientError('CLIENT_UPDATE_REQUIRED', { status, retryable: false, details });
    }
    if (status === 422) {
      return new ApiClientError('INVALID_REQUEST', { status, retryable: false, details });
    }
    if (status === 429) {
      return new ApiClientError('RATE_LIMITED', { status, retryable: true, details });
    }
    if (status >= 500) {
      return new ApiClientError('SERVER_UNAVAILABLE', { status, retryable: true, details });
    }
    return new ApiClientError('REQUEST_FAILED', { status, retryable: false, details });
  }

  function createGmRequestAdapter(gmXmlHttpRequest, options = {}) {
    if (typeof gmXmlHttpRequest !== 'function') throw new Error('GM_xmlhttpRequest transport is required');
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20_000;

    return function gmRequest(request) {
      return new Promise((resolve, reject) => {
        const settings = {
          method: request.method || 'GET',
          url: request.url,
          headers: { ...(request.headers || {}) },
          timeout: timeoutMs,
          onload: (response) => {
            let body = {};
            const text = response?.responseText;
            if (text) {
              try { body = JSON.parse(text); }
              catch (_) { body = {}; }
            }
            resolve({ status: Number(response?.status || 0), body });
          },
          onerror: () => reject(new Error('ReviveRelay network request failed')),
          ontimeout: () => reject(new Error('ReviveRelay network request timed out'))
        };

        if (request.body !== undefined) settings.data = JSON.stringify(request.body);
        gmXmlHttpRequest(settings);
      });
    };
  }

  function createApiClient({ baseUrl, getToken, request, clientVersion = '', releaseChannel = '' }) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    if (typeof request !== 'function') throw new Error('request transport is required');
    const readStoredToken = typeof getToken === 'function' ? getToken : () => '';
    let boundToken = '';

    async function call(method, path, body, options = {}) {
      const headers = { Accept: 'application/json' };
      const normalizedVersion = String(clientVersion || '').trim();
      const normalizedChannel = String(releaseChannel || '').trim();
      if (normalizedVersion) headers['X-ReviveRelay-Version'] = normalizedVersion;
      if (normalizedChannel) headers['X-ReviveRelay-Channel'] = normalizedChannel;
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      if (options.auth !== false) {
        const token = String(boundToken || readStoredToken() || '').trim();
        if (token) headers.Authorization = `Bearer ${token}`;
      }

      let response;
      try {
        response = await request({
          method,
          url: `${normalizedBaseUrl}${path}`,
          headers,
          body
        });
      } catch (_) {
        throw new ApiClientError('NETWORK_ERROR', {
          message: 'ReviveRelay network request failed',
          retryable: true
        });
      }

      const status = Number(response?.status || 0);
      const parsedBody = responseBody(response);
      if (status >= 200 && status < 300) return parsedBody;
      throw mapHttpError(status, parsedBody);
    }

    return Object.freeze({
      async bind(apiKey, clientVersion) {
        const result = await call('POST', '/v1/auth/bind', { apiKey, clientVersion }, { auth: false });
        if (result?.token) boundToken = String(result.token);
        return result;
      },
      submitCandidate(candidate) {
        return call('POST', '/v1/candidates', candidate);
      },
      getRecentCandidates() {
        return call('GET', '/v1/candidates/recent');
      },
      createRequest(payload) {
        return call('POST', '/v1/requests', payload);
      },
      getActiveRequest() {
        return call('GET', '/v1/requests/active');
      },
      cancelRequest(id) {
        return call('POST', `/v1/requests/${encodeURIComponent(String(id))}/cancel`);
      },
      getMe() {
        return call('GET', '/v1/me');
      },
      getClientVersionManifest() {
        return call('GET', '/v1/client/version', undefined, { auth: false });
      },
      submitTelemetry(errors) {
        return call('POST', '/v1/telemetry/errors', { errors: Array.isArray(errors) ? errors : [] });
      },
      getVerificationCredential() {
        return call('GET', '/v1/verification-credential');
      },
      bindVerificationCredential(apiKey) {
        return call('POST', '/v1/verification-credential', { apiKey: String(apiKey || '').trim() });
      },
      revokeVerificationCredential() {
        return call('DELETE', '/v1/verification-credential');
      },
      registerReviver() {
        return call('POST', '/v1/reviver/register');
      },
      getReviverQueue() {
        return call('GET', '/v1/reviver/queue');
      },
      acceptRequest(id) {
        return call('POST', `/v1/requests/${encodeURIComponent(String(id))}/accept`);
      },
      getTransaction(id) {
        return call('GET', `/v1/transactions/${encodeURIComponent(String(id))}`);
      },
      checkPayment(id) {
        return call('POST', `/v1/transactions/${encodeURIComponent(String(id))}/check-payment`, {});
      },
      requestRetry(id) {
        return call('POST', `/v1/transactions/${encodeURIComponent(String(id))}/retry-request`, {});
      },
      respondRetry(id, decision) {
        if (!['accept', 'decline'].includes(decision)) throw new Error('Retry decision must be accept or decline');
        return call('POST', `/v1/transactions/${encodeURIComponent(String(id))}/retry-response`, { decision });
      },
      requestRefund(id) {
        return call('POST', `/v1/transactions/${encodeURIComponent(String(id))}/request-refund`, {});
      },
      checkRefund(id) {
        return call('POST', `/v1/transactions/${encodeURIComponent(String(id))}/check-refund`, {});
      }
    });
  }

  function nextRetryDelay(attempts) {
    const count = Math.max(1, Number(attempts) || 1);
    return RETRY_DELAYS_MS[Math.min(count - 1, RETRY_DELAYS_MS.length - 1)];
  }

  function cloneJsonObject(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function generatedOutboxId() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    return `candidate-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function createOutboxEntry(candidate, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    return {
      id: String(options.id || generatedOutboxId()),
      candidate: cloneJsonObject(candidate),
      attempts: 0,
      nextAttemptAt: now
    };
  }

  async function drainCandidateOutbox({ entries, now = Date.now(), isActive, submitCandidate }) {
    const source = Array.isArray(entries) ? entries : [];
    const pending = [];
    const delivered = [];
    const deadLetter = [];
    const active = typeof isActive === 'function' ? Boolean(isActive()) : false;

    if (!active || typeof submitCandidate !== 'function') {
      return { pending: source.map((entry) => ({ ...entry })), delivered, deadLetter };
    }

    for (const original of source) {
      const entry = {
        ...original,
        candidate: cloneJsonObject(original.candidate)
      };

      if (Number(entry.nextAttemptAt || 0) > now) {
        pending.push(entry);
        continue;
      }

      try {
        await submitCandidate(entry.candidate);
        delivered.push(entry);
      } catch (error) {
        if (error instanceof ApiClientError && error.retryable) {
          const attempts = Number(entry.attempts || 0) + 1;
          pending.push({
            ...entry,
            attempts,
            nextAttemptAt: now + nextRetryDelay(attempts)
          });
        } else {
          deadLetter.push({
            ...entry,
            lastError: error instanceof ApiClientError ? error.code : 'UNKNOWN_ERROR'
          });
        }
      }
    }

    return { pending, delivered, deadLetter };
  }

  return Object.freeze({
    ApiClientError,
    RETRY_DELAYS_MS,
    createApiClient,
    createGmRequestAdapter,
    createOutboxEntry,
    nextRetryDelay,
    drainCandidateOutbox
  });
});
