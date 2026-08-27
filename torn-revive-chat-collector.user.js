// ==UserScript==
// @name         ReviveRelay
// @namespace    r4g3runn3r.torn.reviverelay
// @version      __REVIVERELAY_VERSION__
// @description  Public-channel revive request detection and direct ReviveRelay requester workflow for Torn.
// @author       R4G3RUNN3R
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      reviverelay.voidsmithindustries.com
// @updateURL    __REVIVERELAY_UPDATE_URL__
// @downloadURL  __REVIVERELAY_DOWNLOAD_URL__
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/src/core.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/src/chat-dom.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/src/public-channels.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/src/client-chat-policy.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/src/api-client.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/src/versioning.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/src/update-manager.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/src/telemetry-client.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/src/revive-classifier.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/src/candidate-pipeline.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.__REVIVERELAY_ACTIVE__) return;
  window.__REVIVERELAY_ACTIVE__ = true;

  const Core = globalThis.TornReviveCore;
  const ChatDom = globalThis.TornReviveChatDom;
  const PublicChannels = globalThis.TornRevivePublicChannels;
  const ClientChatPolicy = globalThis.TornReviveClientChatPolicy;
  const ReviveRelayApiClient = globalThis.ReviveRelayApiClient;
  const ReviveRelayVersioning = globalThis.ReviveRelayVersioning;
  const ReviveRelayUpdateManager = globalThis.ReviveRelayUpdateManager;
  const ReviveRelayTelemetryClient = globalThis.ReviveRelayTelemetryClient;
  const ReviveRelayCandidatePipeline = globalThis.ReviveRelayCandidatePipeline;

  const VERSION = '__REVIVERELAY_VERSION__';
  const UPDATE_CHANNEL = '__REVIVERELAY_UPDATE_CHANNEL__';
  const BUILD_COMMIT = '__REVIVERELAY_GIT_COMMIT__';
  const API_BASE_URL = 'https://reviverelay.voidsmithindustries.com';
  const DISCOVERY_EVERY_MS = 2_000;
  const OUTBOX_EVERY_MS = 5_000;
  const TELEMETRY_EVERY_MS = 30_000;
  const ACTIVE_REQUEST_EVERY_MS = 10_000;
  const ACTIVE_WINDOW_MS = 60_000;
  const MAX_LIVE_EVENTS = 50;

  const KEYS = Object.freeze({
    sessionToken: 'reviverelay_session_token',
    publicIdentity: 'reviverelay_public_identity',
    candidateOutbox: 'reviverelay_candidate_outbox',
    telemetryOutbox: 'reviverelay_telemetry_outbox',
    clientDiagnosticsEnabled: 'reviverelay_client_diagnostics_enabled',
    updateState: 'reviverelay_update_state',
    deadLetters: 'reviverelay_candidate_dead_letters',
    paused: 'reviverelay_paused',
    minimized: 'reviverelay_minimized',
    liveFilter: 'reviverelay_live_filter',
    panelPosition: 'reviverelay_panel_position',
    panelTab: 'reviverelay_panel_tab'
  });

  const state = {
    api: null,
    telemetry: null,
    telemetryTimer: null,
    clientDiagnosticsEnabled: GM_getValue(KEYS.clientDiagnosticsEnabled, true) !== false,
    updateManager: null,
    updateResult: null,
    sessionToken: String(GM_getValue(KEYS.sessionToken, '') || ''),
    identity: GM_getValue(KEYS.publicIdentity, null) || null,
    rootObserver: null,
    discoveryTimer: null,
    outboxTimer: null,
    requestTimer: null,
    observedContainers: new WeakMap(),
    seenNodes: new WeakSet(),
    paused: Boolean(GM_getValue(KEYS.paused, false)),
    minimized: Boolean(GM_getValue(KEYS.minimized, false)),
    panelPosition: GM_getValue(KEYS.panelPosition, null) || null,
    panelTab: Core?.normalizePanelTab ? Core.normalizePanelTab(GM_getValue(KEYS.panelTab, 'request')) : 'request',
    draining: false,
    lastInteractionAt: 0,
    activeRequest: null,
    activeTransaction: null,
    verificationCredential: null,
    reviverQueue: [],
    liveEvents: [],
    stats: {
      openChats: 0,
      chatListItems: 0,
      processed: 0,
      candidates: 0,
      submitted: 0,
      duplicates: 0,
      deadLetters: readStoredArray(KEYS.deadLetters).length,
      queued: readStoredArray(KEYS.candidateOutbox).length
    }
  };

  function norm(value) {
    return Core.normalizeText(value);
  }

  function readStoredArray(key) {
    const value = GM_getValue(key, []);
    return Array.isArray(value) ? value : [];
  }

  function saveStoredArray(key, value) {
    GM_setValue(key, Array.isArray(value) ? value : []);
  }

  function reportClientError(error, operation, context = {}) {
    if (!state.clientDiagnosticsEnabled || !state.telemetry) return false;
    return state.telemetry.captureError(error, { operation, ...context });
  }

  async function drainTelemetry() {
    if (!state.clientDiagnosticsEnabled || !state.telemetry) return { sent: 0, remaining: 0 };
    return state.telemetry.drain();
  }

  function clientSupported() {
    return state.updateResult?.supported !== false;
  }

  function formatLastChecked(value) {
    const stamp = Number(value || 0);
    return stamp ? new Date(stamp).toLocaleString() : 'Never';
  }

  function renderUpdateStatus() {
    const result = state.updateResult || {};
    const manifest = result.manifest || state.updateManager?.getState?.().lastManifest || null;
    const values = {
      'rr-update-current': VERSION,
      'rr-update-channel': UPDATE_CHANNEL === 'automatic' ? 'Automatic' : 'Manual',
      'rr-update-latest': manifest?.latestVersion || 'Unknown',
      'rr-update-checked': formatLastChecked(result.lastCheckedAt || state.updateManager?.getState?.().lastCheckedAt)
    };
    for (const [id, value] of Object.entries(values)) { const el=document.getElementById(id); if(el) el.textContent=String(value); }
    const banner=document.getElementById('rr-update-banner');
    if (banner) {
      if (result.error) banner.innerHTML='<div class="rr-muted">Version check unavailable. Gameplay continues normally.</div>';
      else if (result.supported === false) banner.innerHTML=`<div class="rr-warning"><strong>Update required.</strong> Minimum supported version is ${escapeHtml(result.minimumVersion || '')}.</div>`;
      else if (result.updateAvailable && !result.dismissed) banner.innerHTML=`<div class="rr-warning">ReviveRelay ${escapeHtml(result.latestVersion || '')} is available.${result.mandatory ? ' This update is required for protected actions.' : ''}</div>${result.mandatory ? '' : '<button id="rr-update-dismiss" type="button">Dismiss this version</button>'}`;
      else banner.innerHTML='<div class="rr-muted">Client version is current or no newer release is known.</div>';
      const dismiss=document.getElementById('rr-update-dismiss'); if(dismiss) dismiss.onclick=()=>{if(state.updateManager?.dismiss(result.latestVersion)){state.updateResult={...result,dismissed:true};renderUpdateStatus();}};
    }
    const switchButton=document.getElementById('rr-update-switch');
    if(switchButton) switchButton.textContent=UPDATE_CHANNEL==='automatic'?'Switch to Manual':'Switch to Automatic';
  }

  async function checkForUpdates(force = false) {
    if (!state.updateManager) return;
    state.updateResult = await state.updateManager.check({ force });
    renderUpdateStatus();
    refreshPanel();
  }

  function visibleAndFocused() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function captureAllowed() {
    return !state.paused && visibleAndFocused() &&
      ChatDom.isRecentlyInteracted(state.lastInteractionAt, Date.now(), ACTIVE_WINDOW_MS);
  }

  function markInteraction() {
    state.lastInteractionAt = Date.now();
    refreshPanel();
    queueDiscoveryAndScan();
    drainCandidateOutbox();
  }

  function userIdFromHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.origin);
      const id = url.searchParams.get('XID') || url.searchParams.get('ID') || url.searchParams.get('userId');
      if (id && /^\d+$/.test(id)) return id;
    } catch (_) {}
    return String(href).match(/(?:XID|ID|userId)=(\d+)/i)?.[1] || '';
  }

  function getConversationName(chat) {
    if (!chat) return 'Unknown';
    const header = chat.querySelector?.(ChatDom.SELECTORS.headerInfo);
    const headerText = norm(header?.textContent || header?.getAttribute?.('aria-label'));
    if (headerText && headerText.length <= 100) return headerText;
    for (const attr of ['data-name', 'data-title', 'title', 'aria-label']) {
      const text = norm(chat.getAttribute?.(attr));
      if (text && text.length <= 100) return text;
    }
    return ChatDom.conversationNameFromId(chat.id) || 'Unknown';
  }

  function getPublicChannel(chat) {
    return ClientChatPolicy.resolvePublicChat(chat, { getName: getConversationName });
  }

  function isEligiblePublicChat(chat) {
    return Boolean(getPublicChannel(chat));
  }

  function getSender(node) {
    const senderEl = node.querySelector?.(ChatDom.SELECTORS.sender);
    const link = senderEl?.closest?.('a[href]') ||
      senderEl?.querySelector?.('a[href]') ||
      node.querySelector?.('a[href*="XID="]');
    let senderName = norm(senderEl?.textContent || link?.textContent);
    senderName = senderName.replace(/:\s*$/, '');
    if (senderName === 'newMessage') senderName = '';
    if (senderName.length > 80) senderName = senderName.slice(0, 80);
    return { senderName, senderId: userIdFromHref(link?.href || '') };
  }

  function getMessageText(node) {
    const element = node.querySelector?.(ChatDom.SELECTORS.messageText);
    if (element) return String(element.textContent || '').trim();
    if (!node.cloneNode) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll?.([
      'time',
      'button',
      'svg',
      ChatDom.SELECTORS.sender,
      '[class*="chat-box-message__avatar___"]',
      '[class*="timestamp___"]'
    ].join(',')).forEach((el) => el.remove());
    return String(clone.textContent || '').trim();
  }

  function getTimestamp(node) {
    const time = node.querySelector?.('time');
    for (const candidate of [
      time?.dateTime,
      time?.getAttribute?.('datetime'),
      time?.title,
      node.getAttribute?.('data-timestamp'),
      node.getAttribute?.('data-time')
    ]) {
      if (!candidate) continue;
      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return '';
  }

  function getSourceMessageId(node) {
    return norm(
      node.getAttribute?.('data-message-id') ||
      node.getAttribute?.('data-messageid') ||
      node.getAttribute?.('data-id') ||
      node.id
    );
  }

  function parseMessage(node, chat) {
    if (!node?.querySelector || !isEligiblePublicChat(chat)) return null;
    const text = getMessageText(node);
    if (!norm(text)) return null;
    const sender = getSender(node);
    if (!sender.senderName && !sender.senderId) return null;
    const channel = getPublicChannel(chat);
    if (!channel) return null;
    return {
      conversationId: channel.id,
      conversationName: channel.name,
      conversationType: channel.type,
      senderId: sender.senderId,
      senderName: sender.senderName,
      text,
      messageTimestamp: getTimestamp(node),
      capturedAt: new Date().toISOString(),
      sourceMessageId: getSourceMessageId(node)
    };
  }

  function addLiveEvent(event) {
    const classification = event?.classification || {};
    state.liveEvents.unshift({
      at: Date.now(),
      channel: event?.channel || {},
      text: String(event?.record?.text || ''),
      candidate: Boolean(classification.candidate),
      score: Number(classification.score || 0),
      reasons: Array.isArray(classification.reasons) ? classification.reasons : [],
      submission: classification.candidate ? 'queued' : 'local only'
    });
    if (state.liveEvents.length > MAX_LIVE_EVENTS) state.liveEvents.length = MAX_LIVE_EVENTS;
    state.stats.processed += 1;
    if (classification.candidate) state.stats.candidates += 1;
    renderLiveCapture();
    refreshPanel();
  }

  async function enqueueCandidate(payload) {
    const entries = readStoredArray(KEYS.candidateOutbox);
    entries.push(ReviveRelayApiClient.createOutboxEntry(payload));
    saveStoredArray(KEYS.candidateOutbox, entries);
    state.stats.queued = entries.length;
    refreshPanel();
    await drainCandidateOutbox();
  }

  async function drainCandidateOutbox() {
    if (!captureAllowed()) return;
    if (!state.sessionToken || state.draining) return;
    const entries = readStoredArray(KEYS.candidateOutbox);
    if (!entries.length) {
      state.stats.queued = 0;
      refreshPanel();
      return;
    }

    state.draining = true;
    try {
      const result = await ReviveRelayApiClient.drainCandidateOutbox({
        entries,
        now: Date.now(),
        isActive: captureAllowed,
        submitCandidate: async (candidate) => {
          const response = await state.api.submitCandidate(candidate);
          if (response?.duplicate) state.stats.duplicates += 1;
          else state.stats.submitted += 1;
          return response;
        }
      });
      saveStoredArray(KEYS.candidateOutbox, result.pending);
      const deadLetters = readStoredArray(KEYS.deadLetters).concat(result.deadLetter).slice(-100);
      saveStoredArray(KEYS.deadLetters, deadLetters);
      state.stats.queued = result.pending.length;
      state.stats.deadLetters = deadLetters.length;
    } catch (error) {
      reportClientError(error, 'candidate.outbox.drain');
      console.warn('[ReviveRelay] Candidate outbox drain failed', error?.code || error?.message || error);
    } finally {
      state.draining = false;
      refreshPanel();
    }
  }

  async function handleParsedMessage(record) {
    await ReviveRelayCandidatePipeline.handlePublicMessage(record, {
      onLocalEvent: addLiveEvent,
      enqueueCandidate
    });
  }

  function expandMessageNodes(candidate) {
    if (!candidate || candidate.nodeType !== Node.ELEMENT_NODE) return [];
    const nodes = [];
    if (candidate.matches?.(ChatDom.SELECTORS.message)) nodes.push(candidate);
    nodes.push(...(candidate.querySelectorAll?.(ChatDom.SELECTORS.message) || []));
    if (!nodes.length && candidate.querySelector?.(ChatDom.SELECTORS.sender) &&
        candidate.querySelector?.(ChatDom.SELECTORS.messageText)) {
      nodes.push(candidate);
    }
    return [...new Set(nodes)];
  }

  async function processCandidate(candidate, chat) {
    if (!captureAllowed() || !isEligiblePublicChat(chat)) return;
    for (const node of expandMessageNodes(candidate)) {
      await ChatDom.processMessageNode({
        node,
        chat,
        seenNodes: state.seenNodes,
        parseMessage,
        save: handleParsedMessage
      });
    }
  }

  async function scanContext(context) {
    if (!captureAllowed() || !context?.body || !isEligiblePublicChat(context.chat)) return;
    const container = ChatDom.findMessageContainer(context.body);
    if (!container) return;
    for (const candidate of ChatDom.messageCandidates(container)) {
      await processCandidate(candidate, context.chat);
    }
  }

  function attachContext(context) {
    if (!isEligiblePublicChat(context?.chat)) return;
    const container = ChatDom.findMessageContainer(context.body);
    if (!container) return;
    if (!state.observedContainers.has(container)) {
      const observer = new MutationObserver(() => {
        if (captureAllowed()) scanContext(context);
      });
      observer.observe(container, { childList: true, subtree: true });
      state.observedContainers.set(container, observer);
    }
    scanContext(context);
  }

  function updateCoverageStats(contexts) {
    state.stats.openChats = contexts.length;
    const root = document.querySelector(ChatDom.SELECTORS.chatRoot);
    if (!root) {
      state.stats.chatListItems = 0;
    } else {
      const listItems = [
        ...root.querySelectorAll(ChatDom.SELECTORS.minimizedItem),
        ...root.querySelectorAll('[class*="chat-app__chat-list-chat-box-wrapper___"] [data-name]')
      ];
      state.stats.chatListItems = new Set(listItems.filter(isEligiblePublicChat)).size;
    }
    refreshPanel();
  }

  function discoverChats() {
    if (!visibleAndFocused()) return [];
    const contexts = ChatDom.findChatContexts(document, { acceptChat: isEligiblePublicChat });
    updateCoverageStats(contexts);
    contexts.forEach(attachContext);
    return contexts;
  }

  let discoveryQueued = false;
  function queueDiscoveryAndScan() {
    if (discoveryQueued) return;
    discoveryQueued = true;
    requestAnimationFrame(() => {
      discoveryQueued = false;
      discoverChats();
    });
  }

  function installRootObserver() {
    state.rootObserver = new MutationObserver(() => queueDiscoveryAndScan());
    state.rootObserver.observe(document.body, { childList: true, subtree: true });
    state.discoveryTimer = setInterval(() => {
      if (visibleAndFocused()) discoverChats();
    }, DISCOVERY_EVERY_MS);
    state.outboxTimer = setInterval(drainCandidateOutbox, OUTBOX_EVERY_MS);
    state.requestTimer = setInterval(() => {
      if (state.sessionToken) refreshMarketplaceState();
    }, ACTIVE_REQUEST_EVERY_MS);
  }

  function setStatus(text, error = false) {
    const el = document.getElementById('rr-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', error);
  }

  function stateLabel() {
    if (state.paused) return 'PAUSED';
    if (!visibleAndFocused()) return 'WAITING FOR FOCUS';
    if (!ChatDom.isRecentlyInteracted(state.lastInteractionAt, Date.now(), ACTIVE_WINDOW_MS)) return 'WAITING FOR ACTIVITY';
    return 'ACTIVE';
  }

  function clearSession() {
    state.sessionToken = '';
    state.identity = null;
    state.activeRequest = null;
    state.activeTransaction = null;
    state.verificationCredential = null;
    state.reviverQueue = [];
    GM_setValue(KEYS.sessionToken, '');
    GM_setValue(KEYS.publicIdentity, null);
    refreshPanel();
    renderActiveRequest();
    renderVerificationCredential();
    renderActiveTransaction();
    renderReviverMarketplace();
  }

  function identityFromMe(me, fallback = null) {
    if (!me?.user) return fallback;
    return {
      ...me.user,
      roles: Array.isArray(me?.roles) ? me.roles : []
    };
  }

  async function restoreSession() {
    if (!state.sessionToken) return false;
    try {
      const me = await state.api.getMe();
      state.identity = identityFromMe(me, null);
      GM_setValue(KEYS.publicIdentity, state.identity);
      await refreshMarketplaceState();
      return true;
    } catch (error) {
      if (error?.code === 'AUTH_REQUIRED') clearSession();
      else {
        reportClientError(error, 'session.restore');
        console.warn('[ReviveRelay] Session restore failed', error?.code || error?.message || error);
      }
      return false;
    }
  }

  async function connectIdentity() {
    const apiKeyInput = document.getElementById('rr-api-key');
    const apiKey = String(apiKeyInput?.value || '').trim();
    if (!apiKey) {
      setStatus('Enter a minimally scoped Torn API key for identity verification.', true);
      return;
    }
    const button = document.getElementById('rr-connect');
    if (button) button.disabled = true;
    try {
      setStatus('Verifying Torn identity...');
      const result = await state.api.bind(apiKey, VERSION);
      state.sessionToken = String(result?.token || '');
      state.identity = result?.user || null;
      GM_setValue(KEYS.sessionToken, state.sessionToken);
      const me = await state.api.getMe();
      state.identity = identityFromMe(me, state.identity);
      GM_setValue(KEYS.publicIdentity, state.identity);
      setStatus(`Connected as ${state.identity?.name || state.identity?.tornId || 'Torn player'}. Identity key discarded by server.`);
      await refreshMarketplaceState();
    } catch (error) {
      reportClientError(error, 'identity.connect');
      setStatus(`Connection failed: ${error?.code || 'REQUEST_FAILED'}`, true);
    } finally {
      apiKeyInput.value = '';
      if (button) button.disabled = false;
      refreshPanel();
    }
  }

  function validateRequestInput(paymentMethod, amount, comment) {
    if (!Number.isInteger(amount)) return 'Offer must be a whole number.';
    if (paymentMethod === 'cash' && amount < 500000) return 'Cash minimum is $500,000.';
    if (paymentMethod === 'xanax' && amount < 1) return 'Minimum is 1 Xanax.';
    if (!['cash', 'xanax'].includes(paymentMethod)) return 'Choose Cash or Xanax.';
    if (comment.length > 500) return 'Comment must be 500 characters or fewer.';
    return '';
  }

  async function submitReviveRequest() {
    if (!state.sessionToken) {
      setStatus('Connect your Torn identity before requesting a revive.', true);
      return;
    }
    if (!hasCredentialCapability('requester')) {
      setStatus('Bind a valid transaction-verification key before creating a protected request.', true);
      return;
    }
    const selected = document.querySelector('input[name="rr-payment-method"]:checked');
    const paymentMethod = selected?.value || 'cash';
    const amount = Number(document.getElementById('rr-offer-amount')?.value || 0);
    const comment = String(document.getElementById('rr-comment')?.value || '').trim();
    const validationError = validateRequestInput(paymentMethod, amount, comment);
    if (validationError) {
      setStatus(validationError, true);
      return;
    }
    try {
      setStatus('Submitting revive request...');
      await state.api.createRequest({ paymentMethod, offerAmount: amount, comment: comment || undefined });
      setStatus('Protected revive request is active.');
      await refreshMarketplaceState();
    } catch (error) {
      reportClientError(error, 'request.create');
      setStatus(`Request failed: ${error?.code || 'REQUEST_FAILED'}`, true);
    }
  }

  function hasCredentialCapability(role) {
    const credential = state.verificationCredential;
    return Boolean(credential && credential.usable && credential.capabilities && credential.capabilities[role] === true);
  }

  function formatCountdown(timestamp) {
    if (!timestamp) return '';
    const deadline = new Date(timestamp).getTime();
    if (!Number.isFinite(deadline)) return '';
    const remaining = Math.max(0, deadline - Date.now());
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  async function refreshVerificationCredential() {
    if (!state.sessionToken) {
      state.verificationCredential = null;
      renderVerificationCredential();
      return;
    }
    try {
      const result = await state.api.getVerificationCredential();
      state.verificationCredential = result?.credential || null;
    } catch (error) {
      if (error?.code === 'AUTH_REQUIRED') clearSession();
      else {
        reportClientError(error, 'verification.refresh');
        console.warn('[ReviveRelay] Verification credential refresh failed', error?.code || error?.message || error);
      }
    }
    renderVerificationCredential();
    refreshPanel();
  }

  async function bindTransactionVerificationCredential() {
    const verificationKeyInput = document.getElementById('rr-verification-key');
    const apiKey = String(verificationKeyInput?.value || '').trim();
    if (!apiKey) {
      setStatus('Paste the dedicated transaction-verification Torn key.', true);
      return;
    }
    try {
      setStatus('Validating transaction-verification key...');
      const result = await state.api.bindVerificationCredential(apiKey);
      state.verificationCredential = result?.credential || null;
      setStatus('Transaction-verification key validated and encrypted server-side.');
    } catch (error) {
      reportClientError(error, 'verification.bind');
      setStatus(`Verification key failed: ${error?.code || 'REQUEST_FAILED'}`, true);
    } finally {
      verificationKeyInput.value = '';
      renderVerificationCredential();
      refreshPanel();
    }
  }

  async function revokeTransactionVerificationCredential() {
    try {
      await state.api.revokeVerificationCredential();
      state.verificationCredential = null;
      state.reviverQueue = [];
      setStatus('Transaction-verification key revoked. Existing transactions remain visible.');
    } catch (error) {
      reportClientError(error, 'verification.revoke');
      setStatus(`Revoke failed: ${error?.code || 'REQUEST_FAILED'}`, true);
    }
    renderVerificationCredential();
    renderReviverMarketplace();
    refreshPanel();
  }

  function renderVerificationCredential() {
    const box = document.getElementById('rr-verification-status');
    if (!box) return;
    const credential = state.verificationCredential;
    if (!credential) {
      box.innerHTML = '<div class="rr-warning">No transaction-verification key bound. Protected Request/Accept actions are disabled.</div>';
      return;
    }
    const capabilities = [];
    if (credential.capabilities?.requester) capabilities.push('requester');
    if (credential.capabilities?.reviver) capabilities.push('reviver');
    box.innerHTML = `<div><strong>${credential.usable ? 'VALID' : 'UNUSABLE'}</strong> · ${escapeHtml(capabilities.join(', ') || 'no protected capability')}</div>
      <div class="rr-muted">Last validated: ${escapeHtml(credential.lastValidatedAt || 'unknown')}</div>`;
  }

  async function refreshActiveTransaction() {
    const transactionId = state.activeRequest?.transactionId || state.activeTransaction?.id;
    if (!transactionId) {
      state.activeTransaction = null;
      renderActiveTransaction();
      return;
    }
    try {
      const result = await state.api.getTransaction(transactionId);
      state.activeTransaction = result?.transaction || null;
    } catch (error) {
      if (error?.code === 'TRANSACTION_NOT_FOUND') state.activeTransaction = null;
      else if (error?.code === 'AUTH_REQUIRED') clearSession();
      else {
        reportClientError(error, 'transaction.refresh');
        console.warn('[ReviveRelay] Transaction refresh failed', error?.code || error?.message || error);
      }
    }
    renderActiveTransaction();
  }

  async function refreshReviverQueue() {
    if (!state.sessionToken || !hasCredentialCapability('reviver') || !Array.isArray(state.identity?.roles) || !state.identity.roles.includes('reviver')) {
      state.reviverQueue = [];
      renderReviverMarketplace();
      return;
    }
    try {
      const result = await state.api.getReviverQueue();
      state.reviverQueue = Array.isArray(result?.requests) ? result.requests : [];
    } catch (error) {
      if (!['REVIVER_REQUIRED','VERIFICATION_CREDENTIAL_REQUIRED','VERIFICATION_CREDENTIAL_INVALID','VERIFICATION_CREDENTIAL_INSUFFICIENT'].includes(error?.code)) {
        reportClientError(error, 'reviver.queue.refresh');
        console.warn('[ReviveRelay] Reviver queue refresh failed', error?.code || error?.message || error);
      }
      state.reviverQueue = [];
    }
    renderReviverMarketplace();
  }

  async function refreshMarketplaceState() {
    await refreshVerificationCredential();
    await refreshActiveRequest();
    await refreshActiveTransaction();
    await refreshReviverQueue();
  }

  async function registerAsReviver() {
    if (!hasCredentialCapability('reviver')) {
      setStatus('A reviver-capable verification key is required first.', true);
      return;
    }
    try {
      await state.api.registerReviver();
      const me = await state.api.getMe();
      state.identity = identityFromMe(me, state.identity);
      GM_setValue(KEYS.publicIdentity, state.identity);
      setStatus('Registered as a ReviveRelay reviver.');
      await refreshReviverQueue();
    } catch (error) {
      reportClientError(error, 'reviver.register');
      setStatus(`Reviver registration failed: ${error?.code || 'REQUEST_FAILED'}`, true);
    }
  }

  async function acceptMarketplaceRequest(requestId) {
    if (!hasCredentialCapability('reviver')) return;
    try {
      const result = await state.api.acceptRequest(requestId);
      state.activeTransaction = result?.transaction || null;
      setStatus('Revive request accepted. Payment window is now active.');
      await refreshMarketplaceState();
    } catch (error) {
      reportClientError(error, 'request.accept');
      setStatus(`Accept failed: ${error?.code || 'REQUEST_FAILED'}`, true);
      await refreshReviverQueue();
    }
  }

  async function transactionAction(action) {
    const transaction = state.activeTransaction;
    if (!transaction?.id) return;
    try {
      if (action === 'check-payment') await state.api.checkPayment(transaction.id);
      else if (action === 'retry-request') await state.api.requestRetry(transaction.id);
      else if (action === 'retry-accept') await state.api.respondRetry(transaction.id, 'accept');
      else if (action === 'retry-decline') await state.api.respondRetry(transaction.id, 'decline');
      else if (action === 'request-refund') await state.api.requestRefund(transaction.id);
      else if (action === 'check-refund') await state.api.checkRefund(transaction.id);
      else return;
      setStatus('Transaction action submitted.');
      await refreshActiveTransaction();
    } catch (error) {
      reportClientError(error, 'transaction.action');
      setStatus(`Transaction action failed: ${error?.code || 'REQUEST_FAILED'}`, true);
      await refreshActiveTransaction();
    }
  }

  function renderActiveTransaction() {
    const boxes = ['rr-active-transaction', 'rr-reviver-transaction']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (!boxes.length) return;
    const tx = state.activeTransaction;
    const render = (box) => {
      if (!tx) {
        box.innerHTML = '<div class="rr-empty-state">No assigned protected transaction.</div>';
        return;
      }
      const deadlineRows = [
        ['Payment', tx.paymentDeadline],
        ['Revive', tx.reviveDeadline],
        ['Retry response', tx.retryResponseDeadline],
        ['Refund', tx.refundDeadline]
      ].filter(([, value]) => value);
      const requester = tx.requester ? `${tx.requester.name || 'Requester'} [${tx.requester.tornId}]` : '';
      const reviver = tx.reviver ? `${tx.reviver.name || 'Reviver'} [${tx.reviver.tornId}]` : '';
      if (!clientSupported()) {
        box.innerHTML = `<div class="rr-state-line"><strong>${escapeHtml(tx.state || '')}</strong></div><div class="rr-warning">Update ReviveRelay to use protected transaction actions.</div>`;
        return;
      }
      let actions = '';
      if (['WAITING_FOR_PAYMENT','PAYMENT_RECONCILING'].includes(tx.state)) actions += '<button data-rr-tx-action="check-payment">Check payment</button>';
      if (tx.participantRole === 'requester' && tx.state === 'FAILED_ATTEMPT_CHOICE') actions += '<button data-rr-tx-action="retry-request">Retry</button><button data-rr-tx-action="request-refund">Request refund</button>';
      if (tx.participantRole === 'reviver' && tx.state === 'RETRY_OFFERED') actions += '<button data-rr-tx-action="retry-accept">Accept retry</button><button data-rr-tx-action="retry-decline">Decline retry</button>';
      if (['REFUND_REQUIRED','REFUND_RECONCILING'].includes(tx.state)) actions += '<button data-rr-tx-action="check-refund">Check refund</button>';
      box.innerHTML = `<div class="rr-card-heading"><span>Transaction</span><span class="rr-status-chip">${escapeHtml(tx.state || 'ACTIVE')}</span></div>
        <div class="rr-transaction-route">${escapeHtml(requester)} <span>→</span> ${escapeHtml(reviver)}</div>
        <div class="rr-offer-line">${escapeHtml(formatOffer(tx.terms?.paymentMethod, tx.terms?.offerAmount))}</div>
        ${deadlineRows.map(([label, value]) => `<div class="rr-deadline"><span>${label}</span><strong>${formatCountdown(value)}</strong></div>`).join('')}
        <div class="rr-actions rr-transaction-actions">${actions}</div>`;
      box.querySelectorAll('[data-rr-tx-action]').forEach(button => {
        button.onclick = () => transactionAction(button.getAttribute('data-rr-tx-action'));
      });
    };
    boxes.forEach(render);
  }

  function formatRelativeAge(timestamp) {
    const then = new Date(timestamp || 0).getTime();
    if (!Number.isFinite(then) || then <= 0) return 'just now';
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }

  function formatOffer(method, amount) {
    const value = Number(amount || 0);
    if (String(method).toLowerCase() === 'cash') return `$${Math.max(0, value).toLocaleString()}`;
    if (String(method).toLowerCase() === 'xanax') return `${Math.max(0, value).toLocaleString()} Xanax`;
    return `${String(method || '').toUpperCase()} ${Math.max(0, value).toLocaleString()}`.trim();
  }

  function renderReviverMarketplace() {
    const box = document.getElementById('rr-reviver-queue');
    if (!box) return;
    const canRevive = hasCredentialCapability('reviver') && clientSupported();
    const isReviver = Array.isArray(state.identity?.roles) && state.identity.roles.includes('reviver');
    if (!canRevive) {
      box.innerHTML = '<div class="rr-empty-state rr-warning">Bind a reviver-capable verification key in Settings to enable the queue and Accept.</div>';
      return;
    }
    if (!isReviver) {
      box.innerHTML = '<div class="rr-empty-state">Your verification key is reviver-capable.</div><button id="rr-register-reviver" class="rr-primary" type="button">Register as reviver</button>';
      document.getElementById('rr-register-reviver').onclick = registerAsReviver;
      return;
    }
    box.innerHTML = state.reviverQueue.length ? state.reviverQueue.map(request => `<article class="rr-market-card">
      <div class="rr-market-top">
        <div><strong>${escapeHtml(request.requesterName || 'Requester')}</strong><span class="rr-muted"> [${escapeHtml(request.requesterTornId || '')}]</span></div>
        <span class="rr-age">${escapeHtml(formatRelativeAge(request.createdAt))}</span>
      </div>
      <div class="rr-market-offer">${escapeHtml(formatOffer(request.paymentMethod, request.offerAmount))}</div>
      ${request.comment ? `<div class="rr-market-comment">“${escapeHtml(request.comment)}”</div>` : '<div class="rr-muted">No comment supplied.</div>'}
      <div class="rr-market-footer"><span class="rr-status-chip">AVAILABLE</span><button class="rr-primary" data-rr-accept="${escapeHtml(request.id)}" ${canRevive ? '' : 'disabled'}>Accept</button></div>
    </article>`).join('') : '<div class="rr-empty-state">No available revive requests.</div>';
    box.querySelectorAll('[data-rr-accept]').forEach(button => {
      button.onclick = () => acceptMarketplaceRequest(button.getAttribute('data-rr-accept'));
    });
  }

  async function refreshActiveRequest() {
    if (!state.sessionToken) {
      state.activeRequest = null;
      renderActiveRequest();
      return;
    }
    try {
      const result = await state.api.getActiveRequest();
      state.activeRequest = result?.request || null;
      renderActiveRequest();
    } catch (error) {
      if (error?.code === 'AUTH_REQUIRED') clearSession();
      else {
        reportClientError(error, 'request.refresh');
        console.warn('[ReviveRelay] Active request refresh failed', error?.code || error?.message || error);
      }
    }
  }

  async function cancelActiveRequest() {
    if (!state.activeRequest?.id) return;
    try {
      await state.api.cancelRequest(state.activeRequest.id);
      setStatus('Revive request cancelled.');
      await refreshActiveRequest();
    } catch (error) {
      reportClientError(error, 'request.cancel');
      setStatus(`Cancel failed: ${error?.code || 'REQUEST_FAILED'}`, true);
      await refreshActiveRequest();
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderActiveRequest() {
    const box = document.getElementById('rr-active-request');
    const form = document.getElementById('rr-request-form');
    if (!box) return;
    if (!state.sessionToken) {
      if (form) form.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    const request = state.activeRequest;
    if (!request) {
      if (form) form.style.display = '';
      box.innerHTML = '<div class="rr-empty-state">No active revive request.</div>';
      return;
    }
    if (form) form.style.display = 'none';
    const cancellable = ['AVAILABLE', 'WAITING_FOR_PAYMENT'].includes(request.state);
    box.innerHTML = `<div class="rr-active-request-card">
      <div class="rr-card-heading"><span>Active request</span><span class="rr-status-chip">${escapeHtml(request.state || 'ACTIVE')}</span></div>
      <div class="rr-market-offer">${escapeHtml(formatOffer(request.paymentMethod, request.offerAmount))}</div>
      ${request.comment ? `<div class="rr-market-comment">“${escapeHtml(request.comment)}”</div>` : ''}
      <div class="rr-muted">Request ${escapeHtml(request.id || '')}</div>
      ${cancellable ? '<button id="rr-cancel-request" class="rr-danger-subtle" type="button">Cancel request</button>' : ''}
    </div>`;
    const cancel = document.getElementById('rr-cancel-request');
    if (cancel) cancel.onclick = cancelActiveRequest;
  }

  function liveEventMatchesFilter(event, filter) {
    if (filter === 'all') return true;
    if (filter === 'candidates') return event.candidate;
    return event.channel?.type === filter;
  }

  function renderLiveCapture() {
    const container = document.getElementById('rr-live-events');
    if (!container) return;
    const filter = String(document.getElementById('rr-live-filter')?.value || GM_getValue(KEYS.liveFilter, 'all'));
    const rows = state.liveEvents.filter((event) => liveEventMatchesFilter(event, filter));
    container.innerHTML = rows.length ? rows.map((event) => `
      <div class="rr-live-row">
        <div><strong>${escapeHtml(event.channel?.name || 'Public')}</strong> · ${event.candidate ? 'CANDIDATE' : 'local only'} · score ${escapeHtml(event.score)}</div>
        <div>${escapeHtml(event.text)}</div>
        <div class="rr-muted">${escapeHtml(event.submission)}${event.reasons.length ? ` · ${escapeHtml(event.reasons.join(', '))}` : ''}</div>
      </div>
    `).join('') : '<div class="rr-muted">No matching local events yet.</div>';
  }

  function applyPanelPosition(position = state.panelPosition, persist = false) {
    const panel = document.getElementById('rr-panel');
    if (!panel) return null;
    if (!position || typeof position !== 'object') {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '16px';
      panel.style.bottom = '16px';
      state.panelPosition = null;
      return null;
    }
    const rect = panel.getBoundingClientRect();
    const clamped = Core.clampPanelPosition(
      position,
      { width: window.innerWidth, height: window.innerHeight },
      { width: rect.width, height: rect.height },
      8
    );
    panel.style.left = `${clamped.x}px`;
    panel.style.top = `${clamped.y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    state.panelPosition = clamped;
    if (persist) GM_setValue(KEYS.panelPosition, clamped);
    return clamped;
  }

  function resetPanelPosition() {
    state.panelPosition = null;
    GM_setValue(KEYS.panelPosition, null);
    applyPanelPosition(null, false);
  }

  function activatePanelTab(tab, persist = true) {
    state.panelTab = Core.normalizePanelTab(tab);
    if (persist) GM_setValue(KEYS.panelTab, state.panelTab);
    document.querySelectorAll('#rr-panel [data-rr-tab]').forEach((button) => {
      const active = button.getAttribute('data-rr-tab') === state.panelTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('#rr-panel [data-rr-panel]').forEach((page) => {
      page.classList.toggle('active', page.getAttribute('data-rr-panel') === state.panelTab);
    });
  }

  function wirePanelDragging(panel) {
    const header = document.getElementById('rr-header');
    if (!header) return;
    let drag = null;
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId);
      panel.classList.add('rr-dragging');
      event.preventDefault();
    });
    header.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      applyPanelPosition({ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY }, false);
    });
    const finishDrag = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      applyPanelPosition(state.panelPosition, true);
      panel.classList.remove('rr-dragging');
      if (header.hasPointerCapture?.(event.pointerId)) header.releasePointerCapture(event.pointerId);
      drag = null;
    };
    header.addEventListener('pointerup', finishDrag);
    header.addEventListener('pointercancel', finishDrag);
    header.addEventListener('dblclick', (event) => {
      if (event.target.closest('button')) return;
      resetPanelPosition();
    });
    window.addEventListener('resize', () => {
      if (!state.panelPosition) return;
      requestAnimationFrame(() => applyPanelPosition(state.panelPosition, true));
    });
  }

  function refreshPanel() {
    const status = stateLabel();
    const values = {
      'rr-state': status,
      'rr-summary-state': status,
      'rr-identity': state.identity ? `${state.identity.name || 'Player'} [${state.identity.tornId || ''}]` : 'Not connected',
      'rr-open-chats': state.stats.openChats,
      'rr-list-items': state.stats.chatListItems,
      'rr-processed': state.stats.processed,
      'rr-candidates': state.stats.candidates,
      'rr-queued': state.stats.queued,
      'rr-submitted': state.stats.submitted,
      'rr-duplicates': state.stats.duplicates,
      'rr-dead': state.stats.deadLetters,
      'rr-summary-processed': state.stats.processed,
      'rr-summary-candidates': state.stats.candidates,
      'rr-summary-submitted': state.stats.submitted
    };
    for (const [id, value] of Object.entries(values)) {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    }
    const body = document.getElementById('rr-body');
    if (body) body.style.display = state.minimized ? 'none' : '';
    const minimize = document.getElementById('rr-minimize');
    if (minimize) {
      minimize.textContent = state.minimized ? '+' : '−';
      minimize.setAttribute('aria-label', state.minimized ? 'Expand ReviveRelay' : 'Minimize ReviveRelay');
    }
    const connectionPill = document.getElementById('rr-connection-pill');
    if (connectionPill) {
      connectionPill.textContent = state.sessionToken ? 'CONNECTED' : 'OFFLINE';
      connectionPill.classList.toggle('connected', Boolean(state.sessionToken));
    }
    const pause = document.getElementById('rr-pause');
    const updateCheck = document.getElementById('rr-update-check');
    const updateSwitch = document.getElementById('rr-update-switch');
    if (updateCheck) updateCheck.onclick = () => checkForUpdates(true);
    if (updateSwitch) updateSwitch.onclick = () => state.updateManager?.switchChannel(UPDATE_CHANNEL === 'automatic' ? 'manual' : 'automatic');
    const diagnostics = document.getElementById('rr-diagnostics-enabled');
    if (diagnostics) diagnostics.checked = state.clientDiagnosticsEnabled;
    if (pause) pause.textContent = state.paused ? 'Resume collection' : 'Pause collection';
    const onboarding = document.getElementById('rr-onboarding');
    if (onboarding) onboarding.style.display = state.sessionToken ? 'none' : '';
    const requester = document.getElementById('rr-requester');
    if (requester) requester.style.display = state.sessionToken ? '' : 'none';
    const verification = document.getElementById('rr-verification');
    if (verification) verification.style.display = state.sessionToken ? '' : 'none';
    const reviver = document.getElementById('rr-reviver');
    if (reviver) reviver.style.display = state.sessionToken ? '' : 'none';
    const reviverHint = document.getElementById('rr-reviver-connect-hint');
    if (reviverHint) reviverHint.style.display = state.sessionToken ? 'none' : '';
    const requestButton = document.getElementById('rr-request');
    if (requestButton) {
      requestButton.disabled = !state.sessionToken || !hasCredentialCapability('requester') || !clientSupported();
      requestButton.title = !clientSupported() ? 'ReviveRelay update required' : (requestButton.disabled ? 'Requester-capable verification key required' : '');
    }
    activatePanelTab(state.panelTab, false);
    renderActiveRequest();
    renderVerificationCredential();
    renderReviverMarketplace();
    renderActiveTransaction();
    renderUpdateStatus();
  }

  function createPanel() {
    GM_addStyle(`
      #rr-panel{position:fixed;right:16px;bottom:16px;z-index:1000000;width:min(420px,calc(100vw - 16px));max-height:min(84vh,760px);background:#14181d;color:#e8edf2;border:1px solid #434a52;border-top:2px solid #b8793f;border-radius:10px;box-shadow:0 12px 34px #0009;font:12px/1.45 Arial,sans-serif;overflow:hidden;box-sizing:border-box}
      #rr-panel.rr-dragging{box-shadow:0 16px 42px #000b;opacity:.98}
      #rr-header{display:flex;align-items:center;gap:9px;padding:8px 9px 8px 11px;background:linear-gradient(180deg,#272d34,#20262c);border-bottom:1px solid #353c44;cursor:move;touch-action:none;user-select:none}
      .rr-brand{display:flex;align-items:center;gap:7px;min-width:0;flex:1}.rr-brand-mark{color:#b8793f;font-size:14px}.rr-brand-copy{display:flex;align-items:baseline;gap:6px;min-width:0}.rr-brand-name{font-size:13px;font-weight:800;letter-spacing:.2px}.rr-version{color:#89939d;font-size:9px;font-weight:600}
      #rr-connection-pill{flex:0 0 auto;padding:2px 6px;border:1px solid #5c6269;border-radius:999px;color:#aeb5bc;background:#191e23;font-size:8px;font-weight:800;letter-spacing:.5px}#rr-connection-pill.connected{color:#8ed6b0;border-color:#3d795c;background:#173024}
      #rr-minimize{width:25px;height:24px;padding:0!important;border-radius:5px!important;font-size:16px;line-height:1;background:#2b3239!important}
      #rr-body{max-height:calc(min(84vh,760px) - 42px);overflow:auto;background:#14181d}
      .rr-summary{display:grid;grid-template-columns:1.35fr repeat(3,1fr);gap:6px;padding:9px 10px;background:#171c21;border-bottom:1px solid #2d343b}.rr-summary-main{display:flex;flex-direction:column;justify-content:center}.rr-summary-main strong{font-size:10px}.rr-summary-main span{font-size:9px;color:#89949e}.rr-summary-stat{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5px 3px;background:#1e242a;border:1px solid #303840;border-radius:6px}.rr-summary-stat strong{font-size:13px;color:#dce5ec}.rr-summary-stat span{font-size:8px;color:#87919a;text-transform:uppercase;letter-spacing:.3px}
      .rr-tabs{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:repeat(4,1fr);background:#101419;border-bottom:1px solid #333a42}.rr-tab{appearance:none;border:0!important;border-radius:0!important;padding:8px 4px!important;background:transparent!important;color:#8f9aa4!important;font-size:10px;font-weight:700;border-bottom:2px solid transparent!important}.rr-tab:hover{background:#1b2127!important;color:#e7edf3!important}.rr-tab.active{color:#e9eef2!important;background:#1a2026!important;border-bottom-color:#b8793f!important}
      .rr-panel-page{display:none;padding:10px}.rr-panel-page.active{display:block}.rr-card{margin:0 0 9px;padding:10px;background:#1b2026;border:1px solid #333b44;border-radius:8px}.rr-card-primary{border-color:#564332;border-left:3px solid #b8793f;background:linear-gradient(135deg,#211e1b,#1a2026 55%)}.rr-card-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-weight:800}.rr-card-heading>span:first-child{font-size:11px;letter-spacing:.15px}
      .rr-status-chip{display:inline-flex;align-items:center;padding:2px 6px;border:1px solid #4b5966;border-radius:999px;background:#17212a;color:#8fc9dc;font-size:8px;font-weight:800;letter-spacing:.35px;white-space:nowrap}
      #rr-panel input,#rr-panel textarea,#rr-panel select{width:100%;box-sizing:border-box;margin:4px 0 8px;padding:7px 8px;background:#0f1317;color:#e7edf3;border:1px solid #46515c;border-radius:5px;outline:none}#rr-panel input:focus,#rr-panel textarea:focus,#rr-panel select:focus{border-color:#7b684e;box-shadow:0 0 0 2px #b8793f22}#rr-panel input[type=radio],#rr-panel input[type=checkbox]{width:auto;margin:0 5px 0 0}
      .rr-payment-choices{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:4px 0 8px}.rr-choice{display:flex;align-items:center;justify-content:center;gap:4px;padding:7px;border:1px solid #3d4751;border-radius:6px;background:#161b20;cursor:pointer;font-weight:700}.rr-choice:has(input:checked){border-color:#8b6949;background:#2a2119;color:#f0ddca}
      .rr-actions{display:flex;flex-wrap:wrap;gap:6px}.rr-actions button,#rr-panel button{background:#303943;color:#fff;border:1px solid #4b5865;border-radius:5px;padding:6px 9px;cursor:pointer;font:inherit;font-weight:700}.rr-actions button:hover,#rr-panel button:hover{filter:brightness(1.12)}#rr-panel button:disabled{opacity:.45;cursor:not-allowed;filter:none}.rr-primary{background:#8b5f38!important;border-color:#b8793f!important;color:#fff7ef!important}.rr-danger-subtle{margin-top:8px;background:#342425!important;border-color:#684044!important;color:#e9b6b6!important}
      .rr-muted{color:#98a3ad;font-size:9px}.rr-warning{color:#dfbd70;font-size:9px;margin:6px 0}.rr-empty-state{padding:8px;border:1px dashed #39424b;border-radius:6px;color:#919ca6;text-align:center;font-size:10px}.rr-field-label{display:block;margin-top:4px;color:#c9d1d8;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.35px}.rr-grid{display:grid;grid-template-columns:1fr auto;gap:5px 8px}.rr-grid strong{text-align:right}
      .rr-market-card{padding:9px;margin-top:7px;background:#151a1f;border:1px solid #303840;border-radius:7px}.rr-market-top,.rr-market-footer{display:flex;align-items:center;justify-content:space-between;gap:8px}.rr-market-offer{margin:7px 0 5px;color:#e7d2bd;font-size:15px;font-weight:800}.rr-market-comment{margin:5px 0 8px;padding:6px 7px;border-left:2px solid #4c6670;background:#172026;color:#cbd7dc;font-size:10px;word-break:break-word}.rr-age{color:#7f8a94;font-size:9px}.rr-market-footer{margin-top:8px}.rr-transaction-route{color:#c8d1d8;font-size:10px;word-break:break-word}.rr-transaction-route span{color:#6eb2c2}.rr-offer-line{margin:7px 0;color:#e3ccb5;font-size:13px;font-weight:800}.rr-deadline{display:flex;justify-content:space-between;padding:3px 0;border-top:1px solid #293038;color:#929da6;font-size:9px}.rr-deadline strong{color:#cbd6de}.rr-transaction-actions{margin-top:8px}.rr-live-row{border-top:1px solid #2b3239;padding:6px 0;word-break:break-word}.rr-live-row:first-child{border-top:0}.rr-active-request-card{padding-top:3px}
      #rr-status{margin:9px 10px 10px;padding:7px 8px;background:#17231d;border:1px solid #2f5742;border-radius:6px;color:#9bd5a5;word-break:break-word;font-size:9px}#rr-status.error{background:#2c1c1d;border-color:#6b383b;color:#ffaaaa}.rr-privacy-note{margin:9px 0 0;padding:7px;border-radius:6px;background:#161c21;border:1px solid #2c343c;color:#89949e;font-size:8px}
      @media (max-width:520px){#rr-panel{right:8px;bottom:8px}.rr-summary{grid-template-columns:1fr repeat(3,.75fr);padding:7px}.rr-panel-page{padding:8px}.rr-card{padding:9px}}
    `);

    const panel = document.createElement('div');
    panel.id = 'rr-panel';
    panel.innerHTML = `
      <div id="rr-header" title="Drag to move. Double-click to reset position.">
        <div class="rr-brand"><span class="rr-brand-mark">◆</span><div class="rr-brand-copy"><span class="rr-brand-name">ReviveRelay</span><span class="rr-version">v${VERSION}</span></div></div>
        <span id="rr-connection-pill">OFFLINE</span>
        <button id="rr-minimize" type="button" aria-label="Minimize ReviveRelay">−</button>
      </div>
      <div id="rr-body">
        <div class="rr-summary">
          <div class="rr-summary-main"><strong id="rr-summary-state">STARTING</strong><span>public revive relay</span></div>
          <div class="rr-summary-stat"><strong id="rr-summary-processed">0</strong><span>Processed</span></div>
          <div class="rr-summary-stat"><strong id="rr-summary-candidates">0</strong><span>Candidates</span></div>
          <div class="rr-summary-stat"><strong id="rr-summary-submitted">0</strong><span>Sent</span></div>
        </div>
        <div class="rr-tabs" role="tablist" aria-label="ReviveRelay sections">
          <button class="rr-tab" type="button" role="tab" data-rr-tab="request" aria-selected="true">Request</button>
          <button class="rr-tab" type="button" role="tab" data-rr-tab="reviver" aria-selected="false">Reviver</button>
          <button class="rr-tab" type="button" role="tab" data-rr-tab="activity" aria-selected="false">Activity</button>
          <button class="rr-tab" type="button" role="tab" data-rr-tab="settings" aria-selected="false">Settings</button>
        </div>

        <section class="rr-panel-page" data-rr-panel="request" role="tabpanel">
          <div id="rr-onboarding" class="rr-card rr-card-primary">
            <div class="rr-card-heading"><span>Connect ReviveRelay</span><span class="rr-status-chip">ONE-TIME</span></div>
            <div class="rr-muted">Your Torn key is sent over HTTPS only for identity verification. The identity key is not stored by ReviveRelay.</div>
            <label class="rr-field-label" for="rr-api-key">Minimally scoped Torn API key</label>
            <input id="rr-api-key" type="password" autocomplete="off" placeholder="Paste key for one-time identity verification">
            <button id="rr-connect" class="rr-primary" type="button">Verify &amp; connect</button>
          </div>
          <div id="rr-requester" style="display:none">
            <div id="rr-request-card" class="rr-card rr-card-primary">
              <div class="rr-card-heading"><span>Request a revive</span><span class="rr-status-chip">REQUESTER</span></div>
              <div id="rr-request-form">
                <span class="rr-field-label">Payment</span>
                <div class="rr-payment-choices"><label class="rr-choice"><input type="radio" name="rr-payment-method" value="cash" checked>Cash</label><label class="rr-choice"><input type="radio" name="rr-payment-method" value="xanax">Xanax</label></div>
                <label class="rr-field-label" for="rr-offer-amount">Offer</label><input id="rr-offer-amount" type="number" min="1" step="1" value="500000">
                <div class="rr-muted">Cash minimum $500,000. Minimum 1 Xanax. Whole numbers only.</div>
                <label class="rr-field-label" for="rr-comment">Comment for reviver</label><textarea id="rr-comment" maxlength="500" rows="2" placeholder="Optional message, up to 500 characters"></textarea>
                <button id="rr-request" class="rr-primary" type="button">Request Revive</button><div class="rr-muted">Protected requests require a validated requester-capable verification key in Settings.</div>
              </div>
              <div id="rr-active-request"></div>
            </div>
            <div id="rr-active-transaction" class="rr-card"></div>
          </div>
        </section>

        <section class="rr-panel-page" data-rr-panel="reviver" role="tabpanel">
          <div id="rr-reviver" style="display:none"><div class="rr-card"><div class="rr-card-heading"><span>Reviver marketplace</span><span class="rr-status-chip">QUEUE</span></div><div class="rr-muted">Registration, queue and Accept require a validated reviver-capable verification key.</div><div id="rr-reviver-queue"></div></div><div id="rr-reviver-transaction" class="rr-card"></div></div>
          <div id="rr-reviver-connect-hint" class="rr-empty-state">Connect from the Request tab to use reviver tools.</div>
        </section>

        <section class="rr-panel-page" data-rr-panel="activity" role="tabpanel">
          <div class="rr-card"><div class="rr-card-heading"><span>Collection activity</span><span id="rr-state" class="rr-status-chip">STARTING</span></div><div class="rr-grid"><span>Identity</span><strong id="rr-identity">Not connected</strong><span>Public chats loaded</span><strong id="rr-open-chats">0</strong><span>Public list items</span><strong id="rr-list-items">0</strong><span>Processed locally</span><strong id="rr-processed">0</strong><span>Revive candidates</span><strong id="rr-candidates">0</strong><span>Queue</span><strong id="rr-queued">0</strong><span>Submitted</span><strong id="rr-submitted">0</strong><span>Duplicate</span><strong id="rr-duplicates">0</strong><span>Dead-letter</span><strong id="rr-dead">0</strong></div></div>
          <div class="rr-card"><div class="rr-card-heading"><span>Live Capture</span><span class="rr-status-chip">LOCAL</span></div><div class="rr-muted">Local processing monitor only. Non-candidate public messages are not uploaded.</div><select id="rr-live-filter"><option value="all">All local events</option><option value="candidates">Likely revive requests</option><option value="global">Global</option><option value="trade">Trade</option><option value="hospital">Hospital</option><option value="jail">Jail</option><option value="travel">Travel</option></select><div id="rr-live-events"><div class="rr-empty-state">No local events yet.</div></div></div>
        </section>

        <section class="rr-panel-page" data-rr-panel="settings" role="tabpanel">
          <div class="rr-card"><div class="rr-card-heading"><span>Account &amp; controls</span><span class="rr-status-chip">SETTINGS</span></div><div class="rr-actions"><button id="rr-pause" type="button">Pause collection</button><button id="rr-rescan" type="button">Rescan public chats</button><button id="rr-refresh-request" type="button">Refresh marketplace</button><button id="rr-disconnect" type="button">Disconnect</button></div></div>
          <div id="rr-verification" class="rr-card" style="display:none"><div class="rr-card-heading"><span>Transaction verification</span><span class="rr-status-chip">PROTECTED</span></div><div class="rr-muted">Use a dedicated narrowly scoped Torn key for payment/revive/refund evidence. It is encrypted server-side and never stored in Tampermonkey.</div><input id="rr-verification-key" type="password" autocomplete="off" placeholder="Dedicated transaction-verification key"><div class="rr-actions"><button id="rr-bind-verification" class="rr-primary" type="button">Bind verification key</button><button id="rr-revoke-verification" type="button">Revoke verification key</button></div><div id="rr-verification-status"><div class="rr-muted">Checking verification status...</div></div></div>
          <div class="rr-card"><div class="rr-card-heading"><span>Updates</span><span class="rr-status-chip">CLIENT</span></div><div class="rr-grid"><span>Current version</span><strong id="rr-update-current">${VERSION}</strong><span>Channel</span><strong id="rr-update-channel"></strong><span>Latest version</span><strong id="rr-update-latest">Unknown</strong><span>Last checked</span><strong id="rr-update-checked">Never</strong></div><div id="rr-update-banner" class="rr-muted">Version check pending.</div><div class="rr-actions"><button id="rr-update-check" type="button">Check now</button><button id="rr-update-switch" type="button">Switch channel</button></div><div class="rr-muted">Automatic uses Tampermonkey's native update mechanism. Manual only notifies and opens the installer; ReviveRelay never rewrites or evals itself.</div></div>
          <div class="rr-card"><div class="rr-card-heading"><span>Diagnostics</span><span class="rr-status-chip">OPTIONAL</span></div><label><input id="rr-diagnostics-enabled" type="checkbox">Send sanitized error diagnostics</label><div class="rr-muted">Sends bounded technical error details only. Chat text, Torn keys, request bodies and raw payloads are never included.</div></div>
          <div class="rr-privacy-note">Only explicitly allowlisted public Torn chats are processed. Faction, Company, private/group-private, competition, poker and unknown chats are rejected before parsing.</div>
        </section>
        <div id="rr-status">Starting...</div>
      </div>`;
    document.body.appendChild(panel);

    const apiKeyInput = document.getElementById('rr-api-key');
    document.getElementById('rr-connect').onclick = connectIdentity;
    document.getElementById('rr-request').onclick = submitReviveRequest;
    document.getElementById('rr-bind-verification').onclick = bindTransactionVerificationCredential;
    document.getElementById('rr-revoke-verification').onclick = revokeTransactionVerificationCredential;
    document.getElementById('rr-refresh-request').onclick = refreshMarketplaceState;
    document.getElementById('rr-disconnect').onclick = () => { clearSession(); apiKeyInput.value = ''; setStatus('Disconnected locally.'); };
    document.getElementById('rr-minimize').onclick = () => {
      state.minimized = !state.minimized;
      GM_setValue(KEYS.minimized, state.minimized);
      refreshPanel();
      requestAnimationFrame(() => { if (state.panelPosition) applyPanelPosition(state.panelPosition, true); });
    };
    document.getElementById('rr-pause').onclick = () => { markInteraction(); state.paused = !state.paused; GM_setValue(KEYS.paused, state.paused); if (!state.paused) discoverChats(); refreshPanel(); };
    const diagnostics = document.getElementById('rr-diagnostics-enabled');
    diagnostics.checked = state.clientDiagnosticsEnabled;
    diagnostics.onchange = () => { state.clientDiagnosticsEnabled = Boolean(diagnostics.checked); GM_setValue(KEYS.clientDiagnosticsEnabled, state.clientDiagnosticsEnabled); if (!state.clientDiagnosticsEnabled) saveStoredArray(KEYS.telemetryOutbox, []); else drainTelemetry(); refreshPanel(); };
    document.getElementById('rr-rescan').onclick = () => { markInteraction(); const contexts = discoverChats(); setStatus(`Rescan found ${contexts.length} eligible public chat(s).`); };
    const filter = document.getElementById('rr-live-filter');
    filter.value = String(GM_getValue(KEYS.liveFilter, 'all') || 'all');
    filter.onchange = () => { GM_setValue(KEYS.liveFilter, filter.value); renderLiveCapture(); };
    for (const radio of document.querySelectorAll('input[name="rr-payment-method"]')) radio.onchange = () => { const amount = document.getElementById('rr-offer-amount'); if (radio.checked) amount.value = radio.value === 'cash' ? '500000' : '1'; };
    panel.querySelectorAll('[data-rr-tab]').forEach((button) => { button.onclick = () => activatePanelTab(button.getAttribute('data-rr-tab'), true); });
    wirePanelDragging(panel);
    activatePanelTab(state.panelTab, false);
    requestAnimationFrame(() => applyPanelPosition(state.panelPosition, Boolean(state.panelPosition)));
    refreshPanel();
    renderActiveRequest();
  }

  function installInteractionListeners() {
    for (const eventName of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      document.addEventListener(eventName, markInteraction, { capture: true, passive: true });
    }
    window.addEventListener('focus', () => {
      refreshPanel();
      queueDiscoveryAndScan();
      drainCandidateOutbox();
      drainTelemetry();
    });
    window.addEventListener('blur', refreshPanel);
    document.addEventListener('visibilitychange', () => {
      refreshPanel();
      if (document.visibilityState === 'visible') {
        queueDiscoveryAndScan();
        drainCandidateOutbox();
        drainTelemetry();
      }
    });
  }

  function installTelemetryListeners() {
    window.addEventListener('error', (event) => {
      reportClientError(event.error || new Error(event.message || 'Window error'), 'window.error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Unhandled rejection'));
      reportClientError(error, 'unhandledrejection');
    });
  }

  async function init() {
    if (!Core || !ChatDom || !PublicChannels || !ClientChatPolicy ||
        !ReviveRelayApiClient || !ReviveRelayVersioning || !ReviveRelayUpdateManager || !ReviveRelayTelemetryClient || !ReviveRelayCandidatePipeline) {
      console.error('[ReviveRelay] Required dependency unavailable.');
      return;
    }

    try {
      const request = ReviveRelayApiClient.createGmRequestAdapter(GM_xmlhttpRequest);
      state.api = ReviveRelayApiClient.createApiClient({
        baseUrl: API_BASE_URL,
        getToken: () => String(GM_getValue(KEYS.sessionToken, '') || ''),
        request,
        clientVersion: VERSION,
        releaseChannel: UPDATE_CHANNEL
      });
      state.updateManager = ReviveRelayUpdateManager.createUpdateManager({
        currentVersion: VERSION,
        channel: UPDATE_CHANNEL,
        fetchManifest: () => state.api.getClientVersionManifest(),
        getState: () => GM_getValue(KEYS.updateState, {}) || {},
        saveState: (value) => GM_setValue(KEYS.updateState, value),
        now: Date.now,
        openUrl: (url) => window.open(url, '_blank', 'noopener')
      });
      state.telemetry = ReviveRelayTelemetryClient.createTelemetryClient({
        submit: (payload) => state.api.submitTelemetry(payload.errors),
        getStoredQueue: () => readStoredArray(KEYS.telemetryOutbox),
        saveStoredQueue: (queue) => saveStoredArray(KEYS.telemetryOutbox, queue),
        version: VERSION,
        buildCommit: BUILD_COMMIT,
        now: Date.now
      });
      createPanel();
      if (visibleAndFocused()) await checkForUpdates(false);
      installInteractionListeners();
      installTelemetryListeners();
      state.telemetryTimer = setInterval(drainTelemetry, TELEMETRY_EVERY_MS);
      if (visibleAndFocused()) state.lastInteractionAt = Date.now();
      installRootObserver();
      discoverChats();
      await restoreSession();
      await drainCandidateOutbox();
      await drainTelemetry();
      setStatus(state.sessionToken ? 'ReviveRelay connected.' : 'ReviveRelay ready. Connect to submit candidates or request a revive.');
      refreshPanel();
    } catch (error) {
      reportClientError(error, 'init');
      console.error('[ReviveRelay] Initialization failed', error);
      if (!document.getElementById('rr-panel')) createPanel();
      setStatus(`Initialization failed: ${error.message}`, true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
