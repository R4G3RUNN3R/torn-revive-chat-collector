const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../src/domain/candidate-identity.js');

function loadIdentity() {
  assert.ok(fs.existsSync(modulePath), 'server/src/domain/candidate-identity.js must exist');
  return require(modulePath);
}

function candidate(overrides = {}) {
  return {
    channel: { id: 'public_global', name: 'Global', type: 'global' },
    senderId: '1234567',
    senderName: 'ReviverNeed',
    text: '  need   a revive please  ',
    sourceMessageId: null,
    messageTimestamp: null,
    capturedAt: '2026-08-23T17:00:00.000Z',
    classifierVersion: '2.0.0',
    score: 95,
    reasons: ['direct-request'],
    ...overrides
  };
}

test('stable source message ID is the preferred canonical identity', () => {
  const { buildCanonicalCandidateKey } = loadIdentity();
  const first = buildCanonicalCandidateKey(candidate({ sourceMessageId: 'msg-42' }));
  const second = buildCanonicalCandidateKey(candidate({
    sourceMessageId: 'msg-42',
    senderId: '9999999',
    senderName: 'Different Name',
    text: 'different text',
    capturedAt: '2026-08-23T18:00:00.000Z'
  }));

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, buildCanonicalCandidateKey(candidate({ sourceMessageId: 'msg-43' })));
  assert.notEqual(first, buildCanonicalCandidateKey(candidate({
    channel: { id: 'public_trade', name: 'Trade', type: 'trade' },
    sourceMessageId: 'msg-42'
  })));
});

test('timestamp fallback uses channel, sender and normalized text but never local capture time', () => {
  const { buildCanonicalCandidateKey } = loadIdentity();
  const base = candidate({ messageTimestamp: '2026-08-23T16:59:30.000Z' });
  const same = candidate({
    messageTimestamp: '2026-08-23T16:59:30.000Z',
    text: 'need a revive please',
    capturedAt: '2026-08-23T17:30:00.000Z'
  });

  assert.equal(buildCanonicalCandidateKey(base), buildCanonicalCandidateKey(same));
  assert.notEqual(
    buildCanonicalCandidateKey(base),
    buildCanonicalCandidateKey(candidate({ messageTimestamp: '2026-08-23T16:59:31.000Z' }))
  );
});

test('no source ID and no Torn timestamp uses only a stable fallback-basis hash', () => {
  const { buildCanonicalCandidateKey, buildFallbackBasisHash } = loadIdentity();
  const first = candidate();
  const second = candidate({
    text: 'need a revive please',
    capturedAt: '2026-08-23T20:00:00.000Z'
  });

  assert.equal(buildCanonicalCandidateKey(first), null);
  assert.match(buildFallbackBasisHash(first), /^[a-f0-9]{64}$/);
  assert.equal(buildFallbackBasisHash(first), buildFallbackBasisHash(second));
  assert.notEqual(
    buildFallbackBasisHash(first),
    buildFallbackBasisHash(candidate({ senderId: '7654321' }))
  );
});
