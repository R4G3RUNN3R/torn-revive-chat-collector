const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('direct runtime contains no Live Capture, classifier feed, or chat capture gate', () => {
  for (const token of ['Live Capture','MAX_LIVE_EVENTS','captureAllowed','discoverChats(','handlePublicMessage(','candidateOutbox']) {
    assert.equal(source.includes(token), false, token);
  }
});

test('minimizing ReviveRelay affects only panel/invoice rendering, never revive discovery', () => {
  assert.match(source, /state\.minimized = !state\.minimized/);
  assert.match(source, /state\.currentInvoice\?\.state !== 'PENDING'/);
  assert.doesNotMatch(source, /captureAllowed|discoverChats\(|handlePublicMessage\(|candidateOutbox/);
});
