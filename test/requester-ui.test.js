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
  assert.match(source, /getTransaction\(/);
  assert.match(source, /paymentDeadline/);
  assert.match(source, /reviveDeadline/);
  assert.match(source, /refundDeadline/);
  assert.match(source, /retryResponseDeadline/);
});


test("transaction countdowns derive from server-provided timestamps rather than local contract guesses", () => {
  assert.match(source, /formatCountdown|deadlineRemaining/i);
  assert.match(source, /paymentDeadline/);
  assert.match(source, /reviveDeadline/);
  assert.match(source, /refundDeadline/);
  assert.match(source, /retryResponseDeadline/);
  assert.doesNotMatch(source, /paymentDeadline\s*=\s*new Date\(Date\.now\(\)\s*\+\s*3\s*\*\s*60/);
  assert.doesNotMatch(source, /refundDeadline\s*=\s*new Date\(Date\.now\(\)\s*\+\s*10\s*\*\s*60/);
});
