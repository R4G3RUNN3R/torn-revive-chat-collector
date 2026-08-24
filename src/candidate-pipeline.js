(function (root, factory) {
  const publicChannels = typeof module === 'object' && module.exports
    ? require('./public-channels')
    : root?.TornRevivePublicChannels;
  const classifier = typeof module === 'object' && module.exports
    ? require('./revive-classifier')
    : root?.TornReviveClassifier;
  const api = factory(publicChannels, classifier);

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayCandidatePipeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PublicChannels, Classifier) {
  'use strict';

  function cleanOptional(value) {
    const text = String(value || '').trim();
    return text || undefined;
  }

  function buildCandidatePayload(record, channel, classification) {
    const payload = {
      channelId: channel.id,
      senderName: String(record.senderName || ''),
      text: String(record.text ?? ''),
      classifierVersion: classification.version,
      score: classification.score,
      reasons: Array.from(classification.reasons || [])
    };

    const senderId = cleanOptional(record.senderId);
    const sourceMessageId = cleanOptional(record.sourceMessageId);
    const messageTimestamp = cleanOptional(record.messageTimestamp);
    const capturedAt = cleanOptional(record.capturedAt);

    if (senderId) payload.senderId = senderId;
    if (sourceMessageId) payload.sourceMessageId = sourceMessageId;
    if (messageTimestamp) payload.messageTimestamp = messageTimestamp;
    if (capturedAt) payload.capturedAt = capturedAt;

    return payload;
  }

  async function handlePublicMessage(record, options = {}) {
    if (!record || typeof PublicChannels?.canonicalPublicChannel !== 'function') {
      return { processed: false, queued: false, classification: null };
    }

    const channel = PublicChannels.canonicalPublicChannel(record.conversationId || record.channelId);
    if (!channel) {
      return { processed: false, queued: false, classification: null };
    }

    if (typeof Classifier?.classifyReviveMessage !== 'function') {
      throw new Error('Revive classifier is unavailable');
    }

    const classification = Classifier.classifyReviveMessage({
      text: record.text,
      channelType: channel.type
    });

    const localEvent = {
      channel: { id: channel.id, name: channel.name, type: channel.type },
      record: { ...record },
      classification
    };

    if (typeof options.onLocalEvent === 'function') {
      await options.onLocalEvent(localEvent);
    }

    if (!classification.candidate || typeof options.enqueueCandidate !== 'function') {
      return { processed: true, queued: false, classification };
    }

    const payload = buildCandidatePayload(record, channel, classification);
    await options.enqueueCandidate(payload);
    return { processed: true, queued: true, classification };
  }

  return Object.freeze({
    buildCandidatePayload,
    handlePublicMessage
  });
});
