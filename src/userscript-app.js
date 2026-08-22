(function () {
  'use strict';

  if (window.__TORN_REVIVE_CHAT_COLLECTOR__) return;
  window.__TORN_REVIVE_CHAT_COLLECTOR__ = true;

  const Core = globalThis.TornReviveCore;
  if (!Core) {
    console.error('[TRCC] Core library missing.');
    return;
  }

  const SCRIPT_VERSION = '0.1.0';
  const DB_NAME = 'tornReviveChatCollector';
  const DB_VERSION = 1;
  const STORE_MESSAGES = 'messages';
  const SETTINGS = {
    endpoint: 'trcc_sheet_endpoint',
    token: 'trcc_sheet_token',
    paused: 'trcc_paused',
    minimized: 'trcc_minimized'
  };
  const BATCH_SIZE = 25;
  const AUTO_SYNC_MS = 15000;

  const SELECTORS = {
    chatRoot: '#chatRoot',
    chatBox: [
      '#chatRoot [class*="group-chat-box___"]',
      '#chatRoot [class*="chat-box___"]'
    ].join(','),
    message: [
      '[class*="chat-box-message___"]',
      '[class*="chatBoxMessage___"]'
    ].join(','),
    sender: [
      '[class*="message-sender___"]',
      '[class*="sender___"]',
      'a[href*="profiles.php?XID="]',
      'a[href*="XID="]'
    ].join(','),
    messageText: [
      '[class*="message-content___"]',
      '[class*="messageContent___"]',
      '[class*="chat-message-text___"]',
      '[class*="message-text___"]'
    ].join(','),
    title: [
      '[class*="chat-box-header___"] [class*="title___"]',
      '[class*="chatBoxHeader___"] [class*="title___"]',
      '[class*="chat-box-title___"]',
      '[class*="header___"] [class*="name___"]'
    ].join(',')
  };

  const state = {
    db: null,
    paused: Boolean(GM_getValue(SETTINGS.paused, false)),
    minimized: Boolean(GM_getValue(SETTINGS.minimized, false)),
    observer: null,
    syncTimer: null,
    scanning: false,
    seenNodes: new WeakSet(),
    stats: { total: 0, unsynced: 0, conversations: new Set(), lastCaptured: '' }
  };

  function log(...args) {
    console.log('[TRCC]', ...args);
  }

  function isCaptureAllowed() {
    return !state.paused && document.visibilityState === 'visible' && document.hasFocus();
  }

  function extractUserIdFromHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.origin);
      const direct = url.searchParams.get('XID') || url.searchParams.get('ID') || url.searchParams.get('userId');
      if (direct && /^\d+$/.test(direct)) return direct;
    } catch (_) {}
    const match = String(href).match(/(?:XID|ID|userId)=(\d+)/i);
    return match ? match[1] : '';
  }

  function findChatBox(messageNode) {
    return messageNode.closest('[class*="group-chat-box___"], [class*="chat-box___"], [class*="chatBox___"]') ||
      messageNode.closest('[class*="conversation___"]') ||
      messageNode.parentElement;
  }

  function getConversationName(chatBox) {
    if (!chatBox) return 'Unknown';

    const explicit = chatBox.querySelector(SELECTORS.title);
    const explicitText = Core.normalizeText(explicit?.textContent);
    if (explicitText && explicitText.length <= 80) return explicitText;

    const attrs = [
      chatBox.getAttribute('aria-label'),
      chatBox.getAttribute('data-name'),
      chatBox.getAttribute('data-title'),
      chatBox.getAttribute('title')
    ].map(Core.normalizeText).filter(Boolean);
    if (attrs.length) return attrs[0];

    const heading = chatBox.querySelector('h1,h2,h3,h4,[role="heading"]');
    const headingText = Core.normalizeText(heading?.textContent);
    if (headingText && headingText.length <= 80) return headingText;

    return 'Unknown';
  }

  function getConversationId(chatBox, name) {
    const candidates = [
      chatBox?.id,
      chatBox?.getAttribute('data-chat-id'),
      chatBox?.getAttribute('data-channel-id'),
      chatBox?.getAttribute('data-conversation-id')
    ].map(Core.normalizeText).filter(Boolean);
    return candidates[0] || `name:${name.toLowerCase()}`;
  }

  function getSender(messageNode) {
    const senderEl = messageNode.querySelector(SELECTORS.sender);
    const link = senderEl?.closest?.('a[href]') || senderEl?.querySelector?.('a[href]') || messageNode.querySelector('a[href*="XID="]');
    const senderId = extractUserIdFromHref(link?.href || '');

    let senderName = Core.normalizeText(senderEl?.textContent || link?.textContent || '');
    if (senderName.length > 80) senderName = senderName.slice(0, 80);

    return { senderId, senderName };
  }

  function getMessageText(messageNode) {
    const direct = messageNode.querySelector(SELECTORS.messageText);
    if (direct) return String(direct.textContent || '').trim();

    const clone = messageNode.cloneNode(true);
    clone.querySelectorAll([
      SELECTORS.sender,
      'time',
      '[class*="timestamp___"]',
      '[class*="time___"]',
      'button',
      'svg'
    ].join(',')).forEach((node) => node.remove());

    return String(clone.textContent || '').trim();
  }

  function parseDateLike(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  function getMessageTimestamp(messageNode) {
    const time = messageNode.querySelector('time');
    const candidates = [
      time?.dateTime,
      time?.getAttribute('datetime'),
      time?.title,
      messageNode.getAttribute('data-timestamp'),
      messageNode.getAttribute('data-time')
    ];

    for (const candidate of candidates) {
      const parsed = parseDateLike(candidate);
      if (parsed) return parsed;
    }
    return '';
  }

  function getSourceMessageId(messageNode) {
    return Core.normalizeText(
      messageNode.id ||
      messageNode.getAttribute('data-message-id') ||
      messageNode.getAttribute('data-messageid') ||
      messageNode.getAttribute('data-id') ||
      ''
    );
  }

  function parseMessageNode(messageNode) {
    const text = getMessageText(messageNode);
    if (!Core.normalizeText(text)) return null;

    const chatBox = findChatBox(messageNode);
    const conversationName = getConversationName(chatBox);
    const conversationType = Core.inferConversationType(conversationName);
    const conversationId = getConversationId(chatBox, conversationName);
    const { senderId, senderName } = getSender(messageNode);
    const capturedAt = new Date().toISOString();

    const raw = {
      conversationId,
      conversationName,
      conversationType,
      abroadLocation: Core.inferAbroadLocation(conversationName),
      senderId,
      senderName,
      text,
      messageTimestamp: getMessageTimestamp(messageNode),
      capturedAt,
      pageUrl: location.href,
      sourceMessageId: getSourceMessageId(messageNode),
      synced: false
    };

    raw.fingerprint = Core.fingerprintMessage(raw);
    return raw;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          const store = db.createObjectStore(STORE_MESSAGES, { keyPath: 'fingerprint' });
          store.createIndex('synced', 'synced', { unique: false });
          store.createIndex('capturedAt', 'capturedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    });
  }

  function idbRequest(mode, operation) {
    return new Promise((resolve, reject) => {
      try {
        const tx = state.db.transaction(STORE_MESSAGES, mode);
        const store = tx.objectStore(STORE_MESSAGES);
        const req = operation(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
      } catch (error) {
        reject(error);
      }
    });
  }

  async function saveMessage(raw) {
    try {
      await idbRequest('readwrite', (store) => store.add(raw));
      state.stats.total += 1;
      state.stats.unsynced += 1;
      state.stats.conversations.add(raw.conversationId);
      state.stats.lastCaptured = raw.capturedAt;
      updatePanel();
      return true;
    } catch (error) {
      if (error?.name === 'ConstraintError') return false;
      console.warn('[TRCC] Failed to save message', error);
      return false;
    }
  }

  async function scanNode(root) {
    if (!isCaptureAllowed() || !root) return;

    const candidates = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(SELECTORS.message)) candidates.push(root);
    if (root.querySelectorAll) candidates.push(...root.querySelectorAll(SELECTORS.message));

    for (const node of candidates) {
      if (state.seenNodes.has(node)) continue;
      state.seenNodes.add(node);
      const parsed = parseMessageNode(node);
      if (!parsed) continue;
      await saveMessage(parsed);
    }
  }

  async function scanAllVisibleChats() {
    if (state.scanning || !isCaptureAllowed()) return;
    state.scanning = true;
    try {
      const root = document.querySelector(SELECTORS.chatRoot);
      if (root) await scanNode(root);
    } finally {
      state.scanning = false;
    }
  }

  function installObserver() {
    const root = document.querySelector(SELECTORS.chatRoot) || document.body;
    state.observer?.disconnect();
    state.observer = new MutationObserver((mutations) => {
      if (!isCaptureAllowed()) return;
      for (const mutation of mutations) {
        for (const added of mutation.addedNodes) {
          scanNode(added);
        }
      }
    });
    state.observer.observe(root, { childList: true, subtree: true });
  }

  async function getAllMessages() {
    return idbRequest('readonly', (store) => store.getAll());
  }

  async function getUnsyncedMessages(limit = BATCH_SIZE) {
    const all = await getAllMessages();
    return all.filter((row) => !row.synced).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).slice(0, limit);
  }

  async function markSynced(fingerprints) {
    if (!fingerprints.length) return;
    const tx = state.db.transaction(STORE_MESSAGES, 'readwrite');
    const store = tx.objectStore(STORE_MESSAGES);
    await Promise.all(fingerprints.map((fingerprint) => new Promise((resolve) => {
      const getReq = store.get(fingerprint);
      getReq.onsuccess = () => {
        const row = getReq.result;
        if (!row) return resolve();
        row.synced = true;
        const putReq = store.put(row);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => resolve();
      };
      getReq.onerror = () => resolve();
    })));
    state.stats.unsynced = Math.max(0, state.stats.unsynced - fingerprints.length);
    updatePanel();
  }

  function gmPostJson(url, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
        timeout: 20000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`Sheet endpoint returned HTTP ${response.status}`));
            return;
          }
          try {
            resolve(JSON.parse(response.responseText || '{}'));
          } catch (_) {
            resolve({ ok: true });
          }
        },
        onerror: () => reject(new Error('Sheet endpoint request failed')),
        ontimeout: () => reject(new Error('Sheet endpoint request timed out'))
      });
    });
  }

  async function syncNow() {
    const endpoint = Core.normalizeText(GM_getValue(SETTINGS.endpoint, ''));
    if (!endpoint) {
      setStatus('Sheet endpoint not configured', true);
      return;
    }

    const rows = await getUnsyncedMessages();
    if (!rows.length) {
      setStatus('Nothing to sync');
      return;
    }

    const payload = {
      version: SCRIPT_VERSION,
      token: String(GM_getValue(SETTINGS.token, '') || ''),
      records: rows.map(Core.buildSheetRecord)
    };

    try {
      setStatus(`Syncing ${rows.length} messages...`);
      const response = await gmPostJson(endpoint, payload);
      if (response && response.ok === false) throw new Error(response.error || 'Sheet endpoint rejected batch');
      await markSynced(rows.map((row) => row.fingerprint));
      setStatus(`Synced ${rows.length} messages`);
    } catch (error) {
      console.warn('[TRCC] Sync failed', error);
      setStatus(`Sync failed: ${error.message}`, true);
    }
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  async function exportData(kind) {
    const rows = (await getAllMessages()).map(Core.buildSheetRecord);
    let content;
    let mime;
    let extension;

    if (kind === 'csv') {
      const headers = rows.length ? Object.keys(rows[0]) : ['date','time','chat','chatType','abroadLocation','player','playerId','message','fingerprint'];
      content = [headers.join(','), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','))].join('\n');
      mime = 'text/csv;charset=utf-8';
      extension = 'csv';
    } else {
      content = JSON.stringify(rows, null, 2);
      mime = 'application/json;charset=utf-8';
      extension = 'json';
    }

    const blob = new Blob([content], { type: mime });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `torn-chat-research-${new Date().toISOString().slice(0, 10)}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  async function clearDatabase() {
    await idbRequest('readwrite', (store) => store.clear());
    state.stats.total = 0;
    state.stats.unsynced = 0;
    state.stats.conversations = new Set();
    state.stats.lastCaptured = '';
    updatePanel();
  }

  async function refreshStats() {
    const all = await getAllMessages();
    state.stats.total = all.length;
    state.stats.unsynced = all.filter((row) => !row.synced).length;
    state.stats.conversations = new Set(all.map((row) => row.conversationId));
    state.stats.lastCaptured = all.reduce((latest, row) => row.capturedAt > latest ? row.capturedAt : latest, '');
    updatePanel();
  }

  function setStatus(message, isError = false) {
    const el = document.getElementById('trcc-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
  }

  function updatePanel() {
    const values = {
      'trcc-capture-state': state.paused ? 'PAUSED' : (isCaptureAllowed() ? 'CAPTURING' : 'WAITING FOR FOCUS'),
      'trcc-total': String(state.stats.total),
      'trcc-unsynced': String(state.stats.unsynced),
      'trcc-conversations': String(state.stats.conversations.size),
      'trcc-last': state.stats.lastCaptured ? new Date(state.stats.lastCaptured).toLocaleTimeString() : '—'
    };
    Object.entries(values).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });

    const body = document.getElementById('trcc-body');
    const toggle = document.getElementById('trcc-minimize');
    if (body) body.style.display = state.minimized ? 'none' : '';
    if (toggle) toggle.textContent = state.minimized ? '+' : '−';
  }

  function createPanel() {
    if (document.getElementById('trcc-panel')) return;

    GM_addStyle(`
      #trcc-panel{position:fixed;right:16px;bottom:16px;z-index:1000000;width:330px;background:#171b20;color:#e7edf3;border:1px solid #3d4650;border-radius:8px;box-shadow:0 8px 28px #0008;font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #trcc-header{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#262c33;font-weight:700}
      #trcc-header span:first-child{flex:1} #trcc-minimize{width:26px;height:24px}
      #trcc-body{padding:10px}.trcc-grid{display:grid;grid-template-columns:1fr auto;gap:4px 8px;margin-bottom:10px}.trcc-grid strong{text-align:right}
      #trcc-panel input{width:100%;box-sizing:border-box;margin:3px 0 7px;padding:6px;background:#0f1317;color:#e7edf3;border:1px solid #47525e;border-radius:4px}
      .trcc-actions{display:flex;flex-wrap:wrap;gap:5px}.trcc-actions button,#trcc-minimize{background:#39434d;color:#fff;border:1px solid #566472;border-radius:4px;padding:5px 8px;cursor:pointer}
      .trcc-actions button:hover,#trcc-minimize:hover{filter:brightness(1.12)}
      #trcc-status{margin-top:8px;color:#9bd5a5;word-break:break-word}#trcc-status.error{color:#ff9d9d}
      .trcc-note{color:#aeb7c0;font-size:10px;margin:6px 0 9px}
    `);

    const panel = document.createElement('div');
    panel.id = 'trcc-panel';
    panel.innerHTML = `
      <div id="trcc-header"><span>Revive Research Collector v${SCRIPT_VERSION}</span><button id="trcc-minimize" type="button">−</button></div>
      <div id="trcc-body">
        <div class="trcc-grid">
          <span>State</span><strong id="trcc-capture-state">STARTING</strong>
          <span>Messages</span><strong id="trcc-total">0</strong>
          <span>Unsynced</span><strong id="trcc-unsynced">0</strong>
          <span>Conversations</span><strong id="trcc-conversations">0</strong>
          <span>Last captured</span><strong id="trcc-last">—</strong>
        </div>
        <label>Google Apps Script Web App URL</label>
        <input id="trcc-endpoint" type="url" placeholder="https://script.google.com/macros/s/.../exec">
        <label>Collector token (optional)</label>
        <input id="trcc-token" type="password" placeholder="Stored locally only">
        <div class="trcc-note">Captures visible Torn Chat 2.0 messages only while this Torn tab is visible and focused. Credentials never enter the repository.</div>
        <div class="trcc-actions">
          <button id="trcc-pause" type="button">Pause</button>
          <button id="trcc-save-settings" type="button">Save settings</button>
          <button id="trcc-sync" type="button">Sync now</button>
          <button id="trcc-export-json" type="button">Export JSON</button>
          <button id="trcc-export-csv" type="button">Export CSV</button>
          <button id="trcc-clear" type="button">Clear data</button>
        </div>
        <div id="trcc-status">Ready</div>
      </div>`;
    document.body.appendChild(panel);

    const endpoint = document.getElementById('trcc-endpoint');
    const token = document.getElementById('trcc-token');
    endpoint.value = GM_getValue(SETTINGS.endpoint, '') || '';
    token.value = GM_getValue(SETTINGS.token, '') || '';

    document.getElementById('trcc-minimize').addEventListener('click', () => {
      state.minimized = !state.minimized;
      GM_setValue(SETTINGS.minimized, state.minimized);
      updatePanel();
    });

    document.getElementById('trcc-pause').addEventListener('click', (event) => {
      state.paused = !state.paused;
      GM_setValue(SETTINGS.paused, state.paused);
      event.currentTarget.textContent = state.paused ? 'Resume' : 'Pause';
      updatePanel();
      if (!state.paused) scanAllVisibleChats();
    });

    document.getElementById('trcc-save-settings').addEventListener('click', () => {
      GM_setValue(SETTINGS.endpoint, endpoint.value.trim());
      GM_setValue(SETTINGS.token, token.value);
      setStatus('Settings saved locally');
    });
    document.getElementById('trcc-sync').addEventListener('click', syncNow);
    document.getElementById('trcc-export-json').addEventListener('click', () => exportData('json'));
    document.getElementById('trcc-export-csv').addEventListener('click', () => exportData('csv'));
    document.getElementById('trcc-clear').addEventListener('click', async () => {
      if (confirm('Delete all locally collected chat research data?')) {
        await clearDatabase();
        setStatus('Local data cleared');
      }
    });

    document.getElementById('trcc-pause').textContent = state.paused ? 'Resume' : 'Pause';
    updatePanel();
  }

  function installLifecycleListeners() {
    window.addEventListener('focus', () => {
      updatePanel();
      scanAllVisibleChats();
    });
    window.addEventListener('blur', updatePanel);
    document.addEventListener('visibilitychange', () => {
      updatePanel();
      if (document.visibilityState === 'visible') scanAllVisibleChats();
    });
  }

  async function init() {
    try {
      state.db = await openDatabase();
      createPanel();
      await refreshStats();
      installObserver();
      installLifecycleListeners();
      await scanAllVisibleChats();

      state.syncTimer = setInterval(() => {
        if (!state.paused && document.visibilityState === 'visible') syncNow();
      }, AUTO_SYNC_MS);

      const rootWaiter = new MutationObserver(() => {
        const root = document.querySelector(SELECTORS.chatRoot);
        if (root && state.observer && state.observer.root !== root) {
          installObserver();
          scanAllVisibleChats();
        }
      });
      rootWaiter.observe(document.body, { childList: true, subtree: true });

      setStatus('Collector ready');
      log('Initialized');
    } catch (error) {
      console.error('[TRCC] Initialization failed', error);
      createPanel();
      setStatus(`Initialization failed: ${error.message}`, true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
