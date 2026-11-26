(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayPanelApiClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Endpoints only the legacy 0.7 panel uses (setup, Pro, invoices, account).
  // Measured with the legacy panel, outside the Lite core size budget.
  const PLAN_IDS = Object.freeze(['monthly', 'six_months', 'yearly']);
  const PRO_CURRENCIES = Object.freeze(['xanax', 'cash']);
  const ACCOUNT_DELETE_CONFIRMATION = 'DELETE REVIVERELAY ACCOUNT';

  function dependency(globalName, path) {
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
    if (typeof require === 'function') return require(path);
    throw new Error(`${globalName} unavailable`);
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
      const { compareVersions } = dependency('ReviveRelayVersioning', './versioning');
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

  function validateInvoiceSelection(selection, DirectApiClientError) {
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

  function validateInvoiceId(invoiceId, DirectApiClientError) {
    const normalized = String(invoiceId || '').trim();
    if (!normalized) throw new DirectApiClientError('INVALID_INVOICE_ID');
    return normalized;
  }

  // The 0.7 panel's full API surface: the Lite core client plus the panel-only endpoints.
  function createPanelApiClient(options = {}) {
    const Direct = dependency('ReviveRelayDirectApiClient', './direct-api-client');
    const { DirectApiClientError, segment } = Direct;
    const { call, setBoundToken, ...everyday } = Direct.createDirectApiClient(options);
    const clientVersion = options.clientVersion || '';
    return Object.freeze({
      ...everyday,
      async bind(apiKey, version = clientVersion) {
        const result = await call('POST', '/v1/auth/bind', { apiKey: String(apiKey || ''), clientVersion: String(version || '') }, { auth: false });
        if (result && result.token) setBoundToken(result.token);
        return result;
      },
      getMe() { return call('GET', '/v1/me'); },
      submitTelemetry(errors) { return call('POST', '/v1/telemetry/errors', { errors: Array.isArray(errors) ? errors : [] }); },
      getActiveRequest() { return call('GET', '/v1/requests/active'); },
      getVerificationCredential() { return call('GET', '/v1/verification-credential'); },
      bindVerificationCredential(apiKey) { return call('POST', '/v1/verification-credential', { apiKey: String(apiKey || '') }); },
      revokeVerificationCredential() { return call('POST', '/v1/verification-credential/revoke'); },
      getReviverEligibility() { return call('GET', '/v1/reviver/eligibility'); },
      registerReviver() { return call('POST', '/v1/reviver/register'); },
      getTransaction(transactionId) { return call('GET', `/v1/transactions/${segment(transactionId)}`); },
      getProStatus() { return call('GET', '/v1/pro/status'); },
      startProTrial() { return call('POST', '/v1/pro/trial'); },
      async createProInvoice(selection) {
        return call('POST', '/v1/pro/invoices', validateInvoiceSelection(selection, DirectApiClientError));
      },
      async getProInvoice(invoiceId) {
        return call('GET', `/v1/pro/invoices/${encodeURIComponent(validateInvoiceId(invoiceId, DirectApiClientError))}`);
      },
      deleteAccount() { return call('POST', '/v1/account/delete', { confirm: ACCOUNT_DELETE_CONFIRMATION }); }
    });
  }

  return Object.freeze({ validateReviewRuntime, createPanelApiClient });
});
