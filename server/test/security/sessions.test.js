const test = require('node:test');
const assert = require('node:assert/strict');
const { newSessionToken, hashSessionToken } = require('../../src/security/sessions');

test('session token hash is deterministic but token itself is random', () => {
  const a = newSessionToken();
  const b = newSessionToken();

  assert.notEqual(a, b);
  assert.equal(hashSessionToken(a, 'p'), hashSessionToken(a, 'p'));
  assert.notEqual(hashSessionToken(a, 'p'), a);
});

test('session token hash changes with the pepper', () => {
  const token = newSessionToken();
  assert.notEqual(hashSessionToken(token, 'pepper-a'), hashSessionToken(token, 'pepper-b'));
});
