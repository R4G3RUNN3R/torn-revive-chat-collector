const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../src/security/crypto.js');

function loadCrypto() {
  assert.ok(fs.existsSync(modulePath), 'server/src/security/crypto.js must exist');
  return require(modulePath);
}

test('AES-GCM round-trips an API key and rejects a wrong encryption key', () => {
  const { encryptSecret, decryptSecret } = loadCrypto();
  const key = '11'.repeat(32);
  const encrypted = encryptSecret('abc123', key);

  assert.notEqual(encrypted.ciphertext, 'abc123');
  assert.equal(decryptSecret(encrypted, key), 'abc123');
  assert.throws(() => decryptSecret(encrypted, '22'.repeat(32)));
});

test('AES-GCM uses a fresh IV for each encryption', () => {
  const { encryptSecret } = loadCrypto();
  const key = '11'.repeat(32);
  const first = encryptSecret('same-secret', key);
  const second = encryptSecret('same-secret', key);

  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});
