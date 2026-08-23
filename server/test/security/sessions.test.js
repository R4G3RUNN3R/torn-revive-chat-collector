const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../src/security/sessions.js');

function loadSessions() {
  assert.ok(fs.existsSync(modulePath), 'server/src/security/sessions.js must exist');
  return require(modulePath);
}

test('session tokens are random and their peppered hash is deterministic', () => {
  const { newSessionToken, hashSessionToken } = loadSessions();
  const a = newSessionToken();
  const b = newSessionToken();

  assert.notEqual(a, b);
  assert.equal(hashSessionToken(a, 'pepper'), hashSessionToken(a, 'pepper'));
  assert.notEqual(hashSessionToken(a, 'pepper'), hashSessionToken(a, 'different-pepper'));
  assert.doesNotMatch(hashSessionToken(a, 'pepper'), new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
