(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteNotify = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SEEN_KEY = 'reviverelay_notified_events_v1';
  const SETTINGS_KEY = 'reviverelay_notification_settings_v1';
  const MAX_SEEN = 100;
  const QUEUE_GAP_MS = 60000;
  const EVENTS = Object.freeze({
    'requester:WAITING_FOR_PAYMENT': ['accepted', 'A reviver accepted: time to pay', true],
    'requester:WAITING_FOR_REVIVE': ['paymentVerified', 'Payment verified', false],
    'requester:COMPLETED': ['revived', 'You were revived', true],
    'requester:FAILED_ATTEMPT_CHOICE': ['failed', 'Revive failed: choose retry or refund', false],
    'requester:REFUNDED': ['refundResolved', 'Refund verified', true],
    'reviver:WAITING_FOR_REVIVE': ['paymentReceived', 'Payment received: revive now', true],
    'reviver:REFUND_REQUIRED': ['refundOwed', 'Refund owed', true]
  });

  function read(storage, key) {
    try {
      const value = storage.get(key, null);
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function allowed(settings, type, hour) {
    const types = settings.types || {};
    if (settings.enabled === false || (type === 'newRequest' ? types.newRequest !== true : types[type] === false)) return false;
    const { quietFrom: from, quietTo: to } = settings;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return true;
    return from < to ? hour < from || hour >= to : hour < from && hour >= to;
  }

  let audio;
  function playChime(window) {
    try {
      const context = audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      context.resume();
      const tone = context.createOscillator();
      const gain = context.createGain();
      const t = context.currentTime;
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      tone.connect(gain).connect(context.destination);
      tone.start(t);
      tone.stop(t + 0.4);
      return true;
    } catch (_) {
      return false;
    }
  }

  function createNotifier({ storage, notify, window = null, now = () => Date.now(), chime = () => playChime(window) } = {}) {
    function deliver(type, text, sound, settings) {
      if (!allowed(settings, type, new Date(now()).getHours())) return false;
      try { notify({ title: 'ReviveRelay', text, timeout: 12000, onclick: () => window && window.focus() }); } catch (_) {}
      if (sound && settings.sound !== false) chime();
      return true;
    }

    function save(seen, before) {
      const next = { ...seen, ids: seen.ids.slice(-MAX_SEEN) };
      if (JSON.stringify(next) === before) return;
      try { storage.set(SEEN_KEY, next); } catch (_) {}
    }

    function seenState() {
      const seen = read(storage, SEEN_KEY);
      return { ids: Array.isArray(seen.ids) ? seen.ids : [], queueCount: Number.isFinite(seen.queueCount) ? seen.queueCount : null, queueAt: Number(seen.queueAt) || 0, at: seen.at || 0 };
    }

    function onSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return 0;
      const settings = read(storage, SETTINGS_KEY);
      const seen = seenState();
      const before = JSON.stringify(seen);
      const m = now() / 6e4 | 0, quiet = m - seen.at > 10;
      seen.at = m;
      let fired = 0;
      for (const tx of [].concat(snapshot.activeTransactions || [], snapshot.recentlyClosed || [])) {
        const event = tx && EVENTS[`${tx.participantRole}:${tx.state}`];
        const id = event && `${tx.id}:${tx.state}`;
        if (!id || seen.ids.includes(id)) continue;
        seen.ids.push(id);
        if (!quiet && deliver(event[0], event[1], event[2], settings)) fired += 1;
      }
      const count = snapshot.queue ? Number(snapshot.queue.count) : NaN;
      if (Number.isFinite(count)) {
        if (seen.queueCount !== null && count > seen.queueCount && now() - seen.queueAt >= QUEUE_GAP_MS &&
            deliver('newRequest', `New revive request (${count} in queue)`, false, settings)) {
          seen.queueAt = now();
          fired += 1;
        }
        seen.queueCount = count;
      }
      save(seen, before);
      return fired;
    }

    function notifyOnce(id, text) {
      const seen = seenState();
      if (seen.ids.includes(id)) return false;
      seen.ids.push(id);
      save(seen);
      return deliver('system', text, false, read(storage, SETTINGS_KEY));
    }

    return Object.freeze({ onSnapshot, notifyOnce });
  }

  return Object.freeze({ SEEN_KEY, SETTINGS_KEY, EVENTS, allowed, playChime, createNotifier });
});
