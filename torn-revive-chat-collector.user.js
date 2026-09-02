// ==UserScript==
// @name         ReviveRelay
// @namespace    https://voidsmithindustries.com/
// @version      __REVIVERELAY_VERSION__
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
// @updateURL    __REVIVERELAY_UPDATE_URL__
// @downloadURL  __REVIVERELAY_DOWNLOAD_URL__
// ReviveRelay-Build-Commit: __REVIVERELAY_GIT_COMMIT__
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '__REVIVERELAY_VERSION__';
  const UPDATE_CHANNEL = '__REVIVERELAY_UPDATE_CHANNEL__';
  const BUILD_COMMIT = '__REVIVERELAY_GIT_COMMIT__';
  const API_BASE = 'https://reviverelay.voidsmithindustries.com';
  const REQUEST_POLL_MS = 10_000;
  const PRO_POLL_MS = 60_000;
  const QUEUE_POLL_MS = 10_000;
  const INVOICE_POLL_MS = 15_000;
  const SIDEBAR_RECONCILE_MS = 5_000;
  const TELEMETRY_DRAIN_MS = 30_000;
  const MAX_SEEN_REQUEST_IDS = 200;
  const PRO_LAUNCH_REFERENCE = Object.freeze([
    'Monthly: 10 Xanax or $10,000,000',
    '6 Months: 55 Xanax or $55,000,000',
    'Yearly: 100 Xanax or $100,000,000'
  ]);

  const KEYS = Object.freeze({
    sessionToken: 'reviverelay_session_token',
    publicIdentity: 'reviverelay_public_identity',
    requestPreset: 'reviverelay_request_preset',
    seenRequestIds: 'reviverelay_seen_request_ids',
    minimized: 'reviverelay_panel_minimized',
    panelPosition: 'reviverelay_panel_position',
    panelTab: 'reviverelay_panel_tab',
    updateState: 'reviverelay_update_state',
    clientDiagnosticsEnabled: 'reviverelay_client_diagnostics_enabled',
    telemetryOutbox: 'reviverelay_telemetry_outbox'
  });

  const Core = globalThis.TornReviveChatCollectorCore;
  const DirectApiClient = globalThis.ReviveRelayDirectApiClient;
  const UpdateManager = globalThis.ReviveRelayUpdateManager;
  const TelemetryClient = globalThis.ReviveRelayTelemetryClient;
  const RequestPreset = globalThis.ReviveRelayRequestPreset;
  const SidebarAction = globalThis.ReviveRelaySidebarAction;
  const ProClient = globalThis.ReviveRelayProClient;

  if (!Core || !DirectApiClient || !UpdateManager || !TelemetryClient || !RequestPreset || !SidebarAction || !ProClient) {
    console.error('[ReviveRelay] Required direct-runtime dependency unavailable.');
    return;
  }

  const requestTransport = DirectApiClient.createGmRequestAdapter(GM_xmlhttpRequest);
  const state = {
    api: null,
    proApi: null,
    telemetry: null,
    updateManager: null,
    sessionToken: String(GM_getValue(KEYS.sessionToken, '') || ''),
    identity: GM_getValue(KEYS.publicIdentity, null),
    preset: GM_getValue(KEYS.requestPreset, null),
    activeRequest: null,
    activeTransaction: null,
    verificationCredential: null,
    reviverQueue: [],
    proStatus: null,
    proPlans: [],
    currentInvoice: null,
    submittingRequest: false,
    sidebarController: null,
    minimized: Boolean(GM_getValue(KEYS.minimized, false)),
    panelPosition: GM_getValue(KEYS.panelPosition, null),
    panelTab: Core.normalizePanelTab(GM_getValue(KEYS.panelTab, 'request'))
  };

  let panel = null;
  let body = null;
  let connectionPill = null;
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

  state.api = DirectApiClient.createDirectApiClient({
    baseUrl: API_BASE,
    getToken: () => state.sessionToken,
    request: requestTransport,
    clientVersion: VERSION,
    releaseChannel: UPDATE_CHANNEL
  });

  state.proApi = ProClient.createProClient({
    baseUrl: API_BASE,
    getToken: () => state.sessionToken,
    request: requestTransport,
    clientVersion: VERSION,
    releaseChannel: UPDATE_CHANNEL
  });

  state.telemetry = TelemetryClient.createTelemetryClient({
    submit: payload => state.api.submitTelemetry(payload.errors),
    getStoredQueue: () => GM_getValue(KEYS.telemetryOutbox, []),
    saveStoredQueue: queue => GM_setValue(KEYS.telemetryOutbox, Array.isArray(queue) ? queue : []),
    version: VERSION,
    buildCommit: BUILD_COMMIT
  });

  state.updateManager = UpdateManager.createUpdateManager({
    currentVersion: VERSION,
    channel: UPDATE_CHANNEL,
    fetchManifest: () => state.api.getClientVersionManifest(),
    getState: () => GM_getValue(KEYS.updateState, {}),
    saveState: value => GM_setValue(KEYS.updateState, value),
    openUrl: url => window.open(url, '_blank', 'noopener,noreferrer')
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
    return state.proStatus?.state === 'TRIAL' || state.proStatus?.state === 'ACTIVE';
  }

  function publicIdentity() {
    if (!state.identity) return null;
    return { tornId: state.identity.tornId, name: state.identity.name };
  }

  function captureClientError(error, operation) {
    if (!GM_getValue(KEYS.clientDiagnosticsEnabled, false)) return;
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

  function handleApiFailure(error, operation, userMessage = 'ReviveRelay request failed.') {
    captureClientError(error, operation);
    if (Number(error && error.status) === 401) {
      clearSession('Your ReviveRelay session expired. Verify & connect again.');
      return;
    }
    setStatus(`${userMessage} (${apiErrorCode(error)})`, true);
  }

  function clearSession(message = 'Disconnected from ReviveRelay.') {
    state.sessionToken = '';
    state.identity = null;
    state.activeRequest = null;
    state.activeTransaction = null;
    state.verificationCredential = null;
    state.reviverQueue = [];
    state.proStatus = null;
    state.proPlans = [];
    state.currentInvoice = null;
    state.submittingRequest = false;
    lastRequestError = null;
    GM_setValue(KEYS.sessionToken, '');
    GM_setValue(KEYS.publicIdentity, null);
    setStatus(message, false);
    refreshSidebarState();
    renderAll();
  }

  async function refreshMe() {
    if (!state.sessionToken) return null;
    const me = await state.api.getMe();
    state.identity = {
      ...(me?.user || {}),
      roles: Array.isArray(me?.roles) ? me.roles : []
    };
    if (me?.pro) state.proStatus = me.pro;
    GM_setValue(KEYS.publicIdentity, publicIdentity());
    return me;
  }

  async function connectIdentity() {
    const apiKeyInput = document.getElementById('rr-api-key');
    const apiKey = String(apiKeyInput?.value || '').trim();
    if (!apiKey) {
      setStatus('Enter your one-time Torn identity key first.', true);
      return;
    }
    setStatus('Verifying identity…');
    try {
      const result = await state.api.bind(apiKey, VERSION);
      if (apiKeyInput) apiKeyInput.value = '';
      state.sessionToken = String(result?.token || '');
      GM_setValue(KEYS.sessionToken, state.sessionToken);
      state.identity = result?.user ? { ...result.user, roles: ['requester'] } : null;
      GM_setValue(KEYS.publicIdentity, publicIdentity());
      await refreshMarketplaceState({ includePlans: true });
      setStatus('ReviveRelay connected.');
      refreshSidebarState();
      renderAll();
    } catch (error) {
      if (apiKeyInput) apiKeyInput.value = '';
      handleApiFailure(error, 'identity.bind', 'Identity verification failed.');
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
    if (!state.sessionToken) {
      state.proStatus = null;
      state.proPlans = [];
      return;
    }
    const result = await state.proApi.getStatus();
    state.proStatus = result?.pro || null;
    if (includePlans || !state.proPlans.length) {
      const plans = await state.proApi.getPlans();
      state.proPlans = Array.isArray(plans?.plans) ? plans.plans : [];
    }
  }

  async function refreshActiveRequest() {
    if (!state.sessionToken) {
      state.activeRequest = null;
      return;
    }
    const result = await state.api.getActiveRequest();
    state.activeRequest = result?.request || null;
    if (state.activeRequest?.transactionId) await refreshActiveTransaction(state.activeRequest.transactionId);
    else if (state.activeTransaction?.participantRole === 'requester') state.activeTransaction = null;
    refreshSidebarState();
  }

  async function refreshActiveTransaction(transactionId = null) {
    const id = transactionId || state.activeTransaction?.id || state.activeRequest?.transactionId;
    if (!state.sessionToken || !id) return;
    const result = await state.api.getTransaction(id);
    state.activeTransaction = result?.transaction || result || null;
  }

  async function refreshVerificationCredential() {
    if (!state.sessionToken || !isProActive()) {
      state.verificationCredential = null;
      return;
    }
    const result = await state.api.getVerificationCredential();
    state.verificationCredential = result?.credential || null;
  }

  function readSeenRequestIds() {
    const stored = GM_getValue(KEYS.seenRequestIds, []);
    return Array.isArray(stored) ? stored.map(String).slice(-MAX_SEEN_REQUEST_IDS) : [];
  }

  function writeSeenRequestIds(ids) {
    const bounded = Array.from(new Set(ids.map(String))).slice(-MAX_SEEN_REQUEST_IDS);
    GM_setValue(KEYS.seenRequestIds, bounded);
  }

  function notifyNewQueueRequests(requests) {
    if (!isProActive() || !hasRole('reviver') || !hasCredentialCapability('reviver')) return;
    const seen = new Set(readSeenRequestIds());
    const next = [...seen];
    for (const request of Array.isArray(requests) ? requests : []) {
      const id = String(request?.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
      const offer = formatOffer(request.paymentMethod, request.offerAmount);
      const requester = `${request.requesterName || 'Player'} [${request.requesterTornId || '?'}]`;
      try {
        GM_notification({
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
    if (!state.sessionToken || !isProActive()) {
      state.reviverQueue = [];
      return;
    }
    if (!hasRole('reviver') || !hasCredentialCapability('reviver')) {
      state.reviverQueue = [];
      return;
    }
    const result = await state.api.getReviverQueue();
    state.reviverQueue = Array.isArray(result?.requests) ? result.requests : [];
    notifyNewQueueRequests(state.reviverQueue);
  }

  async function refreshCurrentInvoice() {
    if (!state.sessionToken || state.currentInvoice?.state !== 'PENDING' || !state.currentInvoice?.id) return;
    const result = await state.proApi.getInvoice(state.currentInvoice.id);
    state.currentInvoice = {
      ...(result?.invoice || {}),
      paymentTarget: result?.paymentTarget || state.currentInvoice.paymentTarget || null
    };
    if (state.currentInvoice.state === 'PAID') {
      await refreshProState({ includePlans: false });
      await refreshVerificationCredential();
      await refreshReviverQueue();
    }
  }

  async function refreshMarketplaceState({ includePlans = false } = {}) {
    if (!state.sessionToken) return;
    await refreshMe();
    await refreshProState({ includePlans });
    await refreshActiveRequest();
    await refreshVerificationCredential();
    await refreshReviverQueue();
    if (state.activeTransaction?.id) await refreshActiveTransaction(state.activeTransaction.id);
  }

  async function requestReviveFromSidebar() {
    const validation = RequestPreset.validatePreset(state.preset);
    if (!state.sessionToken || !validation.ok || state.submittingRequest || state.activeRequest) return;
    state.submittingRequest = true;
    lastRequestError = null;
    refreshSidebarState();
    renderAll();
    try {
      const result = await state.api.createRequest(validation.preset);
      state.activeRequest = result?.request || null;
      setStatus('Certified revive request submitted.');
    } catch (error) {
      lastRequestError = apiErrorCode(error);
      handleApiFailure(error, 'request.create', 'Could not create revive request.');
    } finally {
      state.submittingRequest = false;
      refreshSidebarState();
      renderAll();
    }
  }

  async function cancelActiveRequest() {
    if (!state.activeRequest?.id) return;
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
    GM_setValue(KEYS.requestPreset, validation.preset);
    lastRequestError = null;
    setStatus('Revive Me preset saved.');
    refreshSidebarState();
    renderAll();
  }

  async function startProTrial() {
    try {
      const result = await state.proApi.startTrial();
      state.proStatus = result?.pro || null;
      setStatus('7-day Reviver Pro trial activated.');
      await refreshVerificationCredential();
      await refreshReviverQueue();
      renderAll();
    } catch (error) {
      handleApiFailure(error, 'pro.trial', 'Trial could not be activated.');
    }
  }

  async function createProInvoice() {
    const planId = document.getElementById('rr-pro-plan')?.value;
    const currency = document.getElementById('rr-pro-currency')?.value;
    try {
      const result = await state.proApi.createInvoice({ planId, currency });
      state.currentInvoice = {
        ...(result?.invoice || {}),
        paymentTarget: result?.paymentTarget || null
      };
      setStatus('Pro payment invoice created.');
      renderAll();
    } catch (error) {
      handleApiFailure(error, 'pro.invoice.create', 'Pro invoice could not be created.');
    }
  }

  async function bindVerificationKey() {
    if (!isProActive()) return;
    const verificationKeyInput = document.getElementById('rr-verification-key');
    const key = String(verificationKeyInput?.value || '').trim();
    if (!key) {
      setStatus('Enter a restricted reviver verification key.', true);
      return;
    }
    try {
      const result = await state.api.bindVerificationCredential(key);
      if (verificationKeyInput) verificationKeyInput.value = '';
      state.verificationCredential = result?.credential || null;
      setStatus('Reviver transaction verification key bound.');
      await refreshMe();
      await refreshReviverQueue();
      renderAll();
    } catch (error) {
      if (verificationKeyInput) verificationKeyInput.value = '';
      handleApiFailure(error, 'verification.bind', 'Verification key could not be bound.');
    }
  }

  async function revokeVerificationKey() {
    try {
      await state.api.revokeVerificationCredential();
      state.verificationCredential = null;
      state.reviverQueue = [];
      setStatus('Reviver transaction verification key revoked.');
      renderAll();
    } catch (error) {
      handleApiFailure(error, 'verification.revoke', 'Verification key could not be revoked.');
    }
  }

  async function registerMarketplaceReviver() {
    if (!isProActive() || !hasCredentialCapability('reviver')) return;
    try {
      await state.api.registerReviver();
      await refreshMe();
      await refreshReviverQueue();
      setStatus('Reviver Pro queue access registered.');
      renderAll();
    } catch (error) {
      handleApiFailure(error, 'reviver.register', 'Reviver registration failed.');
    }
  }

  async function acceptMarketplaceRequest(requestId) {
    if (!isProActive() || !hasRole('reviver') || !hasCredentialCapability('reviver')) return;
    try {
      const result = await state.api.acceptRequest(requestId);
      state.activeTransaction = result?.transaction || null;
      await refreshReviverQueue();
      setStatus('Certified revive request accepted.');
      renderAll();
    } catch (error) {
      handleApiFailure(error, 'reviver.accept', 'Request could not be accepted.');
    }
  }

  async function runTransactionAction(action, decision = null) {
    if (!state.activeTransaction?.id) return;
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
      lastError: lastRequestError
    });
  }

  function refreshSidebarState() {
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
    if (currentState === 'SETUP_REQUIRED') activatePanelTab(state.sessionToken ? 'settings' : 'request');
    else activatePanelTab('request');
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
      <p>Verify your Torn identity once. The identity key is used only for binding and is not stored by ReviveRelay.</p>
      <label class="rr-label" for="rr-api-key">One-time identity API key</label>
      <input id="rr-api-key" type="password" autocomplete="off" placeholder="Paste key once">
      <button id="rr-connect">Verify &amp; connect</button>
    </div>`;
  }

  function renderRequestPanel() {
    const target = document.getElementById('rr-requester');
    if (!target) return;
    if (!state.sessionToken || !state.identity) {
      target.innerHTML = renderOnboarding();
      return;
    }
    const validation = RequestPreset.validatePreset(state.preset);
    const presetText = validation.ok
      ? `${formatOffer(validation.preset.paymentMethod, validation.preset.offerAmount)}${validation.preset.comment ? ` · “${escapeHtml(validation.preset.comment)}”` : ''}`
      : 'Not configured';
    const request = state.activeRequest;
    target.innerHTML = `<div class="rr-card">
      <div class="rr-card-title">Revive Me</div>
      <p>Use Torn's left sidebar action <strong>ReviveRelay → Revive Me!</strong> for the one-click certified request.</p>
      <div class="rr-kv"><span>Saved preset</span><strong>${presetText}</strong></div>
      ${validation.ok ? '' : '<button data-rr-open-settings>Configure Revive Me preset</button>'}
    </div>
    <div class="rr-card" id="rr-request-card">
      <div class="rr-card-title">Active certified request</div>
      ${request ? `
        <div class="rr-certified-line"><span class="rr-star">★</span><strong>CERTIFIED REQUEST</strong></div>
        <div class="rr-kv"><span>State</span><strong>${escapeHtml(request.state)}</strong></div>
        <div class="rr-kv"><span>Offer</span><strong>${escapeHtml(formatOffer(request.paymentMethod, request.offerAmount))}</strong></div>
        <div class="rr-kv"><span>Message</span><strong>${escapeHtml(request.comment || '—')}</strong></div>
        <div class="rr-kv"><span>Created</span><strong>${escapeHtml(formatDate(request.createdAt))}</strong></div>
        <button id="rr-cancel-request">Cancel request</button>
      ` : '<div class="rr-muted">No active certified request.</div>'}
    </div>
    ${state.activeTransaction ? renderTransactionCard(state.activeTransaction, 'Your revive transaction') : ''}`;
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
      <button data-rr-accept="${escapeHtml(request.id)}">Accept</button>
    </div>`;
  }

  function renderReviverPanel() {
    const target = document.getElementById('rr-reviver-content');
    if (!target) return;
    if (!state.sessionToken) {
      target.innerHTML = '<div class="rr-card">Connect ReviveRelay first.</div>';
      return;
    }
    if (!isProActive()) {
      target.innerHTML = `<div class="rr-card rr-pro-gate">
        <div class="rr-card-title">Reviver Pro required</div>
        <p>The certified request queue, notifications and Accept are Reviver Pro features.</p>
        ${state.proStatus?.trialEligible ? '<button id="rr-start-trial-inline">Start 7-day Reviver Pro trial</button>' : '<button data-rr-open-settings>Open Pro plans</button>'}
      </div>`;
      return;
    }
    if (!hasCredentialCapability('reviver')) {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Finish reviver verification</div>
        <p>Bind the restricted transaction verification key in Settings before the queue can be used.</p>
        <button data-rr-open-settings>Open Settings</button>
      </div>`;
      return;
    }
    if (!hasRole('reviver')) {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Register as reviver</div>
        <p>Your Pro entitlement and reviver verification capability are valid.</p>
        <button id="rr-register-reviver">Register as reviver</button>
      </div>`;
      return;
    }
    target.innerHTML = `<div class="rr-card">
      <div class="rr-card-title">Certified revive queue</div>
      <div class="rr-muted">${state.reviverQueue.length} available request${state.reviverQueue.length === 1 ? '' : 's'}.</div>
    </div>
    <div id="rr-reviver-queue">${state.reviverQueue.length ? state.reviverQueue.map(renderCertifiedRequest).join('') : '<div class="rr-card rr-muted">No certified requests waiting.</div>'}</div>
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
    if (!state.proPlans.length) return '<option value="">Plans unavailable</option>';
    return state.proPlans.map(plan => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.label)} · ${plan.xanax} Xanax / ${formatMoney(plan.cash)}</option>`).join('');
  }

  function renderInvoice() {
    if (!state.currentInvoice) return '<div class="rr-muted">No open Pro invoice.</div>';
    const invoice = state.currentInvoice;
    const target = invoice.paymentTarget?.tornId;
    return `<div class="rr-invoice">
      <div class="rr-kv"><span>State</span><strong>${escapeHtml(invoice.state)}</strong></div>
      <div class="rr-kv"><span>Amount</span><strong>${escapeHtml(formatOffer(invoice.currency, invoice.expectedAmount))}</strong></div>
      <div class="rr-kv"><span>Send to Torn ID</span><strong>${escapeHtml(target || '—')}</strong></div>
      <div class="rr-kv"><span>Expires</span><strong>${escapeHtml(formatDate(invoice.expiresAt))}</strong></div>
      ${invoice.state === 'PENDING' ? '<button id="rr-refresh-invoice">Check payment status</button>' : ''}
    </div>`;
  }

  function renderVerificationSettings() {
    if (!state.sessionToken) return '<div class="rr-muted">Connect ReviveRelay first.</div>';
    if (!isProActive()) return '<div class="rr-muted">Reviver transaction verification becomes available with an active Reviver Pro trial or subscription.</div>';
    const credential = state.verificationCredential;
    const usable = Boolean(credential?.usable);
    const reviver = Boolean(credential?.capabilities?.reviver);
    return `<div class="rr-kv"><span>Status</span><strong>${usable ? 'Bound' : 'Not bound'}</strong></div>
      <div class="rr-kv"><span>Reviver capability</span><strong>${reviver ? 'Validated' : 'Not validated'}</strong></div>
      <label class="rr-label" for="rr-verification-key">Restricted transaction verification key</label>
      <input id="rr-verification-key" type="password" autocomplete="off" placeholder="Never stored in Tampermonkey">
      <div class="rr-actions">
        <button id="rr-bind-verification">${credential ? 'Rebind verification key' : 'Bind verification key'}</button>
        ${credential ? '<button id="rr-revoke-verification">Revoke verification key</button>' : ''}
      </div>`;
  }

  function renderSettingsPanel() {
    const target = document.getElementById('rr-settings-content');
    if (!target) return;
    const validation = RequestPreset.validatePreset(state.preset);
    const preset = validation.ok ? validation.preset : { paymentMethod: 'cash', offerAmount: 500000, comment: '' };
    const proState = state.proStatus?.state || 'NONE';
    const trialButton = state.sessionToken && state.proStatus?.trialEligible
      ? '<button id="rr-start-trial">Start 7-day Reviver Pro trial</button>' : '';
    target.innerHTML = `<div class="rr-card">
      <div class="rr-card-title">Revive Me preset</div>
      <p>This preset powers <strong>ReviveRelay → Revive Me!</strong> in Torn's left sidebar.</p>
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
    <div class="rr-card" id="rr-pro-settings">
      <div class="rr-card-title">Reviver Pro</div>
      <div class="rr-kv"><span>Status</span><strong>${escapeHtml(proState)}</strong></div>
      ${state.proStatus?.validUntil ? `<div class="rr-kv"><span>Valid until</span><strong>${escapeHtml(formatDate(state.proStatus.validUntil))}</strong></div>` : ''}
      ${trialButton}
      <p class="rr-muted">Launch reference: ${PRO_LAUNCH_REFERENCE.map(escapeHtml).join(' · ')}. Checkout values are always loaded from the server plan catalog.</p>
      ${state.sessionToken ? `<div class="rr-form-row">
        <select id="rr-pro-plan">${selectedPlanOptions()}</select>
        <select id="rr-pro-currency"><option value="xanax">Xanax</option><option value="cash">Torn cash</option></select>
        <button id="rr-create-pro-invoice">Create Pro invoice</button>
      </div>${renderInvoice()}` : '<div class="rr-muted">Connect ReviveRelay to view Pro plans.</div>'}
    </div>
    <div class="rr-card" id="rr-verification">
      <div class="rr-card-title">Reviver transaction verification</div>
      ${renderVerificationSettings()}
    </div>
    <div class="rr-card">
      <div class="rr-card-title">Account & controls</div>
      <div class="rr-kv"><span>Connection</span><strong>${state.sessionToken ? 'Connected' : 'Disconnected'}</strong></div>
      <div class="rr-actions">
        <button id="rr-refresh">Refresh</button>
        ${state.sessionToken ? '<button id="rr-disconnect">Disconnect</button>' : ''}
      </div>
    </div>
    <div class="rr-card">
      <div class="rr-card-title">Updates</div>
      <div class="rr-kv"><span>Current</span><strong id="rr-update-current">${escapeHtml(VERSION)}</strong></div>
      <div class="rr-kv"><span>Channel</span><strong id="rr-update-channel">${escapeHtml(UPDATE_CHANNEL)}</strong></div>
      <div class="rr-kv"><span>Latest</span><strong id="rr-update-latest">${escapeHtml(updateResult?.latestVersion || 'Unknown')}</strong></div>
      <div class="rr-kv"><span>Checked</span><strong id="rr-update-checked">${escapeHtml(updateResult?.lastCheckedAt ? formatDate(updateResult.lastCheckedAt) : 'Not yet')}</strong></div>
      <div id="rr-update-banner">${updateResult?.updateAvailable ? `Update ${escapeHtml(updateResult.latestVersion)} available.` : ''}</div>
      <div class="rr-actions"><button id="rr-update-check">Check updates</button><button id="rr-update-switch">Switch update channel</button></div>
    </div>
    <div class="rr-card">
      <div class="rr-card-title">Sanitized diagnostics</div>
      <label><input id="rr-diagnostics-enabled" type="checkbox" ${GM_getValue(KEYS.clientDiagnosticsEnabled, false) ? 'checked' : ''}> Send sanitized ReviveRelay error diagnostics</label>
      <p class="rr-muted">Diagnostics exclude API keys, bearer tokens, payment receiver credentials and public chat content.</p>
    </div>`;
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

  function renderAll() {
    if (!panel) return;
    renderSummary();
    renderRequestPanel();
    renderReviverPanel();
    renderActivityPanel();
    renderSettingsPanel();
    renderStatus();
    updateTabVisibility();
  }

  function updateTabVisibility() {
    if (!panel) return;
    for (const button of panel.querySelectorAll('[data-rr-tab]')) {
      const selected = button.dataset.rrTab === state.panelTab;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.classList.toggle('rr-tab-active', selected);
    }
    for (const section of panel.querySelectorAll('[data-rr-panel]')) {
      section.hidden = section.dataset.rrPanel !== state.panelTab;
    }
  }

  function activatePanelTab(tab) {
    state.panelTab = Core.normalizePanelTab(tab);
    GM_setValue(KEYS.panelTab, state.panelTab);
    if (state.minimized) {
      state.minimized = false;
      GM_setValue(KEYS.minimized, state.minimized);
      if (body) body.style.display = state.minimized ? 'none' : '';
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
    const fallback = { x: Math.max(8, (window.innerWidth || 1200) - 438), y: 90 };
    const next = Core.clampPanelPosition(position || fallback, panelViewport(), panelSize(), 8);
    state.panelPosition = next;
    panel.style.left = `${Math.round(next.x)}px`;
    panel.style.top = `${Math.round(next.y)}px`;
    panel.style.right = 'auto';
  }

  function persistPanelPosition() {
    if (!state.panelPosition) return;
    GM_setValue(KEYS.panelPosition, state.panelPosition);
  }

  function resetPanelPosition() {
    state.panelPosition = null;
    GM_setValue(KEYS.panelPosition, null);
    applyPanelPosition(null);
    persistPanelPosition();
  }

  function installPanelDrag(header) {
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
    header.addEventListener('pointerup', event => {
      if (!dragging) return;
      dragging = false;
      try { header.releasePointerCapture(event.pointerId); } catch (_) {}
      persistPanelPosition();
    });
    header.addEventListener('dblclick', event => {
      if (event.target?.closest?.('button,input,select,textarea,a')) return;
      resetPanelPosition();
    });
  }

  async function checkUpdates(force = false) {
    updateResult = await state.updateManager.check({ force });
    renderSettingsPanel();
  }

  function switchUpdateChannel() {
    const target = UPDATE_CHANNEL === 'automatic' ? 'manual' : 'automatic';
    if (!state.updateManager.switchChannel(target)) setStatus('Update channel cannot be switched until a manifest has been loaded.', true);
  }

  function createPanel() {
    GM_addStyle(`
      #rr-panel{position:fixed;z-index:999999;width:min(420px,calc(100vw - 16px));max-height:calc(100vh - 16px);background:#11161b;color:#d9e0e6;border:1px solid #3e4851;border-radius:9px;box-shadow:0 14px 40px rgba(0,0,0,.45);font:12px/1.45 Arial,sans-serif;overflow:hidden}
      #rr-header{display:flex;align-items:center;gap:9px;padding:9px 10px;background:#171d23;border-bottom:1px solid #343d45;cursor:move;user-select:none}
      .rr-brand{font-weight:800;letter-spacing:.06em}.rr-brand small{display:block;font-size:9px;color:#7f8b95;font-weight:500}.rr-spacer{flex:1}
      #rr-connection-pill{font-size:9px;padding:2px 6px;border-radius:8px;background:#3a2424;color:#eaa}.rr-connected{background:#21382d!important;color:#9ed8b6!important}
      #rr-minimize{border:1px solid #46515b;background:#20272e;color:#d9e0e6;border-radius:5px;padding:2px 7px}
      #rr-body{overflow:auto;max-height:calc(100vh - 58px)}.rr-tabs{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #303840;background:#12171c}
      .rr-tabs button{border:0;border-right:1px solid #2a3239;background:transparent;color:#87939d;padding:8px 4px;font:inherit}.rr-tabs button:last-child{border-right:0}.rr-tabs .rr-tab-active{color:#f0f4f7;background:#1d252c}
      .rr-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#303840}.rr-summary>div{background:#151b20;padding:7px;text-align:center}.rr-summary span{display:block;color:#76838d;font-size:9px}.rr-summary strong{font-size:11px}
      .rr-panel-content{padding:8px}.rr-card{background:#171d22;border:1px solid #303a42;border-radius:7px;padding:9px;margin-bottom:8px}.rr-card-title{font-weight:800;margin-bottom:6px;color:#eef2f5}
      .rr-kv{display:flex;justify-content:space-between;gap:12px;padding:3px 0}.rr-kv span{color:#85919b}.rr-kv strong{text-align:right}.rr-muted{color:#798690;font-size:10px}.rr-status{padding:6px 9px;color:#8fa9ba;border-top:1px solid #303840;min-height:16px}.rr-status-error{color:#e4a1a1}
      .rr-actions,.rr-form-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.rr-label{display:block;color:#9aa6af;margin:7px 0 3px}.rr-card input,.rr-card select,.rr-card textarea{box-sizing:border-box;width:100%;border:1px solid #3a4650;background:#0f1418;color:#e0e5e9;border-radius:5px;padding:6px;font:inherit}.rr-card button{border:1px solid #48545e;background:#242d34;color:#e6ebee;border-radius:5px;padding:5px 8px;font:inherit;cursor:pointer}.rr-card button:disabled{opacity:.45;cursor:not-allowed}
      .rr-certified-card{border-color:#806c3b;box-shadow:inset 3px 0 0 #b89a52}.rr-certified-line,.rr-queue-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.rr-star{color:#d5b461}.rr-chip{font-size:8px;border:1px solid #88743e;color:#d9bc72;border-radius:8px;padding:1px 5px}.rr-offer{font-size:15px;font-weight:800;margin-top:7px}.rr-comment{margin:4px 0;color:#bcc5cc}.rr-deadlines{margin-top:6px}.rr-deadlines>div{display:flex;justify-content:space-between;color:#8e9aa3}.rr-invoice{margin-top:7px;padding-top:7px;border-top:1px solid #313a42}
      @media(max-width:520px){#rr-panel{width:calc(100vw - 16px)}.rr-tabs button{font-size:10px}}
    `);

    panel = document.createElement('section');
    panel.id = 'rr-panel';
    panel.innerHTML = `<div id="rr-header">
      <div class="rr-brand">REVIVERELAY<small>VOIDsMITH INDUSTRIES · v${escapeHtml(VERSION)}</small></div>
      <div class="rr-spacer"></div>
      <span id="rr-connection-pill">OFFLINE</span>
      <button id="rr-minimize" type="button" aria-label="Minimize ReviveRelay">▾</button>
    </div>
    <div id="rr-body">
      <div class="rr-tabs" role="tablist">
        <button data-rr-tab="request" role="tab" aria-selected="false">Request</button>
        <button data-rr-tab="reviver" role="tab" aria-selected="false">Reviver</button>
        <button data-rr-tab="activity" role="tab" aria-selected="false">Activity</button>
        <button data-rr-tab="settings" role="tab" aria-selected="false">Settings</button>
      </div>
      <div class="rr-summary">
        <div><span>REQUEST</span><strong id="rr-summary-request">None</strong></div>
        <div><span>ACCESS</span><strong id="rr-summary-pro">FREE</strong></div>
        <div><span>QUEUE</span><strong id="rr-summary-queue">0</strong></div>
      </div>
      <section class="rr-panel-content" data-rr-panel="request"><div id="rr-requester"></div></section>
      <section class="rr-panel-content" data-rr-panel="reviver"><div id="rr-reviver-content"></div></section>
      <section class="rr-panel-content" data-rr-panel="activity"><div id="rr-activity-ledger"></div></section>
      <section class="rr-panel-content" data-rr-panel="settings"><div id="rr-settings-content"></div></section>
      <div id="rr-status" class="rr-status"></div>
    </div>`;
    document.body.appendChild(panel);
    body = panel.querySelector('#rr-body');
    connectionPill = panel.querySelector('#rr-connection-pill');
    body.style.display = state.minimized ? 'none' : '';
    installPanelDrag(panel.querySelector('#rr-header'));
    applyPanelPosition(state.panelPosition);

    panel.addEventListener('click', event => {
      const target = event.target;
      const tab = target.closest?.('[data-rr-tab]');
      if (tab) return activatePanelTab(tab.dataset.rrTab);
      const accept = target.closest?.('[data-rr-accept]');
      if (accept) return acceptMarketplaceRequest(accept.dataset.rrAccept);
      const tx = target.closest?.('[data-rr-tx-action]');
      if (tx) return runTransactionAction(tx.dataset.rrTxAction);
      if (target.closest?.('[data-rr-open-settings]')) return activatePanelTab('settings');
      if (target.id === 'rr-connect') return connectIdentity();
      if (target.id === 'rr-cancel-request') return cancelActiveRequest();
      if (target.id === 'rr-save-preset') return saveRequestPreset();
      if (target.id === 'rr-start-trial' || target.id === 'rr-start-trial-inline') return startProTrial();
      if (target.id === 'rr-create-pro-invoice') return createProInvoice();
      if (target.id === 'rr-refresh-invoice') return refreshCurrentInvoice().then(renderAll).catch(error => handleApiFailure(error, 'pro.invoice.refresh'));
      if (target.id === 'rr-bind-verification') return bindVerificationKey();
      if (target.id === 'rr-revoke-verification') return revokeVerificationKey();
      if (target.id === 'rr-register-reviver') return registerMarketplaceReviver();
      if (target.id === 'rr-refresh') return refreshMarketplaceState({ includePlans: true }).then(renderAll).catch(error => handleApiFailure(error, 'manual.refresh'));
      if (target.id === 'rr-disconnect') return clearSession();
      if (target.id === 'rr-update-check') return checkUpdates(true);
      if (target.id === 'rr-update-switch') return switchUpdateChannel();
      if (target.id === 'rr-minimize') {
        state.minimized = !state.minimized;
        GM_setValue(KEYS.minimized, state.minimized);
        body.style.display = state.minimized ? 'none' : '';
        applyPanelPosition(state.panelPosition);
      }
    });

    panel.addEventListener('change', event => {
      if (event.target?.id === 'rr-diagnostics-enabled') {
        GM_setValue(KEYS.clientDiagnosticsEnabled, Boolean(event.target.checked));
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

  function installSidebar() {
    state.sidebarController = SidebarAction.createSidebarController({
      document,
      window,
      label: 'ReviveRelay → Revive Me!',
      getState: sidebarState,
      onActivate: handleSidebarActivate
    });
    state.sidebarController.reconcile();
    window.addEventListener('popstate', () => setTimeout(refreshSidebarState, 150));
    window.addEventListener('hashchange', () => setTimeout(refreshSidebarState, 150));
  }

  function startTimers() {
    requestTimer = setInterval(() => {
      if (!state.sessionToken) return;
      refreshActiveRequest().then(renderAll).catch(error => handleApiFailure(error, 'poll.request'));
    }, REQUEST_POLL_MS);
    proTimer = setInterval(() => {
      if (!state.sessionToken) return;
      refreshProState({ includePlans: false }).then(() => refreshVerificationCredential()).then(renderAll).catch(error => handleApiFailure(error, 'poll.pro'));
    }, PRO_POLL_MS);
    queueTimer = setInterval(() => {
      if (!state.sessionToken || !isProActive()) return;
      refreshReviverQueue().then(renderAll).catch(error => handleApiFailure(error, 'poll.queue'));
    }, QUEUE_POLL_MS);
    invoiceTimer = setInterval(() => {
      if (state.minimized || document.visibilityState !== 'visible' || state.currentInvoice?.state !== 'PENDING') return;
      refreshCurrentInvoice().then(renderAll).catch(error => handleApiFailure(error, 'poll.invoice'));
    }, INVOICE_POLL_MS);
    sidebarTimer = setInterval(refreshSidebarState, SIDEBAR_RECONCILE_MS);
    telemetryTimer = setInterval(() => {
      if (!GM_getValue(KEYS.clientDiagnosticsEnabled, false)) return;
      state.telemetry.drain().catch(() => {});
    }, TELEMETRY_DRAIN_MS);
    clockTimer = setInterval(() => {
      if (!state.minimized && (state.activeTransaction || state.reviverQueue.length)) renderAll();
    }, 1000);
  }

  async function init() {
    createPanel();
    installSidebar();
    installGlobalErrorHooks();
    startTimers();
    refreshSidebarState();
    await restoreSession();
    renderAll();
    checkUpdates(false).catch(error => captureClientError(error, 'update.initial'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
