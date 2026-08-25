// ==UserScript==
// @name         ReviveRelay
// @namespace    r4g3runn3r.torn.reviverelay
// @version      0.3.0
// @description  Public-channel revive request detection and direct ReviveRelay requester workflow for Torn.
// @author       R4G3RUNN3R
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      reviverelay.voidsmithindustries.com
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/main/src/core.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/main/src/chat-dom.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/main/src/public-channels.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/main/src/client-chat-policy.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/main/src/api-client.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/main/src/revive-classifier.js
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/main/src/candidate-pipeline.js
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
  const ReviveRelayCandidatePipeline = globalThis.ReviveRelayCandidatePipeline;

  const VERSION = '0.3.0';
  const API_BASE_URL = 'https://reviverelay.voidsmithindustries.com';
  const DISCOVERY_EVERY_MS = 2_000;
  const OUTBOX_EVERY_MS = 5_000;
  const ACTIVE_REQUEST_EVERY_MS = 10_000;
  const ACTIVE_WINDOW_MS = 60_000;
  const MAX_LIVE_EVENTS = 50;

  const KEYS = Object.freeze({
    sessionToken: 'reviverelay_session_token',
    publicIdentity: 'reviverelay_public_identity',
    candidateOutbox: 'reviverelay_candidate_outbox',
    deadLetters: 'reviverelay_candidate_dead_letters',
    paused: 'reviverelay_paused',
    minimized: 'reviverelay_minimized',
    liveFilter: 'reviverelay_live_filter'
  });

  const state = {
    api: null,
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
    draining: false,
    lastInteractionAt: 0,
    activeRequest: null,
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
      if (state.sessionToken) refreshActiveRequest();
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
    GM_setValue(KEYS.sessionToken, '');
    GM_setValue(KEYS.publicIdentity, null);
    refreshPanel();
    renderActiveRequest();
  }

  async function restoreSession() {
    if (!state.sessionToken) return false;
    try {
      const me = await state.api.getMe();
      state.identity = me?.user || null;
      GM_setValue(KEYS.publicIdentity, state.identity);
      await refreshActiveRequest();
      return true;
    } catch (error) {
      if (error?.code === 'AUTH_REQUIRED') clearSession();
      else console.warn('[ReviveRelay] Session restore failed', error?.code || error?.message || error);
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
      GM_setValue(KEYS.publicIdentity, state.identity);
      setStatus(`Connected as ${state.identity?.name || state.identity?.tornId || 'Torn player'}. Identity key discarded by server.`);
      await refreshActiveRequest();
    } catch (error) {
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
      setStatus('Revive request is active. Stage 3 payment/revive verification is not yet active.');
      await refreshActiveRequest();
    } catch (error) {
      setStatus(`Request failed: ${error?.code || 'REQUEST_FAILED'}`, true);
    }
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
      else console.warn('[ReviveRelay] Active request refresh failed', error?.code || error?.message || error);
    }
  }

  async function cancelActiveRequest() {
    if (!state.activeRequest?.id) return;
    try {
      await state.api.cancelRequest(state.activeRequest.id);
      setStatus('Revive request cancelled.');
      await refreshActiveRequest();
    } catch (error) {
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
    if (!box) return;
    if (!state.sessionToken) {
      box.innerHTML = '<div class="rr-muted">Connect to manage a revive request.</div>';
      return;
    }
    const request = state.activeRequest;
    if (!request) {
      box.innerHTML = '<div class="rr-muted">No active revive request.</div>';
      return;
    }
    const cancellable = ['AVAILABLE', 'WAITING_FOR_PAYMENT'].includes(request.state);
    box.innerHTML = `
      <div><strong>${escapeHtml(request.state || 'ACTIVE')}</strong></div>
      <div>${escapeHtml(request.paymentMethod || '')}: ${escapeHtml(request.offerAmount ?? '')}</div>
      <div class="rr-muted">Request ${escapeHtml(request.id || '')}</div>
      ${cancellable ? '<button id="rr-cancel-request" type="button">Cancel request</button>' : ''}
    `;
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

  function refreshPanel() {
    const values = {
      'rr-state': stateLabel(),
      'rr-identity': state.identity ? `${state.identity.name || 'Player'} [${state.identity.tornId || ''}]` : 'Not connected',
      'rr-open-chats': state.stats.openChats,
      'rr-list-items': state.stats.chatListItems,
      'rr-processed': state.stats.processed,
      'rr-candidates': state.stats.candidates,
      'rr-queued': state.stats.queued,
      'rr-submitted': state.stats.submitted,
      'rr-duplicates': state.stats.duplicates,
      'rr-dead': state.stats.deadLetters
    };
    for (const [id, value] of Object.entries(values)) {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    }
    const body = document.getElementById('rr-body');
    if (body) body.style.display = state.minimized ? 'none' : '';
    const minimize = document.getElementById('rr-minimize');
    if (minimize) minimize.textContent = state.minimized ? '+' : '−';
    const pause = document.getElementById('rr-pause');
    if (pause) pause.textContent = state.paused ? 'Resume collection' : 'Pause collection';
    const onboarding = document.getElementById('rr-onboarding');
    if (onboarding) onboarding.style.display = state.sessionToken ? 'none' : '';
    const requester = document.getElementById('rr-requester');
    if (requester) requester.style.display = state.sessionToken ? '' : 'none';
  }

  function createPanel() {
    GM_addStyle(`
      #rr-panel{position:fixed;right:16px;bottom:16px;z-index:1000000;width:390px;max-height:82vh;background:#171b20;color:#e7edf3;border:1px solid #3d4650;border-radius:8px;box-shadow:0 8px 28px #0008;font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #rr-header{display:flex;align-items:center;padding:8px 10px;background:#262c33;font-weight:700;gap:8px}#rr-header span{flex:1}
      #rr-body{padding:10px;max-height:calc(82vh - 38px);overflow:auto}.rr-grid{display:grid;grid-template-columns:1fr auto;gap:4px 8px;margin-bottom:10px}.rr-grid strong{text-align:right}
      #rr-panel input,#rr-panel textarea,#rr-panel select{width:100%;box-sizing:border-box;margin:3px 0 7px;padding:6px;background:#0f1317;color:#e7edf3;border:1px solid #47525e;border-radius:4px}#rr-panel input[type=radio]{width:auto;margin-right:4px}
      .rr-actions{display:flex;flex-wrap:wrap;gap:5px}.rr-actions button,#rr-panel button{background:#39434d;color:#fff;border:1px solid #566472;border-radius:4px;padding:5px 8px;cursor:pointer}.rr-actions button:hover,#rr-panel button:hover{filter:brightness(1.12)}
      #rr-status{margin-top:8px;color:#9bd5a5;word-break:break-word}#rr-status.error{color:#ff9d9d}.rr-muted{color:#aeb7c0;font-size:10px}.rr-warning{color:#e6c46b;font-size:10px;margin:6px 0}.rr-section{border-top:1px solid #333b44;padding-top:9px;margin-top:9px}.rr-section h4{margin:0 0 6px}.rr-live-row{border-top:1px solid #2b3239;padding:5px 0;word-break:break-word}
    `);

    const panel = document.createElement('div');
    panel.id = 'rr-panel';
    panel.innerHTML = `
      <div id="rr-header"><span>ReviveRelay v${VERSION}</span><button id="rr-minimize" type="button">−</button></div>
      <div id="rr-body">
        <div class="rr-grid">
          <span>Collection</span><strong id="rr-state">STARTING</strong>
          <span>Identity</span><strong id="rr-identity">Not connected</strong>
          <span>Public chats loaded</span><strong id="rr-open-chats">0</strong>
          <span>Public list items</span><strong id="rr-list-items">0</strong>
          <span>Processed locally</span><strong id="rr-processed">0</strong>
          <span>Revive candidates</span><strong id="rr-candidates">0</strong>
          <span>Queue</span><strong id="rr-queued">0</strong>
          <span>Submitted</span><strong id="rr-submitted">0</strong>
          <span>Duplicate</span><strong id="rr-duplicates">0</strong>
          <span>Dead-letter</span><strong id="rr-dead">0</strong>
        </div>

        <div id="rr-onboarding" class="rr-section">
          <h4>Connect ReviveRelay</h4>
          <div class="rr-muted">Your Torn key is sent over HTTPS only for identity verification. The identity key is not stored by ReviveRelay.</div>
          <label for="rr-api-key">Minimally scoped Torn API key</label>
          <input id="rr-api-key" type="password" autocomplete="off" placeholder="Paste key for one-time identity verification">
          <button id="rr-connect" type="button">Verify &amp; connect</button>
        </div>

        <div id="rr-requester" class="rr-section" style="display:none">
          <h4>Request Revive</h4>
          <label><input type="radio" name="rr-payment-method" value="cash" checked>Cash</label>
          <label><input type="radio" name="rr-payment-method" value="xanax">Xanax</label>
          <input id="rr-offer-amount" type="number" min="1" step="1" value="500000">
          <div class="rr-muted">Cash minimum $500,000. Minimum 1 Xanax. Whole numbers only.</div>
          <label for="rr-comment">Comment for reviver (optional)</label>
          <textarea id="rr-comment" maxlength="500" rows="2" placeholder="Up to 500 characters"></textarea>
          <button id="rr-request" type="button">Request Revive</button>
          <div class="rr-warning">Stage 3 protected payment, revive-attempt and refund verification is not yet active.</div>
          <div id="rr-active-request"></div>
        </div>

        <div class="rr-section">
          <h4>Live Capture</h4>
          <div class="rr-muted">Local processing monitor only. Non-candidate public messages are not uploaded.</div>
          <select id="rr-live-filter">
            <option value="all">All local events</option>
            <option value="candidates">Likely revive requests</option>
            <option value="global">Global</option>
            <option value="trade">Trade</option>
            <option value="hospital">Hospital</option>
            <option value="jail">Jail</option>
            <option value="travel">Travel</option>
          </select>
          <div id="rr-live-events"><div class="rr-muted">No local events yet.</div></div>
        </div>

        <div class="rr-section rr-actions">
          <button id="rr-pause" type="button">Pause collection</button>
          <button id="rr-rescan" type="button">Rescan public chats</button>
          <button id="rr-refresh-request" type="button">Refresh request</button>
          <button id="rr-disconnect" type="button">Disconnect</button>
        </div>
        <div class="rr-warning">Only explicitly allowlisted public Torn chats are processed. Faction, Company, private/group-private, competition, poker and unknown chats are rejected before parsing.</div>
        <div id="rr-status">Starting...</div>
      </div>`;
    document.body.appendChild(panel);

    const apiKeyInput = document.getElementById('rr-api-key');
    document.getElementById('rr-connect').onclick = connectIdentity;
    document.getElementById('rr-request').onclick = submitReviveRequest;
    document.getElementById('rr-refresh-request').onclick = refreshActiveRequest;
    document.getElementById('rr-disconnect').onclick = () => {
      clearSession();
      apiKeyInput.value = '';
      setStatus('Disconnected locally.');
    };
    document.getElementById('rr-minimize').onclick = () => {
      state.minimized = !state.minimized;
      GM_setValue(KEYS.minimized, state.minimized);
      refreshPanel();
    };
    document.getElementById('rr-pause').onclick = () => {
      markInteraction();
      state.paused = !state.paused;
      GM_setValue(KEYS.paused, state.paused);
      if (!state.paused) discoverChats();
      refreshPanel();
    };
    document.getElementById('rr-rescan').onclick = () => {
      markInteraction();
      const contexts = discoverChats();
      setStatus(`Rescan found ${contexts.length} eligible public chat(s).`);
    };
    const filter = document.getElementById('rr-live-filter');
    filter.value = String(GM_getValue(KEYS.liveFilter, 'all') || 'all');
    filter.onchange = () => {
      GM_setValue(KEYS.liveFilter, filter.value);
      renderLiveCapture();
    };
    for (const radio of document.querySelectorAll('input[name="rr-payment-method"]')) {
      radio.onchange = () => {
        const amount = document.getElementById('rr-offer-amount');
        if (radio.checked) amount.value = radio.value === 'cash' ? '500000' : '1';
      };
    }
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
    });
    window.addEventListener('blur', refreshPanel);
    document.addEventListener('visibilitychange', () => {
      refreshPanel();
      if (document.visibilityState === 'visible') {
        queueDiscoveryAndScan();
        drainCandidateOutbox();
      }
    });
  }

  async function init() {
    if (!Core || !ChatDom || !PublicChannels || !ClientChatPolicy ||
        !ReviveRelayApiClient || !ReviveRelayCandidatePipeline) {
      console.error('[ReviveRelay] Required dependency unavailable.');
      return;
    }

    try {
      const request = ReviveRelayApiClient.createGmRequestAdapter(GM_xmlhttpRequest);
      state.api = ReviveRelayApiClient.createApiClient({
        baseUrl: API_BASE_URL,
        getToken: () => String(GM_getValue(KEYS.sessionToken, '') || ''),
        request
      });
      createPanel();
      installInteractionListeners();
      if (visibleAndFocused()) state.lastInteractionAt = Date.now();
      installRootObserver();
      discoverChats();
      await restoreSession();
      await drainCandidateOutbox();
      setStatus(state.sessionToken ? 'ReviveRelay connected.' : 'ReviveRelay ready. Connect to submit candidates or request a revive.');
      refreshPanel();
    } catch (error) {
      console.error('[ReviveRelay] Initialization failed', error);
      if (!document.getElementById('rr-panel')) createPanel();
      setStatus(`Initialization failed: ${error.message}`, true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
