const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCanonicalCandidateKey,
  buildFallbackBasisHash
} = require('../../src/domain/candidate-identity');

function baseCandidate(overrides = {}) {
  return {
    channelId: 'public_global',
    senderId: '12345',
    senderName: 'NeedsRevive',
    text: '  rev   me please  ',
    sourceMessageId: null,
    messageTimestamp: null,
    capturedAt: '2026-08-23T12:00:00Z',
    ...overrides
  };
}

test('stable Torn source message ID wins and ignores local capture timing', () => {
  const first = buildCanonicalCandidateKey(baseCandidate({
    sourceMessageId: 'message-abc',
    capturedAt: '2026-08-23T12:00:00Z'
  }));
  const second = buildCanonicalCandidateKey(baseCandidate({
    sourceMessageId: 'message-abc',
    capturedAt: '2026-08-23T12:04:30Z',
    text: 'different rendered text does not change stable source identity'
  }));

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second);
});

test('timestamp identity uses Torn timestamp and normalized text but never capturedAt', () => {
  const first = buildCanonicalCandidateKey(baseCandidate({
    messageTimestamp: '2026-08-23T11:59:30Z',
    capturedAt: '2026-08-23T12:00:00Z'
  }));
  const second = buildCanonicalCandidateKey(baseCandidate({
    messageTimestamp: '2026-08-23T11:59:30Z',
    capturedAt: '2026-08-23T12:08:00Z',
    text: 'rev me please'
  }));
  const differentMessage = buildCanonicalCandidateKey(baseCandidate({
    messageTimestamp: '2026-08-23T11:59:31Z'
  }));

  assert.equal(first, second);
  assert.notEqual(first, differentMessage);
});

test('candidate without source ID or Torn timestamp uses only rolling fallback identity', () => {
  const candidate = baseCandidate();
  assert.equal(buildCanonicalCandidateKey(candidate), null);

  const first = buildFallbackBasisHash(candidate);
  const second = buildFallbackBasisHash(baseCandidate({ capturedAt: '2026-08-24T12:00:00Z' }));

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second);
});

test('fallback basis changes when channel, sender, or normalized message changes', () => {
  const original = buildFallbackBasisHash(baseCandidate());
  assert.notEqual(original, buildFallbackBasisHash(baseCandidate({ channelId: 'public_trade' })));
  assert.notEqual(original, buildFallbackBasisHash(baseCandidate({ senderId: '999' })));
  assert.notEqual(original, buildFallbackBasisHash(baseCandidate({ text: 'rev me for 1 xanax' })));
});
