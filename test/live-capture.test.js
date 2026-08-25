const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('Live Capture is bounded and displays local classifier/candidate activity', () => {
  assert.match(source, /Live Capture/);
  assert.match(source, /MAX_LIVE_EVENTS\s*=\s*50/);
  assert.match(source, /classifier|classification/i);
  assert.match(source, /score/i);
  assert.match(source, /candidate/i);
  assert.match(source, /queue/i);
  assert.match(source, /duplicate/i);
});

test('minimizing Live Capture does not participate in the captureAllowed gate', () => {
  const captureFn = source.match(/function captureAllowed\(\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert.ok(captureFn.length > 0);
  assert.doesNotMatch(captureFn, /minimized/);
});
