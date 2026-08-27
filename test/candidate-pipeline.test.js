const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { handlePublicMessage } = require('../src/candidate-pipeline');

function baseRecord(overrides = {}) {
  return {
    conversationId: 'public_global',
    conversationName: 'Global',
    conversationType: 'global',
    abroadLocation: '',
    senderId: '12345',
    senderName: 'Player',
    text: 'need a revive please',
    sourceMessageId: 'msg-1',
    messageTimestamp: '2026-08-24T14:00:00.000Z',
    capturedAt: '2026-08-24T14:00:01.000Z',
    pageUrl: 'https://www.torn.com/index.php',
    fingerprint: 'legacy-fingerprint',
    synced: false,
    ...overrides
  };
}

test('public non-candidate produces local classification event but no upload', async () => {
  const localEvents = [];
  const uploads = [];

  const result = await handlePublicMessage(baseRecord({ text: 'selling revives 1m each' }), {
    onLocalEvent: (event) => localEvents.push(event),
    enqueueCandidate: (payload) => uploads.push(payload)
  });

  assert.equal(result.processed, true);
  assert.equal(result.queued, false);
  assert.equal(result.classification.candidate, false);
  assert.equal(localEvents.length, 1);
  assert.equal(localEvents[0].classification.candidate, false);
  assert.equal(uploads.length, 0);
});

test('public candidate uploads only the Stage 1 minimal candidate schema', async () => {
  const uploads = [];

  const result = await handlePublicMessage(baseRecord(), {
    enqueueCandidate: (payload) => uploads.push(payload)
  });

  assert.equal(result.processed, true);
  assert.equal(result.queued, true);
  assert.equal(uploads.length, 1);

  const payload = uploads[0];
  assert.deepEqual(Object.keys(payload).sort(), [
    'capturedAt',
    'channelId',
    'classifierVersion',
    'messageTimestamp',
    'reasons',
    'score',
    'senderId',
    'senderName',
    'sourceMessageId',
    'text'
  ]);
  assert.equal(payload.channelId, 'public_global');
  assert.equal(payload.senderId, '12345');
  assert.equal(payload.senderName, 'Player');
  assert.equal(payload.text, 'need a revive please');
  assert.equal(payload.sourceMessageId, 'msg-1');
  assert.equal(payload.messageTimestamp, '2026-08-24T14:00:00.000Z');
  assert.equal(payload.capturedAt, '2026-08-24T14:00:01.000Z');
  assert.equal(payload.classifierVersion, '2.0.0');
  assert.ok(payload.score >= 60);
  assert.ok(Array.isArray(payload.reasons));

  assert.equal('pageUrl' in payload, false);
  assert.equal('fingerprint' in payload, false);
  assert.equal('synced' in payload, false);
  assert.equal('conversationName' in payload, false);
  assert.equal('conversationType' in payload, false);
  assert.equal('abroadLocation' in payload, false);
});

test('forbidden channel produces neither classification event nor upload', async () => {
  for (const conversationId of ['faction-123', 'company-123', 'private-123', 'public_totally_unknown']) {
    const localEvents = [];
    const uploads = [];

    const result = await handlePublicMessage(baseRecord({ conversationId }), {
      onLocalEvent: (event) => localEvents.push(event),
      enqueueCandidate: (payload) => uploads.push(payload)
    });

    assert.deepEqual(result, { processed: false, queued: false, classification: null });
    assert.equal(localEvents.length, 0);
    assert.equal(uploads.length, 0);
  }
});

test('optional source id and Torn timestamp are omitted rather than sent as empty strings', async () => {
  const uploads = [];

  await handlePublicMessage(baseRecord({ sourceMessageId: '', messageTimestamp: '' }), {
    enqueueCandidate: (payload) => uploads.push(payload)
  });

  assert.equal(uploads.length, 1);
  assert.equal('sourceMessageId' in uploads[0], false);
  assert.equal('messageTimestamp' in uploads[0], false);
});

test('candidate preserves exact original message text while classification may normalize internally', async () => {
  const uploads = [];
  const text = '  Need   REVIVE please!  ';

  await handlePublicMessage(baseRecord({ text }), {
    enqueueCandidate: (payload) => uploads.push(payload)
  });

  assert.equal(uploads[0].text, text);
});

test('installable userscript uses candidate pipeline and contains no raw Google Sheets batch upload path', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');
  const build = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'build.js'), 'utf8');

  assert.match(source, /@require\s+https:\/\/raw\.githubusercontent\.com\/R4G3RUNN3R\/torn-revive-chat-collector\/__REVIVERELAY_GIT_COMMIT__\/src\/revive-classifier\.js/);
  assert.match(source, /@require\s+https:\/\/raw\.githubusercontent\.com\/R4G3RUNN3R\/torn-revive-chat-collector\/__REVIVERELAY_GIT_COMMIT__\/src\/candidate-pipeline\.js/);
  assert.match(source, /ReviveRelayCandidatePipeline/);
  assert.match(source, /handlePublicMessage/);
  assert.doesNotMatch(source, /records:\s*rows\.map\(Core\.buildSheetRecord\)/);
  assert.doesNotMatch(source, /@connect\s+script\.google\.com/);
  assert.doesNotMatch(source, /@connect\s+script\.googleusercontent\.com/);

  assert.match(build, /revive-classifier\.js/);
  assert.match(build, /candidate-pipeline\.js/);
});
