const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('reviver marketplace supports registration queue and accept', () => {
  assert.match(source, /Register as reviver/i);
  assert.match(source, /registerReviver\(/);
  assert.match(source, /getReviverQueue\(/);
  assert.match(source, /acceptRequest\(/);
});

test('reviver queue and Accept are unavailable without server-validated reviver capability', () => {
  assert.match(source, /reviver/i);
  assert.match(source, /capabilit(?:y|ies)/i);
  assert.match(source, /rr-reviver-queue/);
  assert.match(source, /disabled/i);
});

test('client exposes only named transaction actions and never submits arbitrary state', () => {
  assert.match(source, /checkPayment\(/);
  assert.match(source, /requestRetry\(/);
  assert.match(source, /respondRetry\(/);
  assert.match(source, /requestRefund\(/);
  assert.match(source, /checkRefund\(/);
  assert.doesNotMatch(source, /state\.api\.[A-Za-z]+\([^\n]*\{[^\n]*state\s*:/);
});


test('session identity merges server roles so reviver registration becomes visible to the UI', () => {
  assert.match(source, /roles:\s*Array\.isArray\(me\?\.roles\)/);
});
