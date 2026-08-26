const test = require('node:test');
const assert = require('node:assert/strict');
const {
  publicCredentialStatus,
  assertCredentialCapability
} = require('../../src/security/verification-credential');

test('public credential status never exposes encrypted key material', () => {
  const status = publicCredentialStatus({
    id: 'cred-1', purpose: 'transaction_verification', capability: { requester: true, reviver: false },
    access_scope: { user: ['profile', 'revives'] }, last_validated_at: new Date('2026-08-26T10:00:00Z'),
    unusable_at: null, unusable_reason: null, revoked_at: null,
    ciphertext: 'cipher', iv: 'iv', auth_tag: 'tag'
  });
  assert.deepEqual(status, {
    id: 'cred-1', purpose: 'transaction_verification', capabilities: { requester: true, reviver: false },
    accessScope: { user: ['profile', 'revives'] }, lastValidatedAt: new Date('2026-08-26T10:00:00Z'),
    usable: true, unusableReason: null
  });
  assert.doesNotMatch(JSON.stringify(status), /cipher|auth_tag|\"iv\"/i);
});

test('capability guard rejects missing or unusable credentials', () => {
  assert.throws(() => assertCredentialCapability(null, 'requester'), /required/i);
  assert.throws(() => assertCredentialCapability({ usable: false, capabilities: { requester: true } }, 'requester'), /unusable/i);
  assert.throws(() => assertCredentialCapability({ usable: true, capabilities: { requester: false } }, 'requester'), /insufficient/i);
  assert.doesNotThrow(() => assertCredentialCapability({ usable: true, capabilities: { requester: true } }, 'requester'));
});
