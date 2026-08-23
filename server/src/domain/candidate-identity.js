const { createHash } = require('node:crypto');

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function channelId(candidate) {
  const value = candidate && candidate.channel
    ? candidate.channel.id
    : candidate && candidate.channelId;
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError('Candidate channel ID is required');
  return normalized;
}

function senderIdentity(candidate) {
  const senderId = candidate && candidate.senderId;
  if (senderId !== null && senderId !== undefined && String(senderId).trim()) {
    return `id:${String(senderId).trim()}`;
  }

  const name = String(candidate && candidate.senderName ? candidate.senderName : '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!name) throw new TypeError('Candidate sender identity is required');
  return `name:${name}`;
}

function normalizedTimestamp(value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError('Candidate message timestamp is invalid');
  }
  return timestamp.toISOString();
}

function buildCanonicalCandidateKey(candidate) {
  const channel = channelId(candidate);
  const sourceMessageId = String(candidate && candidate.sourceMessageId ? candidate.sourceMessageId : '').trim();

  if (sourceMessageId) {
    return sha256(`v1|source|${channel}|${sourceMessageId}`);
  }

  if (candidate && candidate.messageTimestamp) {
    return sha256([
      'v1',
      'timestamp',
      channel,
      senderIdentity(candidate),
      normalizedTimestamp(candidate.messageTimestamp),
      normalizeText(candidate.text)
    ].join('|'));
  }

  return null;
}

function buildFallbackBasisHash(candidate) {
  return sha256([
    'v1',
    'fallback',
    channelId(candidate),
    senderIdentity(candidate),
    normalizeText(candidate && candidate.text)
  ].join('|'));
}

module.exports = {
  buildCanonicalCandidateKey,
  buildFallbackBasisHash,
  normalizeText
};
