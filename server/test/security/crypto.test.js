const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptSecret, decryptSecret } = require('../../src/security/crypto');

test('AES-GCM round-trips an API key and rejects the wrong key', () => {
  const key = '11'.repeat(32);
  const encrypted = encryptSecret('abc123', key);

  assert.equal(decryptSecret(encrypted, key), 'abc123');
  assert.throws(() => decryptSecret(encrypted, '22'.repeat(32)));
});

test('encrypted secret does not contain plaintext', () => {
  const encrypted = encryptSecret('super-secret-api-key', '33'.repeat(32));
  const serialized = JSON.stringify(encrypted);

  assert.doesNotMatch(serialized, /super-secret-api-key/);
  assert.match(encrypted.ciphertext, /^[0-9a-f]+$/i);
  assert.match(encrypted.iv, /^[0-9a-f]+$/i);
  assert.match(encrypted.tag, /^[0-9a-f]+$/i);
});
