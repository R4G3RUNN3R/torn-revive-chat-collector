(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TornReviveCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ABROAD_LOCATIONS = [
    'Mexico', 'Cayman Islands', 'Canada', 'Hawaii', 'United Kingdom',
    'Argentina', 'Switzerland', 'Japan', 'China', 'UAE', 'South Africa'
  ];

  const KNOWN_CHAT_TYPES = [
    ['global', /\bglobal\b/i],
    ['trade', /\btrade\b/i],
    ['hospital', /\bhospital\b/i],
    ['jail', /\bjail\b/i],
    ['faction', /\bfaction\b/i],
    ['company', /\bcompany\b/i],
    ['new-player', /new\s*player/i]
  ];

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function hashString(input) {
    let hash = 0x811c9dc5;
    const text = String(input ?? '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function inferAbroadLocation(conversationName) {
    const normalized = normalizeText(conversationName).toLowerCase();
    const match = ABROAD_LOCATIONS.find((name) => normalized === name.toLowerCase());
    return match || '';
  }

  function inferConversationType(conversationName) {
    const name = normalizeText(conversationName);
    if (!name) return 'unknown';
    if (inferAbroadLocation(name)) return 'travel';
    for (const [type, pattern] of KNOWN_CHAT_TYPES) {
      if (pattern.test(name)) return type;
    }
    return 'private';
  }

  function fingerprintMessage(message) {
    const sourceId = normalizeText(message.sourceMessageId);
    const timestamp = normalizeText(message.messageTimestamp);
    const fallbackBucket = message.capturedAt
      ? String(message.capturedAt).slice(0, 16)
      : '';
    const identityTime = sourceId || timestamp || fallbackBucket;
    const identity = [
      normalizeText(message.conversationId || message.conversationName).toLowerCase(),
      normalizeText(message.senderId || message.senderName).toLowerCase(),
      identityTime,
      normalizeText(message.text)
    ].join('|');
    return `trcc-${hashString(identity)}`;
  }

  function splitTimestamp(isoValue) {
    const value = String(isoValue || '');
    const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    if (match) return { date: match[1], time: match[2] };
    return { date: '', time: '' };
  }

  function buildSheetRecord(message) {
    const effectiveTimestamp = message.messageTimestamp || message.capturedAt || new Date().toISOString();
    const parts = splitTimestamp(effectiveTimestamp);
    const chatName = normalizeText(message.conversationName) || 'Unknown';
    const type = message.conversationType || inferConversationType(chatName);
    const record = {
      date: parts.date,
      time: parts.time,
      chat: chatName,
      chatType: type,
      abroadLocation: message.abroadLocation || inferAbroadLocation(chatName),
      player: normalizeText(message.senderName),
      playerId: normalizeText(message.senderId),
      message: String(message.text ?? '').trim(),
      messageTimestamp: String(message.messageTimestamp || ''),
      capturedAt: String(message.capturedAt || ''),
      pageUrl: String(message.pageUrl || ''),
      conversationId: String(message.conversationId || ''),
      sourceMessageId: String(message.sourceMessageId || '')
    };
    record.fingerprint = message.fingerprint || fingerprintMessage({ ...message, conversationType: type });
    return record;
  }

  return {
    ABROAD_LOCATIONS,
    normalizeText,
    hashString,
    inferAbroadLocation,
    inferConversationType,
    fingerprintMessage,
    buildSheetRecord
  };
});
