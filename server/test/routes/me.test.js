const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');
const { hashSessionToken } = require('../../src/security/sessions');

function appWithSession(record) {
  return buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '22'.repeat(32),
      SESSION_TOKEN_PEPPER: 'me-test-pepper'
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() { throw new Error('not used'); } },
    sessionRepository: {
      async findByTokenHash(hash) {
        assert.equal(hash, hashSessionToken('me-token', 'me-test-pepper'));
        return record;
      }
    }
  });
}

test('GET /v1/me rejects a missing session', async t => {
  const app = appWithSession(null);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/me' });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, 'AUTH_REQUIRED');
});

test('GET /v1/me returns only authenticated public identity and roles', async t => {
  const app = appWithSession({
    sessionId: 'session-1',
    userId: 'user-1',
    tornId: 24680,
    name: 'TestReviver',
    expiresAt: null,
    revokedAt: null,
    reviverStanding: 'active',
    activeBan: false
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: 'Bearer me-token' }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    user: { tornId: 24680, name: 'TestReviver' },
    roles: ['requester', 'reviver']
  });
  assert.doesNotMatch(response.body, /apiKey|ciphertext|authTag|access_scope/i);
});
