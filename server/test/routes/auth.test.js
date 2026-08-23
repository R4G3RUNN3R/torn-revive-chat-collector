const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

test('POST /v1/auth/bind stores encrypted key material and returns an opaque session token', async t => {
  const stored = [];
  const app = buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '44'.repeat(32),
      SESSION_TOKEN_PEPPER: 'test-pepper'
    },
    tornClient: {
      async getKeyInfo(apiKey) {
        assert.equal(apiKey, 'very-secret-torn-key');
        return {
          tornId: 24680,
          name: 'TestReviver',
          access: { level: 2, type: 'Limited Access' }
        };
      }
    },
    identityRepository: {
      async bindIdentity(record) {
        stored.push(record);
        return { userId: '11111111-1111-1111-1111-111111111111' };
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/bind',
    payload: {
      apiKey: 'very-secret-torn-key',
      clientVersion: '0.3.0'
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.user.tornId, 24680);
  assert.equal(body.user.name, 'TestReviver');
  assert.deepEqual(body.keyAccess, { level: 2, type: 'Limited Access' });
  assert.equal(typeof body.token, 'string');
  assert.ok(body.token.length >= 40);
  assert.doesNotMatch(JSON.stringify(body), /very-secret-torn-key/);

  assert.equal(stored.length, 1);
  assert.equal(stored[0].tornId, 24680);
  assert.equal(stored[0].name, 'TestReviver');
  assert.equal(stored[0].clientVersion, '0.3.0');
  assert.equal(stored[0].encryptedCredential.ciphertext.includes('very-secret-torn-key'), false);
  assert.equal(stored[0].encryptedCredential.iv.length > 0, true);
  assert.equal(stored[0].encryptedCredential.tag.length > 0, true);
  assert.match(stored[0].tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(stored[0].tokenHash, body.token);
});

test('POST /v1/auth/bind rejects malformed input before calling Torn', async t => {
  let called = false;
  const app = buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '55'.repeat(32),
      SESSION_TOKEN_PEPPER: 'test-pepper'
    },
    tornClient: {
      async getKeyInfo() {
        called = true;
        throw new Error('should not be called');
      }
    },
    identityRepository: { async bindIdentity() {} }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/bind',
    payload: { apiKey: '', clientVersion: '' }
  });

  assert.equal(response.statusCode, 422);
  assert.equal(called, false);
});
