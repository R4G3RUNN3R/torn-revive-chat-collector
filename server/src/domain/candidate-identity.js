const { createHash } = require('node:crypto');

function normalizeText(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function normalizeIdentity(value) {
  return normalizeText(value).toLowerCase();
}

function senderIdentity(candidate) {
  if (candidate.senderId != null && String(candidate.senderId).trim()) {
    return `id:${String(candidate.senderId).trim()}`;
  }
  return `name:${normalizeIdentity(candidate.senderName)}`;
}

function sha256(parts) {
  return createHash('sha256').update(parts.join('\u001f'), 'utf8').digest('hex');
}

function buildCanonicalCandidateKey(candidate) {
  const channel = normalizeIdentity(candidate.channelId);
  const sender = senderIdentity(candidate);
  const sourceMessageId = candidate.sourceMessageId == null
    ? ''
    : String(candidate.sourceMessageId).trim();

  if (sourceMessageId) {
    return sha256(['source', channel, sender, sourceMessageId]);
  }

  if (candidate.messageTimestamp) {
    const timestamp = new Date(candidate.messageTimestamp);
    if (!Number.isNaN(timestamp.getTime())) {
      return sha256([
        'timestamp',
        channel,
        sender,
        timestamp.toISOString(),
        normalizeIdentity(candidate.text)
      ]);
    }
  }

  return null;
}

function buildFallbackBasisHash(candidate) {
  return sha256([
    'fallback',
    normalizeIdentity(candidate.channelId),
    senderIdentity(candidate),
    normalizeIdentity(candidate.text)
  ]);
}

module.exports = {
  buildCanonicalCandidateKey,
  buildFallbackBasisHash,
  normalizeText
};
