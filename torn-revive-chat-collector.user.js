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
// ReviveRelay-Build-Timestamp: __REVIVERELAY_BUILD_TIMESTAMP__
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '__REVIVERELAY_VERSION__';
  const UPDATE_CHANNEL = '__REVIVERELAY_UPDATE_CHANNEL__';
  const BUILD_COMMIT = '__REVIVERELAY_GIT_COMMIT__';
  const BUILD_TIMESTAMP = '__REVIVERELAY_BUILD_TIMESTAMP__';
  const API_BASE = 'https://reviverelay.voidsmithindustries.com/review';
  const REVIVER_ELIGIBILITY_TIMEOUT_MS = 12_000;
  // An open panel re-reads /me, Pro status (and plans) and Torn eligibility at most this often.
  const PANEL_SLOW_REFRESH_MS = 60_000;
  const MAX_SEEN_REQUEST_IDS = 200;
  const REVIVERELAY_API_KEY_URL = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=ReviveRelay&user=basic,profile,revives,log,perks&logIds=14,15,16,17';
  const MASKED_VERIFICATION_KEY = '••••••••••••••••';

  const KEYS = Object.freeze({
    sessionToken: 'reviverelay_session_token',
    publicIdentity: 'reviverelay_public_identity',
    requestPreset: 'reviverelay_request_preset',
    seenRequestIds: 'reviverelay_seen_request_ids',
    stateSnapshot: 'reviverelay_state_snapshot_v1',
    panelPosition: 'reviverelay_panel_position',
    panelTab: 'reviverelay_panel_tab',
    updateState: 'reviverelay_update_state',
    desktopNotificationsEnabled: 'reviverelay_desktop_notifications_enabled',
    clientDiagnosticsEnabled: 'reviverelay_client_diagnostics_enabled',
    telemetryOutbox: 'reviverelay_telemetry_outbox'
  });

  const Platform = globalThis.ReviveRelayPlatform;
  const LEGACY_DEFAULTS = Object.freeze({
    [KEYS.sessionToken]: '',
    [KEYS.publicIdentity]: null,
    [KEYS.requestPreset]: null,
    [KEYS.seenRequestIds]: [],
    [KEYS.stateSnapshot]: null,
    [KEYS.panelPosition]: null,
    [KEYS.panelTab]: 'request',
    [KEYS.updateState]: {},
    [KEYS.desktopNotificationsEnabled]: true,
    [KEYS.clientDiagnosticsEnabled]: false,
    [KEYS.telemetryOutbox]: []
  });

  const Core = globalThis.TornReviveCore;
  const DirectApiClient = globalThis.ReviveRelayDirectApiClient;
  const PanelApiClient = globalThis.ReviveRelayPanelApiClient;
  const UpdateManager = globalThis.ReviveRelayUpdateManager;
  const TelemetryClient = globalThis.ReviveRelayTelemetryClient;
  const RequestPreset = globalThis.ReviveRelayRequestPreset;
  const LiteBoot = globalThis.ReviveRelayLiteBoot;

  if (!Platform || !Core || !DirectApiClient || !PanelApiClient || !UpdateManager || !TelemetryClient || !RequestPreset || !LiteBoot) {
    console.error('[ReviveRelay] Required direct-runtime dependency unavailable.');
    return;
  }

  const platform = Platform.createPlatform({
    globalObject: globalThis,
    window,
    document,
    gm: {
      getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
      setValue: typeof GM_setValue === 'function' ? GM_setValue : null,
      xmlHttpRequest: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
      addStyle: typeof GM_addStyle === 'function' ? GM_addStyle : null,
      notification: typeof GM_notification === 'function' ? GM_notification : null
    },
    storageKeys: Object.values(KEYS),
    legacyDefaults: LEGACY_DEFAULTS,
    onError: (error, context) => console.warn('[ReviveRelay]', context, error?.message || error)
  });
  const storage = platform.storage;
  const requestTransport = platform.request;
  const state = {
    api: null,
    telemetry: null,
    updateManager: null,
    sessionToken: '',
    identity: null,
    preset: null,
    activeRequest: null,
    // No "Request" button until this session's active request was read.
    activeRequestLoaded: false,
    activeTransaction: null,
    verificationCredential: null,
    verificationEditing: false,
    reviverEligibility: null,
    reviverQueue: [],
    queuePaymentFilter: 'all',
    queueMinCash: 0,
    queueMinXanax: 0,
    queueSort: 'newest',
    queueGroup: 'payment',
    proStatus: null,
    runtime: null,
    runtimeCompatibility: 'unknown',
    runtimeCompatibilityReason: null,
    subscription: null,
    proPlans: [],
    currentInvoice: null,
    submittingRequest: false,
    settingsOpen: false,
    settingsSection: null,
    // The panel starts closed on every page; the header pill opens it.
    minimized: true,
    panelPosition: null,
    panelTab: 'request'
  };

  let panel = null;
  let connectionPill = null;
  let initPromise = null;
  let liteBoot = null;
  let latestPillStateVersion = null;
  let panelStateVersion = null;
  let statusMessage = '';
  let statusIsError = false;
  let panelSlowRefreshAt = null;
  let panelProRolesKey = null;
  let errorHooksInstalled = false;
  let initRetry = null;
  let retryPill = null;
  let updateResult = null;
  const pollFlights = new Map();
  const mutationFlights = new Set();
  const authoritativeStateRevisions = new Map();

  state.api = PanelApiClient.createPanelApiClient({
    baseUrl: API_BASE,
    getToken: () => state.sessionToken,
    request: requestTransport,
    clientVersion: VERSION,
    releaseChannel: UPDATE_CHANNEL
  });

  state.telemetry = TelemetryClient.createTelemetryClient({
    submit: payload => state.api.submitTelemetry(payload.errors),
    getStoredQueue: () => storage.get(KEYS.telemetryOutbox, []),
    saveStoredQueue: queue => storage.set(KEYS.telemetryOutbox, Array.isArray(queue) ? queue : []),
    version: VERSION,
    buildCommit: BUILD_COMMIT
  });

  state.updateManager = UpdateManager.createUpdateManager({
    currentVersion: VERSION,
    channel: UPDATE_CHANNEL,
    fetchText: async url => {
      const response = await requestTransport({
        method: 'GET',
        url,
        headers: { Accept: 'text/plain' },
        timeoutMs: 10_000
      });
      if (!response || response.status < 200 || response.status >= 300 || typeof response.responseText !== 'string') {
        throw new Error('ReviveRelay update metadata unavailable');
      }
      return response.responseText;
    },
    getState: () => storage.get(KEYS.updateState, {}),
    saveState: value => storage.set(KEYS.updateState, value),
    openUrl: url => platform.openUrl(url)
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
    return state.proStatus?.state === 'TRIAL' || state.proStatus?.state === 'ACTIVE' || state.proStatus?.state === 'OWNER';
  }

  function runtimeCompatible() {
    return state.runtimeCompatibility === 'compatible';
  }

  function subscriptionMode() {
    if (state.runtimeCompatibility !== 'compatible') return 'unknown';
    return ['free', 'review', 'live'].includes(state.subscription?.mode)
      ? state.subscription.mode
      : 'unknown';
  }

  function subscriptionPaymentsEnabled() {
    return state.runtimeCompatibility === 'compatible' && state.subscription?.paymentsEnabled === true;
  }

  function hasReviverSubscriptionAccess() {
    if (state.runtimeCompatibility !== 'compatible') return false;
    if (state.proStatus?.state === 'REVOKED' || state.reviverEligibility?.status === 'DENIED') return false;
    return subscriptionMode() === 'free' || isProActive();
  }

  function applyRuntimeContract(runtime) {
    const result = PanelApiClient.validateReviewRuntime(runtime, {
      clientVersion: VERSION,
      releaseChannel: UPDATE_CHANNEL
    });
    state.runtime = runtime && typeof runtime === 'object' ? runtime : null;
    state.runtimeCompatibility = result.compatible ? 'compatible' : 'incompatible';
    state.runtimeCompatibilityReason = result.reason || null;
    if (result.compatible) {
      state.subscription = result.subscription;
      state.proPlans = Array.isArray(result.subscription?.plans) ? result.subscription.plans : [];
    } else {
      invalidateAuthoritativeState('pro');
      invalidateAuthoritativeState('queue');
      invalidateAuthoritativeState('eligibility');
      invalidateAuthoritativeState('invoice');
      state.subscription = null;
      state.proPlans = [];
      state.proStatus = null;
      state.reviverQueue = [];
      state.reviverEligibility = null;
    }
    return result;
  }

  function runtimeCompatibilityMessage() {
    if (state.runtimeCompatibility === 'unknown') return 'Checking the ReviveRelay review backend…';
    if (state.runtimeCompatibilityReason === 'RUNTIME_CHANNEL_MISMATCH') return 'This review client reached the wrong ReviveRelay backend. Protected actions are disabled.';
    if (state.runtimeCompatibilityReason === 'CLIENT_TOO_OLD') return 'This ReviveRelay review build is too old for the review backend. Update ReviveRelay before continuing.';
    return 'ReviveRelay review backend is incompatible or unavailable. Protected actions are disabled.';
  }

  function withTimeout(promise, ms, code) {
    let timer;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms);
    });
    return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
  }

  function runSingleFlightPoll(key, operation) {
    const existing = pollFlights.get(key);
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (pollFlights.get(key) === promise) pollFlights.delete(key);
      });
    pollFlights.set(key, promise);
    return promise;
  }

  function beginAuthoritativeRefresh(key) {
    const revision = (authoritativeStateRevisions.get(key) || 0) + 1;
    authoritativeStateRevisions.set(key, revision);
    return revision;
  }

  function invalidateAuthoritativeState(key) {
    return beginAuthoritativeRefresh(key);
  }

  function applyAuthoritativeState(key, revision, apply) {
    if (authoritativeStateRevisions.get(key) !== revision) return false;
    apply();
    return true;
  }

  function mutationBusy(key) {
    return mutationFlights.has(key);
  }

  function disabledAttr(key) {
    return mutationBusy(key) ? ' disabled aria-disabled="true"' : '';
  }

  async function runMutation(key, operation) {
    if (!syncPanelSession() || mutationFlights.has(key)) return null;
    mutationFlights.add(key);
    try {
      renderLiveState();
      renderProPanel();
      if (state.settingsOpen) renderSettingsDrawer();
      return await operation();
    } finally {
      mutationFlights.delete(key);
      renderLiveState();
      renderProPanel();
      if (state.settingsOpen) renderSettingsDrawer();
      refreshPill();
    }
  }

  function hasConfirmedReviveAbility() {
    return state.reviverEligibility?.canRevive === true;
  }

  function publicIdentity() {
    if (!state.identity) return null;
    return { tornId: state.identity.tornId, name: state.identity.name };
  }

  function captureClientError(error, operation) {
    if (!storage.get(KEYS.clientDiagnosticsEnabled, false)) return;
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

  function userFacingApiErrorMessage(error, fallback = 'ReviveRelay request failed.') {
    const code = apiErrorCode(error);
    const messages = {
      REVIVE_ABILITY_NOT_UNLOCKED: 'This Torn account does not currently have permanent revive ability.',
      REVIVE_ABILITY_PERMISSION_REQUIRED: 'Update your Torn API key so ReviveRelay can confirm your revive ability.',
      VERIFICATION_CREDENTIAL_INSUFFICIENT: 'Your Torn API key does not have the permissions required by ReviveRelay. Replace it with a correctly configured Torn API key.',
      REQUESTER_VERIFICATION_REQUIRED: 'The requester has not connected a suitable Torn API key yet. This request cannot be accepted until requester evidence is ready.',
      INVOICE_NOT_FOUND: 'This Pro invoice is unavailable for your account.',
      INVOICE_EXPIRED: 'This Pro invoice has expired. Create a new invoice.',
      CLIENT_UPDATE_REQUIRED: 'Update ReviveRelay before continuing.',
      TORN_UNAVAILABLE: 'Torn is temporarily unavailable. Try again shortly.',
      SUBSCRIPTION_PAYMENTS_DISABLED: 'Reviver Pro payments are not required in the current subscription mode.'
    };
    return messages[code] || fallback;
  }

  function handleApiFailure(error, operation, userMessage = 'ReviveRelay request failed.') {
    captureClientError(error, operation);
    if (apiErrorCode(error) === 'AUTH_REQUIRED') {
      clearSession('Your ReviveRelay session expired. Verify & connect again.');
      return;
    }
    setStatus(userFacingApiErrorMessage(error, userMessage), true);
  }

  // Forgets this tab's per-user panel state (memory only).
  function resetPanelUserState() {
    state.api.clearBoundToken();
    for (const key of ['pro', 'queue', 'eligibility', 'invoice']) invalidateAuthoritativeState(key);
    Object.assign(state, {
      sessionToken: '', identity: null, activeRequest: null, activeRequestLoaded: false, activeTransaction: null,
      verificationCredential: null, verificationEditing: false, reviverEligibility: null, reviverQueue: [],
      proStatus: null, runtime: null, runtimeCompatibility: 'unknown', runtimeCompatibilityReason: null,
      subscription: null, proPlans: [], currentInvoice: null, submittingRequest: false
    });
    panelSlowRefreshAt = null;
  }

  function clearSession(message = 'Disconnected from ReviveRelay.') {
    resetPanelUserState();
    storage.set(KEYS.sessionToken, '');
    storage.set(KEYS.publicIdentity, null);
    setStatus(message, false);
    resetLiteSession();
    renderAll();
  }

  // Another tab may have signed out or switched account: follow shared storage before sending
  // anything. Returns false when this tab's session was stale.
  function syncPanelSession() {
    if (sharedSessionToken() === state.sessionToken) return true;
    resetPanelUserState();
    hydrateSession();
    renderAll();
    return false;
  }

  async function refreshMe() {
    if (!state.sessionToken) return null;
    const revision = beginAuthoritativeRefresh('pro');
    const me = await state.api.getMe();
    applyAuthoritativeState('pro', revision, () => {
      state.identity = {
        ...(me?.user || {}),
        roles: Array.isArray(me?.roles) ? me.roles : []
      };
      const runtimeResult = applyRuntimeContract(me?.runtime || null);
      state.proStatus = runtimeResult.compatible && me?.pro ? me.pro : null;
      // A stale tab never overwrites the identity another tab signed in with.
      if (state.sessionToken === sharedSessionToken()) storage.set(KEYS.publicIdentity, publicIdentity());
    });
    return me;
  }

  async function connectIdentity() {
    const apiKeyInput = document.getElementById('rr-api-key');
    const apiKey = String(apiKeyInput?.value || '').trim();
    if (!apiKey) {
      setStatus('Enter your Torn API key first.', true);
      return;
    }
    setStatus('Connecting your Torn API key…');
    try {
      const result = await state.api.bind(apiKey, VERSION);
      const verificationResult = await state.api.bindVerificationCredential(apiKey);
      state.sessionToken = String(result?.token || '');
      state.identity = result?.user ? { ...result.user, roles: ['requester'] } : null;
      state.verificationCredential = verificationResult?.credential || null;
      state.verificationEditing = false;
      if (apiKeyInput) apiKeyInput.value = '';
      storage.set(KEYS.sessionToken, state.sessionToken);
      storage.set(KEYS.publicIdentity, publicIdentity());
      resetLiteSession();
      await refreshMarketplaceState();
      setStatus(runtimeCompatible() ? 'ReviveRelay connected with your Torn API key.' : runtimeCompatibilityMessage(), !runtimeCompatible());
      renderAll();
    } catch (error) {
      state.api.clearBoundToken();
      state.sessionToken = '';
      state.identity = null;
      state.verificationCredential = null;
      if (apiKeyInput) apiKeyInput.value = '';
      handleApiFailure(error, 'identity.bind', 'Torn API key connection failed.');
    }
  }

  async function refreshProState() {
    return runSingleFlightPoll('pro', async () => {
      if (!state.sessionToken) {
        state.proStatus = null;
        state.runtime = null;
        state.runtimeCompatibility = 'unknown';
        state.runtimeCompatibilityReason = null;
        state.subscription = null;
        state.proPlans = [];
        return;
      }
      const revision = beginAuthoritativeRefresh('pro');
      const result = await state.api.getProStatus();
      applyAuthoritativeState('pro', revision, () => {
        const runtimeResult = applyRuntimeContract(result?.runtime || null);
        state.proStatus = runtimeResult.compatible ? (result?.pro || null) : null;
      });
    });
  }

  async function refreshActiveRequest() {
    return runSingleFlightPoll('request', async () => {
      if (!state.sessionToken || !runtimeCompatible()) {
        state.activeRequest = null;
        state.activeRequestLoaded = false;
        return;
      }
      const result = await state.api.getActiveRequest();
      state.activeRequest = result?.request || null;
      state.activeRequestLoaded = true;
      if (state.activeRequest?.transactionId) await refreshActiveTransaction(state.activeRequest.transactionId);
      else if (state.activeTransaction?.participantRole === 'requester') state.activeTransaction = null;
    });
  }

  async function refreshActiveTransaction(transactionId = null) {
    return runSingleFlightPoll('transaction', async () => {
      const id = transactionId || state.activeTransaction?.id || state.activeRequest?.transactionId;
      if (!state.sessionToken || !runtimeCompatible() || !id) return;
      const result = await state.api.getTransaction(id);
      state.activeTransaction = result?.transaction || result || null;
    });
  }

  async function refreshVerificationCredential() {
    if (!state.sessionToken || !runtimeCompatible()) {
      state.verificationCredential = null;
      state.reviverEligibility = null;
      return;
    }
    const result = await state.api.getVerificationCredential();
    state.verificationCredential = result?.credential || null;
    if (!hasCredentialCapability('reviver')) state.reviverEligibility = null;
  }

  async function refreshReviverEligibility() {
    return runSingleFlightPoll('eligibility', async () => {
      if (state.reviverEligibility?.status === 'UNAVAILABLE') return;
      if (!state.sessionToken || !hasReviverSubscriptionAccess() || !hasCredentialCapability('reviver')) {
        state.reviverEligibility = null;
        return;
      }
      const revision = beginAuthoritativeRefresh('eligibility');
      try {
        const result = await withTimeout(state.api.getReviverEligibility(), REVIVER_ELIGIBILITY_TIMEOUT_MS, 'REVIVER_ELIGIBILITY_TIMEOUT');
        applyAuthoritativeState('eligibility', revision, () => {
          state.reviverEligibility = result?.eligibility || null;
        });
      } catch (error) {
        const timedOut = error && error.code === 'REVIVER_ELIGIBILITY_TIMEOUT';
        applyAuthoritativeState('eligibility', revision, () => {
          state.reviverEligibility = { status: timedOut ? 'TIMEOUT' : 'UNAVAILABLE', canRevive: null };
        });
        captureClientError(error, 'reviver.eligibility');
      }
    });
  }

  function readSeenRequestIds() {
    const stored = storage.get(KEYS.seenRequestIds, []);
    return Array.isArray(stored) ? stored.map(String).slice(-MAX_SEEN_REQUEST_IDS) : [];
  }

  function writeSeenRequestIds(ids) {
    const bounded = Array.from(new Set(ids.map(String))).slice(-MAX_SEEN_REQUEST_IDS);
    storage.set(KEYS.seenRequestIds, bounded);
  }

  function desktopNotificationsEnabled() {
    return Boolean(storage.get(KEYS.desktopNotificationsEnabled, true));
  }

  function notifyNewQueueRequests(requests) {
    if (!hasReviverSubscriptionAccess() || !hasRole('reviver') || !hasCredentialCapability('reviver') || !hasConfirmedReviveAbility()) return;
    const seen = new Set(readSeenRequestIds());
    const next = [...seen];
    const canNotify = desktopNotificationsEnabled() && typeof platform.notify === 'function';
    for (const request of Array.isArray(requests) ? requests : []) {
      const id = String(request?.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
      const offer = formatOffer(request.paymentMethod, request.offerAmount);
      const requester = `${request.requesterName || 'Player'} [${request.requesterTornId || '?'}]`;
      if (!canNotify) continue;
      try {
        platform.notify({
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
    return runSingleFlightPoll('queue', async () => {
      if (!state.sessionToken || !hasReviverSubscriptionAccess()) {
        state.reviverQueue = [];
        return;
      }
      if (!hasRole('reviver') || !hasCredentialCapability('reviver') || !hasConfirmedReviveAbility()) {
        state.reviverQueue = [];
        return;
      }
      const revision = beginAuthoritativeRefresh('queue');
      const result = await state.api.getReviverQueue();
      applyAuthoritativeState('queue', revision, () => {
        state.reviverQueue = Array.isArray(result?.requests) ? result.requests : [];
        notifyNewQueueRequests(state.reviverQueue);
      });
    });
  }

  async function refreshCurrentInvoice() {
    return runSingleFlightPoll('invoice', async () => {
      if (!state.sessionToken || !runtimeCompatible() || state.currentInvoice?.state !== 'PENDING' || !state.currentInvoice?.id) return;
      const revision = beginAuthoritativeRefresh('invoice');
      const result = await state.api.getProInvoice(state.currentInvoice.id);
      const applied = applyAuthoritativeState('invoice', revision, () => {
        state.currentInvoice = {
          ...(result?.invoice || {}),
          paymentTarget: result?.paymentTarget || state.currentInvoice.paymentTarget || null
        };
      });
      if (!applied) return;
      if (state.currentInvoice.state === 'PAID') {
        await refreshProState();
        await refreshVerificationCredential();
        await refreshReviverEligibility();
        await refreshReviverQueue();
      }
    });
  }

  async function refreshMarketplaceState() {
    if (!state.sessionToken) return;
    await refreshMe();
    if (!runtimeCompatible()) return;
    await refreshProState();
    if (!runtimeCompatible()) return;
    await refreshActiveRequest();
    await refreshVerificationCredential();
    await refreshReviverEligibility();
    await refreshReviverQueue();
    if (state.activeTransaction?.id) await refreshActiveTransaction(state.activeTransaction.id);
  }

  async function requestRevive() {
    const validation = RequestPreset.validatePreset(state.preset);
    if (!state.sessionToken || !runtimeCompatible() || !validation.ok || state.submittingRequest || !state.activeRequestLoaded || state.activeRequest) return;
    return runMutation('request-create', async () => {
      state.submittingRequest = true;
      renderAll();
      try {
        const result = await state.api.createRequest(validation.preset);
        state.activeRequest = result?.request || null;
        setStatus(hasCredentialCapability('requester')
          ? 'Certified revive request submitted.'
          : 'Certified revive request submitted. Requester verification is required before a reviver can accept it.');
      } catch (error) {
        handleApiFailure(error, 'request.create', 'Could not create revive request.');
      } finally {
        state.submittingRequest = false;
        renderAll();
      }
    });
  }

  async function cancelActiveRequest() {
    if (!runtimeCompatible() || !state.activeRequest?.id) return;
    return runMutation('request-cancel', async () => {
      try {
        await state.api.cancelRequest(state.activeRequest.id);
        state.activeRequest = null;
        state.activeTransaction = null;
        setStatus('Revive request cancelled.');
        await refreshActiveRequest();
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'request.cancel', 'Request could not be cancelled.');
      }
    });
  }

  async function deleteReviveRelayAccount() {
    if (!state.sessionToken || !runtimeCompatible()) return;
    const confirmed = window.confirm(
      'Delete ReviveRelay account/data? This immediately removes or invalidates your verification credential, active sessions, service preferences, and active reviver registration where safe. Minimal billing/payment and security/audit evidence may be retained to prevent payment reuse and support refunds or disputes.'
    );
    if (!confirmed) return;
    return runMutation('account-delete', async () => {
      try {
        await state.api.deleteAccount();
        resetPanelUserState();
        state.preset = null;
        storage.set(KEYS.sessionToken, '');
        storage.set(KEYS.publicIdentity, null);
        storage.set(KEYS.requestPreset, null);
        storage.set(KEYS.seenRequestIds, []);
        storage.set(KEYS.updateState, {});
        storage.set(KEYS.clientDiagnosticsEnabled, false);
        storage.set(KEYS.telemetryOutbox, []);
        setStatus('ReviveRelay account data deletion completed. Minimal billing/security evidence may remain only where required for payment-reuse prevention, refunds, disputes, or audit history.');
        resetLiteSession();
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'account.delete', 'ReviveRelay account deletion failed.');
      }
    });
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
    storage.set(KEYS.requestPreset, validation.preset);
    setStatus('Revive Me preset saved.');
    renderAll();
  }

  async function startProTrial() {
    if (!runtimeCompatible()) {
      setStatus(runtimeCompatibilityMessage(), true);
      return;
    }
    return runMutation('trial-start', async () => {
      try {
        const result = await state.api.startProTrial();
        invalidateAuthoritativeState('pro');
        state.proStatus = result?.pro || null;
        setStatus('7-day Reviver Pro trial activated.');
        await refreshVerificationCredential();
        await refreshReviverQueue();
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'pro.trial', 'Trial could not be activated.');
      }
    });
  }

  async function createProInvoice() {
    if (!runtimeCompatible()) {
      setStatus(runtimeCompatibilityMessage(), true);
      return;
    }
    if (!subscriptionPaymentsEnabled()) {
      setStatus('Reviver Pro payments are not required in the current subscription mode.');
      return;
    }
    const planId = document.getElementById('rr-pro-plan')?.value;
    const currency = document.getElementById('rr-pro-currency')?.value;
    return runMutation('invoice-create', async () => {
      try {
        const result = await state.api.createProInvoice({ planId, currency });
        invalidateAuthoritativeState('invoice');
        state.currentInvoice = {
          ...(result?.invoice || {}),
          paymentTarget: result?.paymentTarget || null
        };
        setStatus('Pro payment invoice created.');
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'pro.invoice.create', 'Pro invoice could not be created.');
      }
    });
  }

  async function bindVerificationKey() {
    if (!state.sessionToken || !runtimeCompatible()) return;
    const verificationKeyInput = document.getElementById('rr-verification-key');
    const key = String(verificationKeyInput?.value || '').trim();
    if (!key) {
      setStatus('Paste your Torn API key.', true);
      return;
    }
    return runMutation('verification-bind', async () => {
      try {
        const result = await state.api.bindVerificationCredential(key);
        if (verificationKeyInput) verificationKeyInput.value = '';
        state.verificationCredential = result?.credential || null;
        state.verificationEditing = false;
        setStatus('Torn API key connected.');
        await refreshMe();
        await refreshReviverEligibility();
        await refreshReviverQueue();
        renderAll();
      } catch (error) {
        if (verificationKeyInput) verificationKeyInput.value = '';
        handleApiFailure(error, 'verification.bind', 'Torn API key could not be connected.');
      }
    });
  }

  function beginVerificationReplacement() {
    state.verificationEditing = true;
    renderSettingsDrawer();
    setTimeout(() => document.getElementById('rr-verification-key')?.focus(), 0);
  }

  async function revokeVerificationKey() {
    if (!runtimeCompatible()) return;
    return runMutation('verification-revoke', async () => {
      try {
        await state.api.revokeVerificationCredential();
        invalidateAuthoritativeState('queue');
        invalidateAuthoritativeState('eligibility');
        state.verificationCredential = null;
        state.verificationEditing = false;
        state.reviverEligibility = null;
        state.reviverQueue = [];
        setStatus('Torn API key disconnected from ReviveRelay.');
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'verification.revoke', 'Torn API key could not be disconnected.');
      }
    });
  }

  async function registerMarketplaceReviver() {
    if (!hasReviverSubscriptionAccess() || !hasCredentialCapability('reviver') || !hasConfirmedReviveAbility()) return;
    return runMutation('reviver-register', async () => {
      try {
        await state.api.registerReviver();
        await refreshMe();
        await refreshReviverQueue();
        setStatus('Reviver Pro queue access registered.');
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'reviver.register', 'Reviver registration failed.');
      }
    });
  }

  function isValidTornProfileId(value) {
    return /^[1-9][0-9]*$/.test(String(value ?? '').trim());
  }

  function tornProfileNavigationUrl(tornId) {
    return `https://www.torn.com/profiles.php?XID=${encodeURIComponent(String(tornId).trim())}`;
  }

  async function acceptMarketplaceRequest(requestId) {
    if (!hasReviverSubscriptionAccess() || !hasRole('reviver') || !hasCredentialCapability('reviver') || !hasConfirmedReviveAbility()) return;
    const targetRequest = state.reviverQueue.find(request => String(request?.id) === String(requestId));
    const targetTornId = targetRequest?.requesterTornId;
    return runMutation('request-accept', async () => {
      try {
        const result = await state.api.acceptRequest(requestId);
        state.activeTransaction = result?.transaction || null;
        if (isValidTornProfileId(targetTornId)) {
          setStatus('Certified revive request accepted. Opening the requester’s Torn profile…');
          window.location.href = tornProfileNavigationUrl(targetTornId);
          return;
        }
        await refreshReviverQueue();
        setStatus('Certified revive request accepted, but the requester profile could not be opened automatically.', true);
        renderAll();
      } catch (error) {
        handleApiFailure(error, 'reviver.accept', 'Request could not be accepted.');
      }
    });
  }

  async function runTransactionAction(action, decision = null) {
    if (!syncPanelSession() || !runtimeCompatible() || !state.activeTransaction?.id) return;
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
      refreshPill();
      renderAll();
    } catch (error) {
      handleApiFailure(error, `transaction.${action}`, 'Transaction action failed.');
    }
  }

  // Ask the pill's leader tab for a fresh /v1/state after something changed server state.
  function refreshPill() {
    if (liteBoot) liteBoot.refresh();
  }

  // Sign-in, sign-out or account deletion: the pill forgets the previous session at once.
  function resetLiteSession() {
    panelStateVersion = null;
    if (liteBoot) liteBoot.resetSession();
  }

  function pageHidden() {
    return document.visibilityState === 'hidden' || document.hidden === true;
  }

  // On each pill state change the open panel refreshes what its visible tab shows; hidden pages nothing.
  function refreshPanelData() {
    if (pageHidden()) return Promise.resolve();
    // The tab this call's flight loaded; a tab switch during the flight gets one follow-up refresh.
    let loadedTab = null;
    return runSingleFlightPoll('panel', async () => {
      syncPanelSession();
      if (!state.sessionToken) return;
      if (panelSlowRefreshAt === null || Date.now() - panelSlowRefreshAt >= PANEL_SLOW_REFRESH_MS) {
        panelSlowRefreshAt = Date.now();
        await refreshMe();
        if (!runtimeCompatible()) return;
        await refreshProState();
        await refreshVerificationCredential();
        await refreshReviverEligibility();
      }
      if (!runtimeCompatible()) return;
      const tab = state.panelTab;
      loadedTab = tab;
      const reviverSide = tab === 'reviver' || tab === 'activity';
      if (tab === 'request' || tab === 'activity') await refreshActiveRequest();
      if (reviverSide) await refreshReviverQueue();
      if (reviverSide && state.activeTransaction?.participantRole === 'reviver') await refreshActiveTransaction();
      // The pill's transaction (accepted before a navigation or in another tab) reaches the panel.
      const pillTransactionId = liteBoot ? liteBoot.engine.viewModel()?.transactionId : null;
      if (pillTransactionId && String(state.activeTransaction?.id) !== pillTransactionId) await refreshActiveTransaction(pillTransactionId);
      if (state.currentInvoice?.state === 'PENDING') await refreshCurrentInvoice();
    }).catch(error => {
      if (Number(error?.status) === 401) clearSession('Your ReviveRelay session expired. Verify & connect again.');
      else handleApiFailure(error, 'panel.refresh', 'Could not refresh ReviveRelay.');
    // Live sections only: never rebuild Settings form controls while someone types in them.
    }).then(() => {
      renderLiveState();
      if (loadedTab && loadedTab !== state.panelTab && panel && !state.minimized) return refreshPanelData();
    });
  }

  function setPanelOpen(open) {
    if (open && !panel) createPanel();
    state.minimized = !open;
    if (panel) panel.style.display = open ? '' : 'none';
    if (open) applyPanelPosition(state.panelPosition);
    if (liteBoot) liteBoot.setPanelOpen(open);
  }

  function panelTabForPill(view) {
    const sheet = String(view?.sheet || '');
    if (sheet === 'reviver-pro') return 'settings';
    if (sheet.startsWith('reviver-')) return 'reviver';
    return 'request';
  }

  // The header pill is the 1.0 entry point: it toggles the panel on the tab its state points at.
  function handlePillActivate() {
    if (panel && !state.minimized) {
      setPanelOpen(false);
      return;
    }
    const view = liteBoot ? liteBoot.engine.viewModel() : null;
    syncPanelSession();
    setPanelOpen(true);
    if (view?.sheet === 'requester-setup' && state.sessionToken) openSettingsDrawer('verification');
    else activatePanelTab(panelTabForPill(view));
    // There is no reporting UI or endpoint yet: say what went wrong and whom to tell.
    const problem = { REPORTABLE_NO_ATTEMPT: 'no revive attempt was made', REPORTABLE_MISSING_REFUND: 'the refund was not verified' }[view?.state];
    if (problem) setStatus(`Needs attention: ${problem}. Report it to the ReviveRelay operator.`, true);
    panelStateVersion = latestPillStateVersion;
    refreshPanelData();
    if (storage.get(KEYS.clientDiagnosticsEnabled, false)) state.telemetry.drain().catch(() => {});
  }

  // Runs after every pill render (each poll, and every second while the panel is open).
  function handlePillRender({ snapshot }) {
    latestPillStateVersion = snapshot?.stateVersion || null;
    // Pro or role changes made elsewhere reach the panel promptly: drop the slow-refresh throttle.
    const proRolesKey = JSON.stringify([snapshot?.pro ?? null, snapshot?.me?.roles ?? null]);
    if (panelProRolesKey !== null && proRolesKey !== panelProRolesKey) panelSlowRefreshAt = null;
    panelProRolesKey = proRolesKey;
    // A hidden page keeps its old version, so it catches up once visible.
    if (!panel || state.minimized || pageHidden()) return;
    if (latestPillStateVersion && latestPillStateVersion !== panelStateVersion) {
      panelStateVersion = latestPillStateVersion;
      refreshPanelData();
    } else if (state.activeTransaction) {
      renderLiveState();
    }
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

  // States and roles as server/src/routes/transactions.js accepts them; checks are open to both parties.
  function transactionActions(transaction) {
    if (!transaction) return '';
    const role = transaction.participantRole;
    const payment = [['check-payment', 'Check payment']];
    const refund = [['check-refund', 'Check refund']];
    const actions = {
      WAITING_FOR_PAYMENT: payment,
      PAYMENT_RECONCILING: payment,
      FAILED_ATTEMPT_CHOICE: role === 'requester' ? [['retry-request', 'Request retry'], ['refund-request', 'Request refund']] : [],
      RETRY_OFFERED: role === 'reviver' ? [['retry-accept', 'Accept retry'], ['retry-decline', 'Decline retry']] : [],
      REFUND_REQUIRED: refund,
      REFUND_RECONCILING: refund
    }[transaction.state] || [];
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
      <p>ReviveRelay uses one Torn API key to verify your identity and provide the limited revive, eligibility and payment evidence needed by the service.</p>
      <p class="rr-muted">Recommended: create the Custom Torn API key below. The same key is used for your whole ReviveRelay account, encrypted server-side after connection, and never stored in Tampermonkey.</p>
      <button id="rr-create-api-key" type="button">Create ReviveRelay API Key</button>
      <label class="rr-label" for="rr-api-key">Torn API key</label>
      <input id="rr-api-key" type="password" autocomplete="off" placeholder="Paste Torn API key">
      <button id="rr-connect">Connect ReviveRelay</button>
    </div>`;
  }

  function renderRequestPanel() {
    const target = document.getElementById('rr-requester');
    if (!target) return;
    if (!state.sessionToken || !state.identity) {
      target.innerHTML = renderOnboarding();
      return;
    }
    if (!runtimeCompatible()) {
      target.innerHTML = `<div class="rr-card rr-warning">
        <div class="rr-card-title">Review backend unavailable</div>
        <p>${escapeHtml(runtimeCompatibilityMessage())}</p>
      </div>`;
      return;
    }
    const validation = RequestPreset.validatePreset(state.preset);
    const presetText = validation.ok
      ? `${formatOffer(validation.preset.paymentMethod, validation.preset.offerAmount)}${validation.preset.comment ? ` · “${escapeHtml(validation.preset.comment)}”` : ''}`
      : 'Not configured';
    const request = state.activeRequest;
    const requesterVerification = request && !hasCredentialCapability('requester')
      ? `<div class="rr-warning"><strong>Torn API key update required</strong><p>Your connected Torn API key must include the ReviveRelay permissions required before a reviver can accept this request.</p><button data-rr-open-settings="verification">Update Torn API key</button></div>`
      : '';
    target.innerHTML = `<div class="rr-card">
      <div class="rr-card-title">Revive Me</div>
      <div class="rr-kv"><span>Saved preset</span><strong>${presetText}</strong></div>
      ${validation.ok ? '' : '<button data-rr-open-settings="preset">Configure Revive Me preset</button>'}
      ${validation.ok && !request && state.activeRequestLoaded ? `<button id="rr-request-revive"${disabledAttr('request-create')}>Request certified revive</button>` : ''}
    </div>
    <div class="rr-card" id="rr-request-card">
      <div class="rr-card-title">Active certified request</div>
      ${request ? `
        <div class="rr-certified-line"><span class="rr-star">★</span><strong>CERTIFIED REQUEST</strong></div>
        <div class="rr-kv"><span>State</span><strong>${escapeHtml(request.state)}</strong></div>
        <div class="rr-kv"><span>Offer</span><strong>${escapeHtml(formatOffer(request.paymentMethod, request.offerAmount))}</strong></div>
        <div class="rr-kv"><span>Message</span><strong>${escapeHtml(request.comment || '—')}</strong></div>
        <div class="rr-kv"><span>Created</span><strong>${escapeHtml(formatDate(request.createdAt))}</strong></div>
        ${requesterVerification}
        <button id="rr-cancel-request"${disabledAttr('request-cancel')}>Cancel request</button>
      ` : '<div class="rr-muted">No active certified request.</div>'}
    </div>
    ${state.activeTransaction ? renderTransactionCard(state.activeTransaction, 'Your revive transaction') : ''}`;
  }

  function queueViewRequests(requests) {
    const paymentFilter = ['all', 'cash', 'xanax'].includes(state.queuePaymentFilter) ? state.queuePaymentFilter : 'all';
    const minimumCash = Math.max(0, Number(state.queueMinCash) || 0);
    const minimumXanax = Math.max(0, Number(state.queueMinXanax) || 0);
    const sortMode = ['newest', 'oldest', 'offer-desc', 'offer-asc'].includes(state.queueSort) ? state.queueSort : 'newest';
    const timestamp = value => {
      const parsed = new Date(value).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const list = (Array.isArray(requests) ? requests : []).filter(request => {
      const method = request?.paymentMethod;
      if (paymentFilter !== 'all' && method !== paymentFilter) return false;
      const offer = Math.max(0, Number(request?.offerAmount) || 0);
      if (method === 'cash' && offer < minimumCash) return false;
      if (method === 'xanax' && offer < minimumXanax) return false;
      return true;
    });
    const tieBreak = (a, b) => String(a?.id || '').localeCompare(String(b?.id || ''));
    return list.sort((a, b) => {
      if (sortMode === 'oldest') return timestamp(a?.createdAt) - timestamp(b?.createdAt) || tieBreak(a, b);
      if (sortMode === 'offer-desc' || sortMode === 'offer-asc') {
        const methodOrder = String(a?.paymentMethod || '').localeCompare(String(b?.paymentMethod || ''));
        if (methodOrder) return methodOrder;
        const amountOrder = (Number(a?.offerAmount) || 0) - (Number(b?.offerAmount) || 0);
        if (amountOrder) return sortMode === 'offer-desc' ? -amountOrder : amountOrder;
        return timestamp(b?.createdAt) - timestamp(a?.createdAt) || tieBreak(a, b);
      }
      return timestamp(b?.createdAt) - timestamp(a?.createdAt) || tieBreak(a, b);
    });
  }

  function groupQueueRequests(requests) {
    const list = Array.isArray(requests) ? requests : [];
    if (state.queueGroup !== 'payment') return [{ key: 'all', label: 'All requests', requests: list }];
    const definitions = [
      ['cash', 'Cash'],
      ['xanax', 'Xanax'],
      ['other', 'Other']
    ];
    return definitions.map(([key, label]) => ({
      key,
      label,
      requests: list.filter(request => key === 'other'
        ? !['cash', 'xanax'].includes(request?.paymentMethod)
        : request?.paymentMethod === key)
    })).filter(group => group.requests.length > 0);
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
      <button data-rr-accept="${escapeHtml(request.id)}"${disabledAttr('request-accept')}>Accept</button>
    </div>`;
  }

  function renderReviverPanel() {
    const target = document.getElementById('rr-reviver-content');
    if (!target) return;
    if (!state.sessionToken) {
      target.innerHTML = '<div class="rr-card">Connect ReviveRelay first.</div>';
      return;
    }
    if (!runtimeCompatible()) {
      target.innerHTML = `<div class="rr-card rr-warning">
        <div class="rr-card-title">Review backend unavailable</div>
        <p>${escapeHtml(runtimeCompatibilityMessage())}</p>
      </div>`;
      return;
    }
    if (!hasReviverSubscriptionAccess()) {
      target.innerHTML = `<div class="rr-card rr-pro-gate">
        <div class="rr-card-title">Reviver Pro required</div>
        <p>The certified request queue, notifications and Accept are Reviver Pro features.</p>
        ${state.proStatus?.trialEligible ? `<button id="rr-start-trial-inline"${disabledAttr('trial-start')}>Start 7-day Reviver Pro trial</button>` : '<button data-rr-open-pro>Open ReviveRelay Pro</button>'}
      </div>`;
      return;
    }
    if (!hasCredentialCapability('reviver')) {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Torn API key permissions required</div>
        <p>Your Torn API key must include the limited ReviveRelay permissions needed to confirm revives and payments.</p>
        <button data-rr-open-settings="verification">Update Torn API key</button>
      </div>`;
      return;
    }
    const eligibility = state.reviverEligibility;
    if (!eligibility) {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Checking revive ability</div>
        <p>ReviveRelay is confirming that this Torn account has permanently unlocked reviving.</p>
      </div>`;
      return;
    }
    if (eligibility.status === 'PERMISSION_REQUIRED') {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Revive ability could not be verified</div>
        <p>Your connected Torn API key does not include the <strong>Perks</strong> permission needed to confirm revive ability.</p>
        <button data-rr-open-settings="verification">Update Torn API key</button>
      </div>`;
      return;
    }
    if (eligibility.status === 'NOT_UNLOCKED') {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Reviving not unlocked</div>
        <p>This Torn account does not have the permanent revive ability. Reach <strong>Brain Surgeon</strong> in the Medical starter job to permanently unlock reviving.</p>
      </div>`;
      return;
    }
    if (!hasConfirmedReviveAbility()) {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Revive ability could not be verified</div>
        <p>ReviveRelay will not provide reviver queue access until Torn confirms the revive ability.</p>
      </div>`;
      return;
    }
    if (!hasRole('reviver')) {
      target.innerHTML = `<div class="rr-card">
        <div class="rr-card-title">Register as reviver</div>
        <p>Torn confirmed that this account has the permanent revive ability.</p>
        <button id="rr-register-reviver"${disabledAttr('reviver-register')}>Register as reviver</button>
      </div>`;
      return;
    }
    const visibleRequests = queueViewRequests(state.reviverQueue);
    const groupedRequests = groupQueueRequests(visibleRequests);
    const queueMarkup = visibleRequests.length
      ? groupedRequests.map(group => `${state.queueGroup === 'payment' ? `<div class="rr-queue-group-title">${escapeHtml(group.label)} <span>${group.requests.length}</span></div>` : ''}${group.requests.map(renderCertifiedRequest).join('')}`).join('')
      : '<div class="rr-card rr-muted">No certified requests match the current queue filters.</div>';
    target.innerHTML = `<div class="rr-card">
      <div class="rr-card-title">Certified revive queue</div>
      <div class="rr-muted">${visibleRequests.length} shown of ${state.reviverQueue.length} available request${state.reviverQueue.length === 1 ? '' : 's'}.</div>
      <div class="rr-queue-controls" aria-label="Certified revive queue controls">
        <label>Payment<select id="rr-queue-payment-filter">
          <option value="all" ${state.queuePaymentFilter === 'all' ? 'selected' : ''}>All</option>
          <option value="cash" ${state.queuePaymentFilter === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="xanax" ${state.queuePaymentFilter === 'xanax' ? 'selected' : ''}>Xanax</option>
        </select></label>
        <label>Sort<select id="rr-queue-sort">
          <option value="newest" ${state.queueSort === 'newest' ? 'selected' : ''}>Newest first</option>
          <option value="oldest" ${state.queueSort === 'oldest' ? 'selected' : ''}>Oldest first</option>
          <option value="offer-desc" ${state.queueSort === 'offer-desc' ? 'selected' : ''}>Offer high to low</option>
          <option value="offer-asc" ${state.queueSort === 'offer-asc' ? 'selected' : ''}>Offer low to high</option>
        </select></label>
        <label>Min cash<input id="rr-queue-min-cash" type="number" min="0" step="50000" value="${escapeHtml(state.queueMinCash)}"></label>
        <label>Min Xanax<input id="rr-queue-min-xanax" type="number" min="0" step="1" value="${escapeHtml(state.queueMinXanax)}"></label>
        <label>Group<select id="rr-queue-group">
          <option value="payment" ${state.queueGroup === 'payment' ? 'selected' : ''}>Payment type</option>
          <option value="none" ${state.queueGroup === 'none' ? 'selected' : ''}>No grouping</option>
        </select></label>
        <button id="rr-refresh-queue" type="button">Refresh queue</button>
      </div>
      <p class="rr-muted">Offer sorting is kept within each payment currency so Cash and Xanax are never treated as equivalent units.</p>
    </div>
    <div id="rr-reviver-queue">${queueMarkup}</div>
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
    const plans = Array.isArray(state.subscription?.plans) ? state.subscription.plans : [];
    if (!plans.length) return '<option value="">Plans unavailable</option>';
    return plans.map(plan => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.label)} · ${plan.xanax} Xanax / ${formatMoney(plan.cash)}</option>`).join('');
  }

  function renderInvoice() {
    if (!state.currentInvoice) return '<div class="rr-muted">No open Pro invoice.</div>';
    const invoice = state.currentInvoice;
    const target = invoice.paymentTarget?.tornId;
    const displayState = invoice.state === 'PAID' && state.proStatus?.state === 'ACTIVE'
      ? 'PAID'
      : invoice.state === 'PAID' ? 'VERIFYING' : invoice.state;
    const expired = invoice.state === 'EXPIRED'
      ? '<div class="rr-warning">This invoice has expired. Create a new invoice if you still want Pro time.</div>'
      : '';
    return `<div class="rr-invoice">
      <div class="rr-kv"><span>State</span><strong>${escapeHtml(displayState)}</strong></div>
      <div class="rr-kv"><span>Amount</span><strong>${escapeHtml(formatOffer(invoice.currency, invoice.expectedAmount))}</strong></div>
      <div class="rr-kv"><span>Send to Torn ID</span><strong>${escapeHtml(target || '—')}</strong></div>
      <div class="rr-kv"><span>Expires</span><strong>${escapeHtml(formatDate(invoice.expiresAt))}</strong></div>
      ${expired}
      ${invoice.state === 'PENDING' ? '<button id="rr-refresh-invoice">Check payment status</button>' : ''}
    </div>`;
  }

  function renderVerificationSettings() {
    if (!state.sessionToken) return '<div class="rr-muted">Connect ReviveRelay first.</div>';
    const credential = state.verificationCredential;
    const usable = Boolean(credential?.usable);
    const requester = Boolean(credential?.capabilities?.requester);
    const reviver = Boolean(credential?.capabilities?.reviver);
    const broadAccess = Boolean(credential?.accessScope?.broadAccess);
    const eligibilityStatus = state.reviverEligibility?.status === 'ELIGIBLE'
      ? 'Confirmed'
      : state.reviverEligibility?.status === 'NOT_UNLOCKED'
        ? 'Not unlocked'
        : state.reviverEligibility?.status === 'PERMISSION_REQUIRED'
          ? 'Update key required'
          : state.reviverEligibility?.status === 'TIMEOUT'
            ? 'Check timed out - retry'
            : state.reviverEligibility?.status === 'UNAVAILABLE'
              ? 'Unavailable - retry'
              : reviver ? 'Checking…' : 'Not checked';
    const editing = !credential || state.verificationEditing;
    const keyInput = editing
      ? '<input id="rr-verification-key" type="password" autocomplete="off" placeholder="Paste Torn API key">'
      : `<input id="rr-verification-key" type="password" value="${MASKED_VERIFICATION_KEY}" readonly aria-label="Connected Torn API key (masked)">`;
    const keyAction = editing
      ? `<button id="rr-bind-verification"${disabledAttr('verification-bind')}>${credential ? 'Save replacement Torn API key' : 'Connect Torn API key'}</button>`
      : '<button id="rr-replace-verification" type="button">Replace Torn API key</button>';
    return `<div class="rr-kv"><span>Torn API key</span><strong>${usable ? 'Connected' : 'Not connected'}</strong></div>
      <div class="rr-kv"><span>Requester evidence</span><strong>${requester ? 'Ready' : 'Required before Accept'}</strong></div>
      <div class="rr-kv"><span>Reviver access</span><strong>${reviver ? 'Ready' : 'Not ready'}</strong></div>
      <div class="rr-kv"><span>Revive ability</span><strong>${escapeHtml(eligibilityStatus)}</strong></div>
      ${broadAccess ? '<div class="rr-warning"><strong>Full/Broad Access key accepted.</strong> This Torn API key grants more access than ReviveRelay requires. You can keep using it, or replace it with the recommended Custom Torn API key below.</div>' : ''}
      <p class="rr-muted">ReviveRelay uses one Torn API key for your account. The same key connects your Torn identity and supplies the limited revive, eligibility and payment evidence ReviveRelay needs. It is encrypted server-side and never stored in Tampermonkey.</p>
      ${credential ? '<p class="rr-muted">Disconnecting the stored Torn API key disables ReviveRelay evidence checks. To invalidate the key at Torn as well, delete it in <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener noreferrer">Torn API settings</a>.</p>' : ''}
      <div class="rr-permission-list">
        <strong>Recommended Custom Torn API key</strong>
        <span>Basic</span><span>Profile / hospital status</span><span>Revives</span><span>Perks (revive ability)</span>
        <span>Money incoming</span><span>Money outgoing</span><span>Items incoming</span><span>Items outgoing</span>
      </div>
      <div class="rr-setup-choice">
        <strong>Create the recommended key</strong>
        <p class="rr-muted">This one key covers both requester and reviver use, so you do not need a second key if you use both sides of ReviveRelay.</p>
        <button id="rr-create-api-key" type="button">Create ReviveRelay API Key</button>
      </div>
      <div class="rr-setup-choice">
        <strong>Or use an existing Torn API key</strong>
        <p class="rr-muted">A Full Access or broader custom key is accepted if it belongs to this Torn account and contains the required permissions, but the restricted Custom key above is recommended.</p>
        <label class="rr-label" for="rr-verification-key">Torn API key</label>
        ${keyInput}
        <div class="rr-actions">
          ${keyAction}
          ${credential ? `<button id="rr-revoke-verification"${disabledAttr('verification-revoke')}>Disconnect Torn API key</button>` : ''}
        </div>
      </div>`;
  }

  function renderProPanel() {
    const target = document.getElementById('rr-pro-content');
    if (!target) return;
    if (state.sessionToken && !runtimeCompatible()) {
      target.innerHTML = `<div class="rr-card rr-warning">
        <div class="rr-card-title">Review backend unavailable</div>
        <p>${escapeHtml(runtimeCompatibilityMessage())}</p>
        <p class="rr-muted">Trial, subscription, queue and Accept controls remain disabled until a compatible review runtime is confirmed.</p>
      </div>`;
      return;
    }
    const mode = subscriptionMode();
    const proState = state.proStatus?.state || 'NONE';
    const merchantName = state.subscription?.merchant?.name || 'Configured ReviveRelay merchant';
    const merchantTornId = state.subscription?.merchant?.tornId || null;
    const ownerAccess = proState === 'OWNER'
      ? `<div class="rr-owner-pro">
          <div class="rr-kv"><span>Reviver Pro</span><strong>Reviver Pro: OWNER</strong></div>
          <div class="rr-kv"><span>Access</span><strong>Access: Lifetime</strong></div>
          <div class="rr-kv"><span>Account</span><strong>Payment recipient account</strong></div>
        </div>`
      : '';
    const trialButton = proState !== 'OWNER' && mode !== 'free' && state.sessionToken && state.proStatus?.trialEligible
      ? `<button id="rr-start-trial"${disabledAttr('trial-start')}>Start 7-day Reviver Pro trial</button>` : '';
    const subscriptionBody = proState === 'OWNER'
      ? `<p class="rr-muted">Lifetime Reviver Pro access is included for the configured payment recipient. No trial or subscription payment is required.</p>`
      : mode === 'free'
        ? `<p class="rr-muted">Reviver access is currently free. No Pro payment is required while ReviveRelay is in free mode.</p>`
        : state.sessionToken && subscriptionPaymentsEnabled()
          ? `<div class="rr-kv"><span>Payment recipient</span><strong>${escapeHtml(merchantName)}${merchantTornId ? ` [${escapeHtml(merchantTornId)}]` : ''}</strong></div>
            <p class="rr-muted">Send payment manually in Torn after creating an invoice. ReviveRelay never sends cash or items for you.</p>
            <div class="rr-form-row">
              <select id="rr-pro-plan">${selectedPlanOptions()}</select>
              <select id="rr-pro-currency"><option value="xanax">Xanax</option><option value="cash">Torn cash</option></select>
              <button id="rr-create-pro-invoice"${disabledAttr('invoice-create')}>Create Pro invoice</button>
            </div><div id="rr-invoice-status">${renderInvoice()}</div>`
          : '<div class="rr-muted">Connect ReviveRelay to view Pro plans.</div>';
    target.innerHTML = `<div class="rr-card" id="rr-pro-settings">
      <div class="rr-card-title">ReviveRelay Pro</div>
      <p>Pro unlocks the certified reviver queue, request notifications and Accept controls when paid access is required.</p>
      <div class="rr-kv"><span>Mode</span><strong>${escapeHtml(mode)}</strong></div>
      <div class="rr-kv"><span>Status</span><strong id="rr-pro-state">${escapeHtml(proState)}</strong></div>
      <div class="rr-kv"><span>Valid until</span><strong id="rr-pro-valid-until">${escapeHtml(proState === 'OWNER' ? 'Lifetime' : (state.proStatus?.validUntil ? formatDate(state.proStatus.validUntil) : '—'))}</strong></div>
      ${ownerAccess}
      ${trialButton}
    </div>
    <div class="rr-card">
      <div class="rr-card-title">Subscription</div>
      ${subscriptionBody}
    </div>`;
  }

  function renderProStatus() {
    const stateTarget = document.getElementById('rr-pro-state');
    const validTarget = document.getElementById('rr-pro-valid-until');
    if (stateTarget) stateTarget.textContent = state.proStatus?.state || 'NONE';
    if (validTarget) validTarget.textContent = state.proStatus?.state === 'OWNER'
      ? 'Lifetime'
      : state.proStatus?.validUntil ? formatDate(state.proStatus.validUntil) : '—';
  }

  function renderSettingsDrawer() {
    const target = document.getElementById('rr-settings-drawer-content');
    if (!target) return;
    const validation = RequestPreset.validatePreset(state.preset);
    const preset = validation.ok ? validation.preset : { paymentMethod: 'cash', offerAmount: 500000, comment: '' };
    const requesterNeedsVerification = Boolean(state.activeRequest && !hasCredentialCapability('requester'));
    const reviverNeedsVerification = Boolean(hasRole('reviver') && hasReviverSubscriptionAccess() && !hasCredentialCapability('reviver'));
    const requestedSection = state.settingsSection;
    const presetOpen = !requestedSection || requestedSection === 'preset' ? ' open' : '';
    const verificationOpen = requestedSection === 'verification'
      || (!requestedSection && state.sessionToken && (requesterNeedsVerification || reviverNeedsVerification))
      ? ' open' : '';
    target.innerHTML = `<div class="rr-settings-heading">
      <div><strong>Settings</strong><span>Keep the everyday stuff simple. Advanced controls stay out of the way.</span></div>
      <button id="rr-settings-close" type="button" aria-label="Close ReviveRelay settings">Close</button>
    </div>
    <details class="rr-settings-section"${presetOpen}>
      <summary>Revive Me preset</summary>
      <div class="rr-settings-body">
        <p>This is the offer sent by <strong>Request certified revive</strong> in the Request tab.</p>
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
    </details>
    <details class="rr-settings-section"${verificationOpen}>
      <summary>Torn API Key</summary>
      <div class="rr-settings-body">${renderVerificationSettings()}</div>
    </details>
    <details class="rr-settings-section">
      <summary>Notifications</summary>
      <div class="rr-settings-body">
        <label><input id="rr-desktop-notifications-enabled" type="checkbox" ${desktopNotificationsEnabled() ? 'checked' : ''}> Desktop notifications for new certified requests</label>
        <p class="rr-muted">Notifications are on by default while Reviver Pro is active and your reviver setup is complete. Turning them off does not affect the live queue or Accept controls.</p>
        <p class="rr-muted">ReviveRelay never auto-accepts a request.</p>
      </div>
    </details>
    <details class="rr-settings-section">
      <summary>Account</summary>
      <div class="rr-settings-body">
        <div class="rr-kv"><span>Connection</span><strong>${state.sessionToken ? 'Connected' : 'Disconnected'}</strong></div>
        <div class="rr-actions"><button id="rr-refresh">Refresh</button>${state.sessionToken ? '<button id="rr-disconnect">Disconnect</button>' : ''}</div>
      </div>
    </details>
    <details class="rr-settings-section">
      <summary>Updates</summary>
      <div class="rr-settings-body">
        <div class="rr-kv"><span>Current</span><strong id="rr-update-current">${escapeHtml(VERSION)}</strong></div>
        <div class="rr-kv"><span>Channel</span><strong id="rr-update-channel">${escapeHtml(UPDATE_CHANNEL)}</strong></div>
        <div class="rr-kv"><span>Latest</span><strong id="rr-update-latest">${escapeHtml(updateResult?.latestVersion || 'Unknown')}</strong></div>
        <div class="rr-kv"><span>Checked</span><strong id="rr-update-checked">${escapeHtml(updateResult?.lastCheckedAt ? formatDate(updateResult.lastCheckedAt) : 'Not yet')}</strong></div>
        <div id="rr-update-banner">${updateResult?.updateAvailable ? `Update ${escapeHtml(updateResult.latestVersion)} available.` : ''}</div>
        <p class="rr-muted">ReviveRelay checks the Voidsmith distribution feed at most once every 12 hours while Torn is running. Check updates validates the feed and, when a newer build exists, opens the trusted Voidsmith installer so Tampermonkey or TornPDA can perform the update.</p>
        <div class="rr-actions"><button id="rr-update-check">Check &amp; install update</button>${updateResult?.updateAvailable ? '<button id="rr-update-open">Install update</button>' : ''}</div>
      </div>
    </details>
    <details class="rr-settings-section">
      <summary>About &amp; Privacy</summary>
      <div class="rr-settings-body">
        <div class="rr-kv"><span>Version</span><strong>${escapeHtml(VERSION)}</strong></div>
        <div class="rr-kv"><span>Release channel</span><strong>${escapeHtml(UPDATE_CHANNEL)}</strong></div>
        <div class="rr-kv"><span>Payment recipient</span><strong>${escapeHtml(state.subscription?.merchant?.name || 'Not configured')}${state.subscription?.merchant?.tornId ? ` [${escapeHtml(state.subscription.merchant.tornId)}]` : ''}</strong></div>
        <p><strong>Torn API purpose.</strong> ReviveRelay uses Torn API data only to bind identity, verify reviver eligibility/revives and transaction or payment evidence, prevent abuse, and manage entitlement. No Torn password is requested.</p>
        <p><strong>Data stored.</strong> ReviveRelay stores the service data needed for your account, certified revive workflow, entitlement and limited security/audit history. Your Torn API key is encrypted at rest; plaintext credentials are never returned after connection and credentials are not sold or shared with advertisers or unrelated third parties.</p>
        <p><strong>Recommended permissions.</strong> Use one Custom Torn API key with Basic, Profile, Revives, Perks, and the restricted Money/Items incoming and outgoing log categories used for payment/refund evidence. A Broad/Full Access key may work, but grants more access than ReviveRelay needs.</p>
        <p><strong>Subscription terms.</strong> Requester access is free. Where Reviver Pro payments are enabled, subscriptions are prepaid and payment is sent manually in Torn to the server-listed Payment recipient. ReviveRelay never sends payment for you.</p>
        <p><strong>Diagnostics consent.</strong> Sanitized diagnostics are off by default and are sent only when you enable the Diagnostics option.</p>
        <p><strong>Revoke the Torn API key.</strong> Disconnect the stored key above, then delete the same key in Torn API settings if you want Torn to invalidate it completely.</p>
        <p><a href="https://github.com/R4G3RUNN3R/torn-revive-chat-collector/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer">Privacy document (PRIVACY.md)</a> · <a href="https://github.com/R4G3RUNN3R/torn-revive-chat-collector/tree/main/docs/review" target="_blank" rel="noopener noreferrer">Torn review documentation (docs/review)</a></p>
        ${state.sessionToken ? `<div class="rr-warning"><strong>Delete ReviveRelay account/data</strong><p>Operational account data is removed or invalidated immediately where safe. Minimal billing/payment and security/audit evidence may be retained to prevent payment evidence reuse and support refunds or disputes.</p><button id="rr-delete-account"${disabledAttr('account-delete')}>Delete ReviveRelay account/data</button></div>` : ''}
      </div>
    </details>
    <details class="rr-settings-section">
      <summary>Diagnostics / Advanced</summary>
      <div class="rr-settings-body">
        <label><input id="rr-diagnostics-enabled" type="checkbox" ${storage.get(KEYS.clientDiagnosticsEnabled, false) ? 'checked' : ''}> Send sanitized ReviveRelay error diagnostics</label>
        <p class="rr-muted">Diagnostics exclude API keys, bearer tokens, payment receiver credentials and public chat content.</p>
      </div>
    </details>`;
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

  function renderInvoiceStatus() {
    const target = document.getElementById('rr-invoice-status');
    if (target) target.innerHTML = renderInvoice();
  }

  function renderLiveState() {
    if (!panel) return;
    renderSummary();
    renderRequestPanel();
    renderReviverPanel();
    renderActivityPanel();
    renderProStatus();
    renderInvoiceStatus();
    renderStatus();
    updateTabVisibility();
  }

  function renderAll() {
    if (!panel) return;
    renderLiveState();
    renderProPanel();
    renderSettingsDrawer();
    updateTabVisibility();
  }

  function updateTabVisibility() {
    if (!panel) return;
    const drawer = panel.querySelector('#rr-settings-drawer');
    const gear = panel.querySelector('#rr-settings-toggle');
    for (const button of panel.querySelectorAll('[data-rr-tab]')) {
      const selected = !state.settingsOpen && button.dataset.rrTab === state.panelTab;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.classList.toggle('rr-tab-active', selected);
    }
    for (const section of panel.querySelectorAll('[data-rr-panel]')) {
      const selected = !state.settingsOpen && section.dataset.rrPanel === state.panelTab;
      section.classList.toggle('rr-panel-active', selected);
      section.setAttribute('aria-hidden', selected ? 'false' : 'true');
    }
    if (drawer) {
      drawer.classList.toggle('rr-settings-open', state.settingsOpen);
      drawer.setAttribute('aria-hidden', state.settingsOpen ? 'false' : 'true');
    }
    if (gear) gear.setAttribute('aria-expanded', state.settingsOpen ? 'true' : 'false');
  }

  function openSettingsDrawer(section = null) {
    state.settingsSection = ['preset', 'verification'].includes(section) ? section : null;
    if (state.minimized) setPanelOpen(true);
    state.settingsOpen = true;
    renderSettingsDrawer();
    updateTabVisibility();
  }

  function toggleSettingsDrawer() {
    const opening = !state.settingsOpen;
    if (opening) state.settingsSection = null;
    if (opening && state.minimized) setPanelOpen(true);
    state.settingsOpen = opening;
    if (state.settingsOpen) renderSettingsDrawer();
    updateTabVisibility();
  }

  function activatePanelTab(tab) {
    state.settingsOpen = false;
    state.panelTab = Core.normalizePanelTab(tab);
    storage.set(KEYS.panelTab, state.panelTab);
    if (state.minimized) setPanelOpen(true);
    updateTabVisibility();
    renderAll();
    // The newly selected tab loads its own data (single-flight; slow data stays throttled).
    if (panel && !state.minimized) refreshPanelData();
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
    if (isTornPdaNow()) {
      state.panelPosition = null;
      panel.style.left = '6px';
      panel.style.right = '6px';
      panel.style.top = 'max(6px, env(safe-area-inset-top, 0px))';
      panel.style.bottom = 'max(6px, env(safe-area-inset-bottom, 0px))';
      return;
    }
    const fallback = { x: Math.max(8, (window.innerWidth || 1200) - 438), y: 90 };
    const next = Core.clampPanelPosition(position || fallback, panelViewport(), panelSize(), 8);
    state.panelPosition = next;
    panel.style.left = `${Math.round(next.x)}px`;
    panel.style.top = `${Math.round(next.y)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function persistPanelPosition() {
    if (!state.panelPosition) return;
    storage.set(KEYS.panelPosition, state.panelPosition);
  }

  function resetPanelPosition() {
    state.panelPosition = null;
    storage.set(KEYS.panelPosition, null);
    applyPanelPosition(null);
    persistPanelPosition();
  }

  function installPanelDrag(header) {
    if (isTornPdaNow()) return;
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
    const finishDrag = event => {
      if (!dragging) return;
      dragging = false;
      try { header.releasePointerCapture(event.pointerId); } catch (_) {}
      persistPanelPosition();
    };
    header.addEventListener('pointerup', finishDrag);
    header.addEventListener('pointercancel', finishDrag);
    header.addEventListener('dblclick', event => {
      if (event.target?.closest?.('button,input,select,textarea,a')) return;
      resetPanelPosition();
    });
  }

  async function checkUpdates(force = false) {
    updateResult = await state.updateManager.check({ force });
    if (updateResult?.updateAvailable && !updateResult.skipped && !updateResult.error) {
      if (force) {
        if (state.updateManager.openUpdate()) {
          setStatus(`ReviveRelay ${updateResult.latestVersion} verified. Opening the installer now.`);
        } else {
          setStatus('The update was verified, but ReviveRelay could not open the trusted installer. Use Install update to retry.', true);
        }
      } else {
        setStatus(`ReviveRelay ${updateResult.latestVersion} update available. Open Settings → Updates to install it.`);
      }
    } else if (force && updateResult?.error) {
      setStatus('Update check failed. A previously detected update, if shown below, can still be retried manually.', true);
    } else if (force) {
      setStatus('ReviveRelay is already up to date.');
    }
    if (force || state.settingsOpen) renderSettingsDrawer();
  }

  function openAvailableUpdate() {
    if (!state.updateManager.openUpdate()) setStatus('No validated ReviveRelay update is available for this release channel.', true);
  }

  function isTornPdaNow() {
    if (platform.runtime.isTornPda) return true;
    try { return Platform.detectRuntime(globalThis).isTornPda; } catch (_) { return false; }
  }

  function createPanel() {
    platform.addStyle(`
      #rr-panel{position:fixed;z-index:999999;width:min(420px,calc(100vw - 16px));max-height:calc(100vh - 16px);background:#11161b;color:#d9e0e6;border:1px solid #3e4851;border-radius:9px;box-shadow:0 14px 40px rgba(0,0,0,.45);font:12px/1.45 Arial,sans-serif;overflow:hidden}
      #rr-header{display:flex;align-items:center;gap:9px;padding:9px 10px;background:#171d23;border-bottom:1px solid #343d45;cursor:move;user-select:none}
      .rr-brand{font-weight:800;letter-spacing:.06em}.rr-brand small{display:block;font-size:9px;color:#7f8b95;font-weight:500}.rr-spacer{flex:1}
      #rr-connection-pill{font-size:9px;padding:2px 6px;border-radius:8px;background:#3a2424;color:#eaa}.rr-connected{background:#21382d!important;color:#9ed8b6!important}
      #rr-settings-toggle,#rr-minimize{border:1px solid #46515b;background:#20272e;color:#d9e0e6;border-radius:5px;padding:2px 7px;cursor:pointer}
      #rr-settings-toggle{font-size:14px;line-height:1.2;padding:3px 7px}
      #rr-body{overflow:auto;max-height:calc(100vh - 58px)}.rr-tabs{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #303840;background:#12171c}
      .rr-tabs button{border:0;border-right:1px solid #2a3239;background:transparent;color:#87939d;padding:8px 4px;font:inherit}.rr-tabs button:last-child{border-right:0}.rr-tabs .rr-tab-active{color:#f0f4f7;background:#1d252c}
      .rr-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#303840}.rr-summary>div{background:#151b20;padding:7px;text-align:center}.rr-summary span{display:block;color:#76838d;font-size:9px}.rr-summary strong{font-size:11px}
      .rr-panel-content{display:none!important;padding:8px}.rr-panel-content.rr-panel-active{display:block!important}.rr-card{background:#171d22;border:1px solid #303a42;border-radius:7px;padding:9px;margin-bottom:8px}.rr-card-title{font-weight:800;margin-bottom:6px;color:#eef2f5}
      .rr-settings-drawer{display:none;padding:8px}.rr-settings-drawer.rr-settings-open{display:block}.rr-settings-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 1px 8px}.rr-settings-heading strong{display:block;font-size:13px}.rr-settings-heading span{display:block;color:#7f8b95;font-size:9px;margin-top:2px}.rr-settings-heading button{border:1px solid #48545e;background:#242d34;color:#e6ebee;border-radius:5px;padding:4px 7px;cursor:pointer}
      .rr-settings-section{background:#171d22;border:1px solid #303a42;border-radius:7px;margin-bottom:7px;overflow:hidden}.rr-settings-section>summary{cursor:pointer;list-style:none;padding:9px;font-weight:800;color:#eef2f5}.rr-settings-section>summary::-webkit-details-marker{display:none}.rr-settings-section>summary:after{content:'+';float:right;color:#7f8b95}.rr-settings-section[open]>summary:after{content:'−'}.rr-settings-body{padding:0 9px 9px;border-top:1px solid #283139}.rr-settings-body p{margin:8px 0}.rr-permission-list{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:8px 0;padding:7px;border:1px solid #303a42;border-radius:5px;background:#11161b}.rr-permission-list strong{grid-column:1/-1}.rr-permission-list span{font-size:10px;color:#aeb8c0}.rr-setup-choice{margin-top:9px;padding-top:9px;border-top:1px solid #303a42}.rr-warning{margin:8px 0;padding:7px;border:1px solid #806c3b;border-radius:5px;background:#2a2416;color:#dbc783}
      .rr-kv{display:flex;justify-content:space-between;gap:12px;padding:3px 0}.rr-kv span{color:#85919b}.rr-kv strong{text-align:right}.rr-muted{color:#798690;font-size:10px}.rr-status{padding:6px 9px;color:#8fa9ba;border-top:1px solid #303840;min-height:16px}.rr-status-error{color:#e4a1a1}
      .rr-actions,.rr-form-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.rr-label{display:block;color:#9aa6af;margin:7px 0 3px}.rr-card input,.rr-card select,.rr-card textarea,.rr-settings-section input,.rr-settings-section select,.rr-settings-section textarea{box-sizing:border-box;width:100%;border:1px solid #3a4650;background:#0f1418;color:#e0e5e9;border-radius:5px;padding:6px;font:inherit}.rr-card button,.rr-settings-section button{border:1px solid #48545e;background:#242d34;color:#e6ebee;border-radius:5px;padding:5px 8px;font:inherit;cursor:pointer}.rr-card button:disabled,.rr-settings-section button:disabled{opacity:.45;cursor:not-allowed}
      .rr-certified-card{border-color:#806c3b;box-shadow:inset 3px 0 0 #b89a52}.rr-certified-line,.rr-queue-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.rr-star{color:#d5b461}.rr-chip{font-size:8px;border:1px solid #88743e;color:#d9bc72;border-radius:8px;padding:1px 5px}.rr-offer{font-size:15px;font-weight:800;margin-top:7px}.rr-comment{margin:4px 0;color:#bcc5cc}.rr-deadlines{margin-top:6px}.rr-deadlines>div{display:flex;justify-content:space-between;color:#8e9aa3}.rr-invoice{margin-top:7px;padding-top:7px;border-top:1px solid #313a42}
      .rr-queue-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}.rr-queue-controls label{font-size:9px;color:#89959e}.rr-queue-controls select,.rr-queue-controls input{margin-top:2px}.rr-queue-controls button{align-self:end}.rr-queue-group-title{display:flex;justify-content:space-between;align-items:center;margin:10px 2px 6px;color:#b7c1c8;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.rr-queue-group-title span{color:#74818b}
      .rr-pda-toast-stack{position:fixed;z-index:1000001;left:calc(10px + env(safe-area-inset-left,0px));right:calc(10px + env(safe-area-inset-right,0px));bottom:calc(10px + env(safe-area-inset-bottom,0px));display:grid;gap:6px;max-height:50dvh;overflow:auto}.rr-pda-toast{position:relative;width:100%;display:grid;gap:2px;text-align:left;border:1px solid #66727c;background:#151c22;color:#eef2f5;border-radius:9px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.5);font:12px/1.4 Arial,sans-serif}.rr-pda-toast strong{font-size:12px}.rr-pda-toast span{color:#b7c1c8}#rr-panel.rr-tornpda{width:auto;max-height:none;display:flex;flex-direction:column}#rr-panel.rr-tornpda button,#rr-panel.rr-tornpda input:not([type=checkbox]):not([type=radio]),#rr-panel.rr-tornpda select{min-height:44px}#rr-panel.rr-tornpda input[type=text],#rr-panel.rr-tornpda input[type=password],#rr-panel.rr-tornpda input[type=number],#rr-panel.rr-tornpda textarea,#rr-panel.rr-tornpda select{font-size:16px}#rr-panel.rr-tornpda #rr-header{cursor:default;touch-action:auto}#rr-panel.rr-tornpda #rr-body{max-height:none;min-height:0;flex:1;overscroll-behavior:contain}@media(max-width:520px){#rr-panel{width:calc(100vw - 16px)}#rr-panel.rr-tornpda{width:auto}.rr-tabs button{font-size:10px}.rr-queue-controls{grid-template-columns:1fr}}
    `);

    panel = document.createElement('section');
    panel.id = 'rr-panel';
    if (isTornPdaNow()) panel.classList.add('rr-tornpda');
    panel.innerHTML = `<div id="rr-header">
      <div class="rr-brand">REVIVERELAY<small>VOIDsMITH INDUSTRIES · v${escapeHtml(VERSION)}</small></div>
      <div class="rr-spacer"></div>
      <span id="rr-connection-pill">OFFLINE</span>
      <button id="rr-settings-toggle" type="button" aria-label="Open ReviveRelay settings" aria-expanded="false">⚙</button>
      <button id="rr-minimize" type="button" aria-label="Minimize ReviveRelay">▾</button>
    </div>
    <div id="rr-body">
      <div class="rr-tabs" role="tablist">
        <button data-rr-tab="request" role="tab" aria-selected="false">Request</button>
        <button data-rr-tab="reviver" role="tab" aria-selected="false">Reviver</button>
        <button data-rr-tab="activity" role="tab" aria-selected="false">Activity</button>
        <button data-rr-tab="settings" role="tab" aria-selected="false">Pro</button>
      </div>
      <div class="rr-summary">
        <div><span>REQUEST</span><strong id="rr-summary-request">None</strong></div>
        <div><span>ACCESS</span><strong id="rr-summary-pro">FREE</strong></div>
        <div><span>QUEUE</span><strong id="rr-summary-queue">0</strong></div>
      </div>
      <section class="rr-panel-content" data-rr-panel="request"><div id="rr-requester"></div></section>
      <section class="rr-panel-content" data-rr-panel="reviver"><div id="rr-reviver-content"></div></section>
      <section class="rr-panel-content" data-rr-panel="activity"><div id="rr-activity-ledger"></div></section>
      <section class="rr-panel-content" data-rr-panel="settings"><div id="rr-pro-content"></div></section>
      <section id="rr-settings-drawer" class="rr-settings-drawer" aria-hidden="true"><div id="rr-settings-drawer-content"></div></section>
      <div id="rr-status" class="rr-status"></div>
    </div>`;
    document.body.appendChild(panel);
    connectionPill = panel.querySelector('#rr-connection-pill');
    panel.style.display = state.minimized ? 'none' : '';
    installPanelDrag(panel.querySelector('#rr-header'));
    applyPanelPosition(state.panelPosition);

    panel.addEventListener('click', event => {
      // A stale panel re-renders instead of acting.
      if (!syncPanelSession()) return;
      const target = event.target;
      const tab = target.closest?.('[data-rr-tab]');
      if (tab) return activatePanelTab(tab.dataset.rrTab);
      const accept = target.closest?.('[data-rr-accept]');
      if (accept) return acceptMarketplaceRequest(accept.dataset.rrAccept);
      const tx = target.closest?.('[data-rr-tx-action]');
      if (tx) return runTransactionAction(tx.dataset.rrTxAction);
      const settingsTarget = target.closest?.('[data-rr-open-settings]');
      if (settingsTarget) return openSettingsDrawer(settingsTarget.dataset.rrOpenSettings);
      if (target.closest?.('[data-rr-open-pro]')) return activatePanelTab('settings');
      if (target.id === 'rr-settings-toggle') return toggleSettingsDrawer();
      if (target.id === 'rr-settings-close') { state.settingsOpen = false; state.settingsSection = null; updateTabVisibility(); return; }
      if (target.id === 'rr-connect') return connectIdentity();
      if (target.id === 'rr-request-revive') return requestRevive();
      if (target.id === 'rr-cancel-request') return cancelActiveRequest();
      if (target.id === 'rr-save-preset') return saveRequestPreset();
      if (target.id === 'rr-start-trial' || target.id === 'rr-start-trial-inline') return startProTrial();
      if (target.id === 'rr-create-pro-invoice') return createProInvoice();
      if (target.id === 'rr-refresh-invoice') return refreshCurrentInvoice().then(renderLiveState).catch(error => handleApiFailure(error, 'pro.invoice.refresh'));
      if (target.id === 'rr-create-api-key') return platform.openUrl(REVIVERELAY_API_KEY_URL);
      if (target.id === 'rr-replace-verification') return beginVerificationReplacement();
      if (target.id === 'rr-bind-verification') return bindVerificationKey();
      if (target.id === 'rr-revoke-verification') return revokeVerificationKey();
      if (target.id === 'rr-register-reviver') return registerMarketplaceReviver();
      if (target.id === 'rr-refresh-queue') return refreshReviverQueue().then(renderLiveState).catch(error => handleApiFailure(error, 'queue.manual', 'Queue refresh failed.'));
      if (target.id === 'rr-refresh') return refreshMarketplaceState().then(renderAll).catch(error => handleApiFailure(error, 'manual.refresh'));
      if (target.id === 'rr-disconnect') return clearSession();
      if (target.id === 'rr-delete-account') return deleteReviveRelayAccount();
      if (target.id === 'rr-update-check') return checkUpdates(true);
      if (target.id === 'rr-update-open') return openAvailableUpdate();
      if (target.id === 'rr-minimize') return setPanelOpen(false);
    });

    panel.addEventListener('change', event => {
      if (event.target?.id === 'rr-desktop-notifications-enabled') {
        storage.set(KEYS.desktopNotificationsEnabled, Boolean(event.target.checked));
      }
      if (event.target?.id === 'rr-diagnostics-enabled') {
        storage.set(KEYS.clientDiagnosticsEnabled, Boolean(event.target.checked));
      }
      if (event.target?.id === 'rr-queue-payment-filter') {
        state.queuePaymentFilter = ['all', 'cash', 'xanax'].includes(event.target.value) ? event.target.value : 'all';
        renderReviverPanel();
      }
      if (event.target?.id === 'rr-queue-sort') {
        state.queueSort = ['newest', 'oldest', 'offer-desc', 'offer-asc'].includes(event.target.value) ? event.target.value : 'newest';
        renderReviverPanel();
      }
      if (event.target?.id === 'rr-queue-group') {
        state.queueGroup = event.target.value === 'none' ? 'none' : 'payment';
        renderReviverPanel();
      }
      if (event.target?.id === 'rr-queue-min-cash') {
        state.queueMinCash = Math.max(0, Number(event.target.value) || 0);
        renderReviverPanel();
      }
      if (event.target?.id === 'rr-queue-min-xanax') {
        state.queueMinXanax = Math.max(0, Number(event.target.value) || 0);
        renderReviverPanel();
      }
    });

    window.addEventListener('resize', () => {
      applyPanelPosition(state.panelPosition);
      persistPanelPosition();
    });
    renderAll();
  }

  function installGlobalErrorHooks() {
    if (errorHooksInstalled) return;
    errorHooksInstalled = true;
    window.addEventListener('error', event => {
      if (event?.error) captureClientError(event.error, 'window.error');
    });
    window.addEventListener('unhandledrejection', event => {
      captureClientError(event?.reason instanceof Error ? event.reason : new Error(String(event?.reason || 'Unhandled rejection')), 'window.unhandledrejection');
    });
  }

  // The engine reads the session from SHARED storage on every call, never this tab's memory,
  // so a sign-in, sign-out or account deletion in another tab is seen here too.
  function sharedSessionToken() {
    return String(storage.get(KEYS.sessionToken, '') || '');
  }

  function sharedSession() {
    const identity = storage.get(KEYS.publicIdentity, null);
    return { signedIn: Boolean(sharedSessionToken()), tornId: identity?.tornId ?? null };
  }

  // ReviveRelay 1.0: one engine (scheduler, tab leadership, /v1/state) drives the header pill.
  // The panel below has no timers of its own; it refreshes while open when the pill's state changes.
  function startLite() {
    const boot = LiteBoot.createLiteBoot({
      platform,
      window,
      document,
      baseUrl: API_BASE,
      clientVersion: VERSION,
      releaseChannel: UPDATE_CHANNEL,
      getToken: sharedSessionToken,
      getSession: sharedSession,
      onActivate: handlePillActivate,
      onRender: handlePillRender
    });
    boot.start();
    liteBoot = boot;
  }

  function hydrateSession() {
    state.sessionToken = sharedSessionToken();
    state.identity = storage.get(KEYS.publicIdentity, null) || null;
    state.preset = storage.get(KEYS.requestPreset, null) || null;
  }

  function hydratePersistentState() {
    hydrateSession();
    state.panelPosition = isTornPdaNow() ? null : (storage.get(KEYS.panelPosition, null) || null);
    state.panelTab = Core.normalizePanelTab(storage.get(KEYS.panelTab, 'request'));
  }

  async function init() {
    await platform.initialize();
    hydratePersistentState();
    if (isTornPdaNow() && storage.mode() !== 'pda') {
      setStatus('TornPDA durable storage is unavailable. ReviveRelay is using compatibility storage for this session.', true);
    }
    installGlobalErrorHooks();
    startLite();
    if (storage.get(KEYS.clientDiagnosticsEnabled, false)) state.telemetry.drain().catch(() => {});
    // Update checks run once per page load; the update manager throttles them to every 12 h.
    checkUpdates(false).catch(error => captureClientError(error, 'update.initial'));
  }

  // A failed init (e.g. TornPDA storage timeout) leaves a "tap to retry" pill (no storage needed) and
  // retries on a tap and whenever the page is shown again, until init starts. No timers.
  function retryInitWhenShown() {
    try {
      if (!retryPill?.host.isConnected) retryPill = globalThis.ReviveRelayLitePillView.mountPill({ document, window, onActivate: start });
      retryPill.update({ label: 'ReviveRelay', detail: 'tap to retry', text: 'ReviveRelay · tap to retry', tone: 'attention', icon: 'alert' });
    } catch (error) {
      console.error('[ReviveRelay] Retry pill unavailable.', error);
    }
    if (initRetry) return;
    initRetry = () => { if (!pageHidden()) start(); };
    document.addEventListener('visibilitychange', initRetry);
    window.addEventListener('pageshow', initRetry);
  }

  function stopInitRetry() {
    if (!initRetry) return;
    document.removeEventListener('visibilitychange', initRetry);
    window.removeEventListener('pageshow', initRetry);
    initRetry = null;
  }

  function start() {
    if (initPromise || liteBoot) return initPromise;
    initPromise = init().then(stopInitRetry, error => {
      console.error('[ReviveRelay] Initialization failed.', error);
      captureClientError(error, 'init');
      retryInitWhenShown();
    }).finally(() => { initPromise = null; });
    return initPromise;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
