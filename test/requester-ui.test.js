const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('free requester configures Cash/Xanax preset and uses exact sidebar action', () => {
  assert.match(source, /ReviveRelay → Revive Me!/);
  assert.match(source, /Revive Me preset/);
  assert.match(source, /value=["']cash["']/i);
  assert.match(source, /value=["']xanax["']/i);
  assert.match(source, /500000/);
  assert.match(source, /Minimum: \$500,000 Cash or 1 Xanax/);
  assert.match(source, /maxlength=["']500["']/);
  assert.match(source, /requestReviveFromSidebar/);
  assert.match(source, /state\.api\.createRequest\(validation\.preset\)/);
});

test('requester UI refreshes active certified state and offers cancellation before committed payment', () => {
  assert.match(source, /getActiveRequest\(/);
  assert.match(source, /refreshActiveRequest/);
  assert.match(source, /cancelRequest\(/);
  assert.match(source, /getTransaction\(/);
  assert.match(source, /CERTIFIED REQUEST/);
  assert.match(source, /paymentDeadline/);
  assert.match(source, /reviveDeadline/);
  assert.match(source, /refundDeadline/);
  assert.match(source, /retryResponseDeadline/);
});

test('transaction countdowns derive from server-provided timestamps rather than local contract guesses', () => {
  assert.match(source, /formatCountdown|deadlineRemaining/i);
  assert.match(source, /paymentDeadline/);
  assert.match(source, /reviveDeadline/);
  assert.match(source, /refundDeadline/);
  assert.match(source, /retryResponseDeadline/);
  assert.doesNotMatch(source, /paymentDeadline\s*=\s*new Date\(Date\.now\(\)\s*\+\s*3\s*\*\s*60/);
  assert.doesNotMatch(source, /refundDeadline\s*=\s*new Date\(Date\.now\(\)\s*\+\s*10\s*\*\s*60/);
});
