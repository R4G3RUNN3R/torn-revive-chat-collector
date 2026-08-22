const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeText,
  fingerprintMessage,
  inferConversationType,
  inferAbroadLocation,
  buildSheetRecord
} = require('../src/core');

test('normalizeText collapses whitespace without changing wording', () => {
  assert.equal(normalizeText('  rev   pls\n paying xan  '), 'rev pls paying xan');
});

test('fingerprintMessage is deterministic and changes when message identity changes', () => {
  const base = {
    conversationId: 'global',
    senderId: '123',
    senderName: 'Alice',
    messageTimestamp: '2026-08-22T10:00:00.000Z',
    text: 'rev pls'
  };

  const first = fingerprintMessage(base);
  const second = fingerprintMessage({ ...base });
  const changed = fingerprintMessage({ ...base, text: 'revive please' });

  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test('inferConversationType recognizes common Torn chat labels', () => {
  assert.equal(inferConversationType('Global'), 'global');
  assert.equal(inferConversationType('Faction'), 'faction');
  assert.equal(inferConversationType('Company'), 'company');
  assert.equal(inferConversationType('Mexico'), 'travel');
  assert.equal(inferConversationType('SomePlayer'), 'private');
});

test('inferAbroadLocation returns a country only for recognized abroad chat labels', () => {
  assert.equal(inferAbroadLocation('Mexico'), 'Mexico');
  assert.equal(inferAbroadLocation('Cayman Islands'), 'Cayman Islands');
  assert.equal(inferAbroadLocation('Faction'), '');
  assert.equal(inferAbroadLocation('SomePlayer'), '');
});

test('buildSheetRecord emits the research columns and preserves exact message text', () => {
  const record = buildSheetRecord({
    conversationId: 'mexico',
    conversationName: 'Mexico',
    conversationType: 'travel',
    senderId: '123',
    senderName: 'Alice',
    text: 'rev pls paying xan',
    messageTimestamp: '2026-08-22T10:42:13.000Z',
    capturedAt: '2026-08-22T10:42:14.000Z',
    pageUrl: 'https://www.torn.com/index.php'
  });

  assert.equal(record.date, '2026-08-22');
  assert.equal(record.time, '10:42:13');
  assert.equal(record.chat, 'Mexico');
  assert.equal(record.abroadLocation, 'Mexico');
  assert.equal(record.player, 'Alice');
  assert.equal(record.playerId, '123');
  assert.equal(record.message, 'rev pls paying xan');
  assert.ok(record.fingerprint);
});
