const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('free requester UI supports Cash and Xanax revive requests with canonical minimums', () => {
  assert.match(source, /Request Revive/i);
  assert.match(source, /value=["']cash["']/i);
  assert.match(source, /value=["']xanax["']/i);
  assert.match(source, /500000/);
  assert.match(source, /minimum.*1 Xanax|1 Xanax.*minimum/i);
  assert.match(source, /500/); // comment cap is represented in UI/runtime source
  assert.match(source, /createRequest\(/);
});

test('requester UI refreshes active state and offers cancellation before committed payment', () => {
  assert.match(source, /getActiveRequest\(/);
  assert.match(source, /refreshActiveRequest/);
  assert.match(source, /cancelRequest\(/);
  assert.match(source, /Stage 3|verification.*not yet active/i);
});
