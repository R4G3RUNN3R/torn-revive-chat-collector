(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayProClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PLAN_IDS = new Set(['monthly', 'six_months', 'yearly']);
  const CURRENCIES = new Set(['xanax', 'cash']);

  class ProClientError extends Error {
    constructor(code, options = {}) {
      super(String(code || 'PRO_REQUEST_FAILED'));
      this.name = 'ProClientError';
      this.code = String(code || 'PRO_REQUEST_FAILED');
      this.status = Number.isInteger(options.status) ? options.status : null;
    }
  }

  function normalizeBaseUrl(value) {
    const base = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('A valid ReviveRelay baseUrl is required');
    return base;
  }

  function parsedBody(response) {
    if (!response || response.body == null) return {};
    if (typeof response.body === 'object') return response.body;
    try { return JSON.parse(String(response.body)); }
    catch (_) { return {}; }
  }

  function createProClient({ baseUrl, getToken, request, clientVersion = '', releaseChannel = '' }) {
    const base = normalizeBaseUrl(baseUrl);
    if (typeof getToken !== 'function') throw new Error('getToken is required');
    if (typeof request !== 'function') throw new Error('request transport is required');

    async function call(method, path, body) {
      const token = String(getToken() || '').trim();
      if (!token) throw new ProClientError('AUTH_REQUIRED', { status: 401 });
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      };
      const version = String(clientVersion || '').trim();
      const channel = String(releaseChannel || '').trim();
      if (version) headers['X-ReviveRelay-Version'] = version;
      if (channel) headers['X-ReviveRelay-Channel'] = channel;
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      let response;
      try {
        response = await request({ method, url: `${base}${path}`, headers, body });
      } catch (_) {
        throw new ProClientError('NETWORK_ERROR');
      }
      const status = Number(response && response.status || 0);
      const result = parsedBody(response);
      if (status >= 200 && status < 300) return result;
      const serverCode = result && typeof result.error === 'string' ? result.error : null;
      throw new ProClientError(serverCode || (status === 401 || status === 403 ? 'AUTH_REQUIRED' : 'PRO_REQUEST_FAILED'), { status });
    }

    function validateInvoiceSelection(selection) {
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new ProClientError('INVALID_INVOICE_SELECTION');
      const keys = Object.keys(selection);
      if (keys.length !== 2 || !keys.includes('planId') || !keys.includes('currency')) throw new ProClientError('INVALID_INVOICE_SELECTION');
      if (!PLAN_IDS.has(selection.planId) || !CURRENCIES.has(selection.currency)) throw new ProClientError('INVALID_INVOICE_SELECTION');
      return { planId: selection.planId, currency: selection.currency };
    }

    return Object.freeze({
      getStatus() { return call('GET', '/v1/pro/status'); },
      startTrial() { return call('POST', '/v1/pro/trial'); },
      getPlans() { return call('GET', '/v1/pro/plans'); },
      async createInvoice(selection) { return call('POST', '/v1/pro/invoices', validateInvoiceSelection(selection)); },
      async getInvoice(invoiceId) {
        const id = String(invoiceId || '').trim();
        if (!id) throw new ProClientError('INVALID_INVOICE_ID');
        return call('GET', `/v1/pro/invoices/${encodeURIComponent(id)}`);
      }
    });
  }

  return Object.freeze({
    ProClientError,
    createProClient
  });
});
