// ==UserScript==
// @name         Torn Revive Chat Collector
// @namespace    r4g3runn3r.torn.revive.collector
// @version      0.1.1
// @description  Collects visible Torn Chat 2.0 messages for revive-language research and optionally syncs them to Google Sheets.
// @author       R4G3RUNN3R
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @require      https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/main/src/core.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.__TRCC_ACTIVE__) return;
  window.__TRCC_ACTIVE__ = true;

  const Core = globalThis.TornReviveCore;
  const VERSION = '0.1.1';
  const DB_NAME = 'tornReviveChatCollector';
  const STORE = 'messages';
  const BATCH_SIZE = 25;
  const SYNC_EVERY_MS = 15000;
  const MESSAGE_SELECTOR = '[class*="chat-box-message___"]';

  const KEYS = {
    endpoint: 'trcc_sheet_endpoint',
    token: 'trcc_sheet_token',
    paused: 'trcc_paused',
    minimized: 'trcc_minimized'
  };

  const state = {
    db: null,
    observer: null,
    observedRoot: null,
    rootWatcher: null,
    seenNodes: new WeakSet(),
    paused: Boolean(GM_getValue(KEYS.paused, false)),
    minimized: Boolean(GM_getValue(KEYS.minimized, false)),
    syncing: false,
    stats: { total: 0, unsynced: 0, conversations: 0, lastCaptured: '' }
  };

  const norm = (value) => Core.normalizeText(value);
  const captureAllowed = () => !state.paused && document.visibilityState === 'visible' && document.hasFocus();

  function userIdFromHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.origin);
      const id = url.searchParams.get('XID') || url.searchParams.get('ID') || url.searchParams.get('userId');
      if (id && /^\d+$/.test(id)) return id;
    } catch (_) {}
    return String(href).match(/(?:XID|ID|userId)=(\d+)/i)?.[1] || '';
  }

  function findChatBox(node) {
    return node.closest('[class*="group-chat-box__chat-box-wrapper___"], [class*="group-chat-box___"]') || node.parentElement;
  }

  function getConversationName(box) {
    if (!box) return 'Unknown';
    const selectors = [
      '[class*="chat-box-header__info___"]',
      '[class*="chat-box-header___"]',
      '[aria-label]'
    ];
    for (const selector of selectors) {
      const element = box.querySelector(selector);
      const text = norm(element?.textContent || element?.getAttribute?.('aria-label'));
      if (text && text.length <= 100) return text;
    }
    for (const attr of ['data-name', 'data-title', 'title', 'aria-label']) {
      const text = norm(box.getAttribute?.(attr));
      if (text && text.length <= 100) return text;
    }
    return 'Unknown';
  }

  function getConversationId(box, name) {
    return norm(
      box?.getAttribute?.('data-conversation-id') ||
      box?.getAttribute?.('data-channel-id') ||
      box?.getAttribute?.('data-chat-id') ||
      box?.id
    ) || `name:${name.toLowerCase()}`;
  }

  function getSender(node) {
    const senderEl = node.querySelector('[class*="chat-box-message__sender___"]');
    const link = senderEl?.closest?.('a[href]') || senderEl?.querySelector?.('a[href]') || node.querySelector('a[href*="XID="]');
    let senderName = norm(senderEl?.textContent || link?.textContent);
    senderName = senderName.replace(/:\s*$/, '');
    if (senderName.length > 80) senderName = senderName.slice(0, 80);
    return { senderName, senderId: userIdFromHref(link?.href || '') };
  }

  function getMessageText(node) {
    const element = node.querySelector('[class*="chat-box-message__message___"]');
    if (element) return String(element.textContent || '').trim();

    const clone = node.cloneNode(true);
    clone.querySelectorAll('time,button,svg,[class*="chat-box-message__sender___"],[class*="chat-box-message__avatar___"],[class*="timestamp___"]').forEach((el) => el.remove());
    return String(clone.textContent || '').trim();
  }

  function getTimestamp(node) {
    const time = node.querySelector('time');
    const candidates = [
      time?.dateTime,
      time?.getAttribute?.('datetime'),
      time?.title,
      node.getAttribute?.('data-timestamp'),
      node.getAttribute?.('data-time')
    ];
    for (const candidate of candidates) {
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

  function parseMessage(node) {
    const text = getMessageText(node);
    if (!norm(text)) return null;

    const box = findChatBox(node);
    const conversationName = getConversationName(box);
    const conversationId = getConversationId(box, conversationName);
    const sender = getSender(node);
    const capturedAt = new Date().toISOString();

    const record = {
      conversationId,
      conversationName,
      conversationType: Core.inferConversationType(conversationName),
      abroadLocation: Core.inferAbroadLocation(conversationName),
      senderId: sender.senderId,
      senderName: sender.senderName,
      text,
      messageTimestamp: getTimestamp(node),
      capturedAt,
      pageUrl: location.href,
      sourceMessageId: getSourceMessageId(node),
      synced: false
    };
    record.fingerprint = Core.fingerprintMessage(record);
    return record;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'fingerprint' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB failed to open'));
    });
  }

  function dbRequest(mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  async function save(record) {
    try {
      await dbRequest('readwrite', (store) => store.add(record));
      state.stats.total += 1;
      state.stats.unsynced += 1;
      state.stats.lastCaptured = record.capturedAt;
      refreshPanel();
    } catch (error) {
      if (error?.name !== 'ConstraintError') console.warn('[TRCC] Save failed', error);
    }
  }

  async function scan(root) {
    if (!captureAllowed() || !root) return;
    const nodes = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(MESSAGE_SELECTOR)) nodes.push(root);
    if (root.querySelectorAll) nodes.push(...root.querySelectorAll(MESSAGE_SELECTOR));

    for (const node of nodes) {
      if (state.seenNodes.has(node)) continue;
      state.seenNodes.add(node);
      const record = parseMessage(node);
      if (record) await save(record);
    }
  }

  function attachChatObserver() {
    const root = document.querySelector('#chatRoot');
    if (!root || root === state.observedRoot) return;

    state.observer?.disconnect();
    state.observedRoot = root;
    state.observer = new MutationObserver((mutations) => {
      if (!captureAllowed()) return;
      for (const mutation of mutations) for (const node of mutation.addedNodes) scan(node);
    });
    state.observer.observe(root, { childList: true, subtree: true });
    scan(root);
    setStatus('Chat observer attached');
  }

  function watchForChatRoot() {
    attachChatObserver();
    state.rootWatcher = new MutationObserver(attachChatObserver);
    state.rootWatcher.observe(document.body, { childList: true, subtree: true });
  }

  async function allMessages() {
    return dbRequest('readonly', (store) => store.getAll());
  }

  async function updateStats() {
    const rows = await allMessages();
    state.stats.total = rows.length;
    state.stats.unsynced = rows.filter((row) => !row.synced).length;
    state.stats.conversations = new Set(rows.map((row) => row.conversationId)).size;
    state.stats.lastCaptured = rows.reduce((latest, row) => row.capturedAt > latest ? row.capturedAt : latest, '');
    refreshPanel();
  }

  async function markSynced(fingerprints) {
    for (const fingerprint of fingerprints) {
      const row = await dbRequest('readonly', (store) => store.get(fingerprint));
      if (!row) continue;
      row.synced = true;
      await dbRequest('readwrite', (store) => store.put(row));
    }
    await updateStats();
  }

  function postJson(url, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
        timeout: 20000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) return reject(new Error(`HTTP ${response.status}`));
          try { resolve(JSON.parse(response.responseText || '{}')); }
          catch (_) { resolve({ ok: true }); }
        },
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Request timed out'))
      });
    });
  }

  async function sync() {
    if (state.syncing) return;
    const endpoint = norm(GM_getValue(KEYS.endpoint, ''));
    if (!endpoint) return;

    const rows = (await allMessages())
      .filter((row) => !row.synced)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .slice(0, BATCH_SIZE);
    if (!rows.length) return;

    state.syncing = true;
    try {
      setStatus(`Syncing ${rows.length}...`);
      const response = await postJson(endpoint, {
        version: VERSION,
        token: String(GM_getValue(KEYS.token, '') || ''),
        records: rows.map(Core.buildSheetRecord)
      });
      if (response?.ok === false) throw new Error(response.error || 'Rejected by endpoint');
      await markSynced(rows.map((row) => row.fingerprint));
      setStatus(`Synced ${rows.length}`);
    } catch (error) {
      console.warn('[TRCC] Sync failed', error);
      setStatus(`Sync failed: ${error.message}`, true);
    } finally {
      state.syncing = false;
    }
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  async function exportRows(kind) {
    const rows = (await allMessages()).map(Core.buildSheetRecord);
    const headers = rows.length ? Object.keys(rows[0]) : ['date','time','chat','chatType','abroadLocation','player','playerId','message','fingerprint'];
    const content = kind === 'csv'
      ? [headers.join(','), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','))].join('\n')
      : JSON.stringify(rows, null, 2);
    const blob = new Blob([content], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `torn-chat-research-${new Date().toISOString().slice(0,10)}.${kind}`;
    document.body.appendChild(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
  }

  async function clearLocalData() {
    await dbRequest('readwrite', (store) => store.clear());
    await updateStats();
  }

  function setStatus(text, error = false) {
    const el = document.getElementById('trcc-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', error);
  }

  function refreshPanel() {
    const values = {
      'trcc-state': state.paused ? 'PAUSED' : (captureAllowed() ? 'CAPTURING' : 'WAITING FOR FOCUS'),
      'trcc-total': state.stats.total,
      'trcc-unsynced': state.stats.unsynced,
      'trcc-conversations': state.stats.conversations,
      'trcc-last': state.stats.lastCaptured ? new Date(state.stats.lastCaptured).toLocaleTimeString() : '—'
    };
    for (const [id, value] of Object.entries(values)) {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    }
    const body = document.getElementById('trcc-body');
    if (body) body.style.display = state.minimized ? 'none' : '';
    const minimize = document.getElementById('trcc-minimize');
    if (minimize) minimize.textContent = state.minimized ? '+' : '−';
    const pause = document.getElementById('trcc-pause');
    if (pause) pause.textContent = state.paused ? 'Resume' : 'Pause';
  }

  function createPanel() {
    GM_addStyle(`
      #trcc-panel{position:fixed;right:16px;bottom:16px;z-index:1000000;width:330px;background:#171b20;color:#e7edf3;border:1px solid #3d4650;border-radius:8px;box-shadow:0 8px 28px #0008;font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #trcc-header{display:flex;align-items:center;padding:8px 10px;background:#262c33;font-weight:700;gap:8px}#trcc-header span{flex:1}
      #trcc-body{padding:10px}.trcc-grid{display:grid;grid-template-columns:1fr auto;gap:4px 8px;margin-bottom:10px}.trcc-grid strong{text-align:right}
      #trcc-panel input{width:100%;box-sizing:border-box;margin:3px 0 7px;padding:6px;background:#0f1317;color:#e7edf3;border:1px solid #47525e;border-radius:4px}
      .trcc-actions{display:flex;flex-wrap:wrap;gap:5px}.trcc-actions button,#trcc-minimize{background:#39434d;color:#fff;border:1px solid #566472;border-radius:4px;padding:5px 8px;cursor:pointer}.trcc-actions button:hover,#trcc-minimize:hover{filter:brightness(1.12)}
      #trcc-status{margin-top:8px;color:#9bd5a5;word-break:break-word}#trcc-status.error{color:#ff9d9d}.trcc-note{color:#aeb7c0;font-size:10px;margin:6px 0 9px}
    `);

    const panel = document.createElement('div');
    panel.id = 'trcc-panel';
    panel.innerHTML = `
      <div id="trcc-header"><span>Revive Research Collector v${VERSION}</span><button id="trcc-minimize" type="button">−</button></div>
      <div id="trcc-body">
        <div class="trcc-grid">
          <span>State</span><strong id="trcc-state">STARTING</strong>
          <span>Messages</span><strong id="trcc-total">0</strong>
          <span>Unsynced</span><strong id="trcc-unsynced">0</strong>
          <span>Conversations</span><strong id="trcc-conversations">0</strong>
          <span>Last captured</span><strong id="trcc-last">—</strong>
        </div>
        <label>Google Apps Script Web App URL</label>
        <input id="trcc-endpoint" type="url" placeholder="https://script.google.com/macros/s/.../exec">
        <label>Collector token (optional)</label>
        <input id="trcc-token" type="password" placeholder="Stored locally only">
        <div class="trcc-note">Collects messages rendered in Torn Chat 2.0 while this Torn tab is visible and focused. It does not read Torn's chat transport directly.</div>
        <div class="trcc-actions">
          <button id="trcc-pause" type="button">Pause</button>
          <button id="trcc-save" type="button">Save settings</button>
          <button id="trcc-sync" type="button">Sync now</button>
          <button id="trcc-json" type="button">Export JSON</button>
          <button id="trcc-csv" type="button">Export CSV</button>
          <button id="trcc-clear" type="button">Clear data</button>
        </div>
        <div id="trcc-status">Ready</div>
      </div>`;
    document.body.appendChild(panel);

    const endpoint = document.getElementById('trcc-endpoint');
    const token = document.getElementById('trcc-token');
    endpoint.value = GM_getValue(KEYS.endpoint, '') || '';
    token.value = GM_getValue(KEYS.token, '') || '';

    document.getElementById('trcc-minimize').onclick = () => {
      state.minimized = !state.minimized;
      GM_setValue(KEYS.minimized, state.minimized);
      refreshPanel();
    };
    document.getElementById('trcc-pause').onclick = () => {
      state.paused = !state.paused;
      GM_setValue(KEYS.paused, state.paused);
      refreshPanel();
      if (!state.paused && state.observedRoot) scan(state.observedRoot);
    };
    document.getElementById('trcc-save').onclick = () => {
      GM_setValue(KEYS.endpoint, endpoint.value.trim());
      GM_setValue(KEYS.token, token.value);
      setStatus('Settings saved locally');
    };
    document.getElementById('trcc-sync').onclick = sync;
    document.getElementById('trcc-json').onclick = () => exportRows('json');
    document.getElementById('trcc-csv').onclick = () => exportRows('csv');
    document.getElementById('trcc-clear').onclick = async () => {
      if (confirm('Delete all locally collected chat data?')) {
        await clearLocalData();
        setStatus('Local data cleared');
      }
    };
    refreshPanel();
  }

  function installLifecycleListeners() {
    window.addEventListener('focus', () => {
      refreshPanel();
      if (state.observedRoot) scan(state.observedRoot);
    });
    window.addEventListener('blur', refreshPanel);
    document.addEventListener('visibilitychange', () => {
      refreshPanel();
      if (document.visibilityState === 'visible' && state.observedRoot) scan(state.observedRoot);
    });
  }

  async function init() {
    if (!Core) return console.error('[TRCC] Core dependency unavailable.');
    try {
      state.db = await openDb();
      createPanel();
      await updateStats();
      watchForChatRoot();
      installLifecycleListeners();
      setInterval(() => {
        if (!state.paused && document.visibilityState === 'visible') sync();
      }, SYNC_EVERY_MS);
      setStatus('Collector ready');
    } catch (error) {
      console.error('[TRCC] Initialization failed', error);
      if (!document.getElementById('trcc-panel')) createPanel();
      setStatus(`Initialization failed: ${error.message}`, true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
