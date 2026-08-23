const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appModulePath = path.resolve(__dirname, '../../src/app.js');

function loadApp() {
  assert.ok(fs.existsSync(appModulePath), 'server/src/app.js must exist');
  return require(appModulePath);
}

function config() {
  return {
    API_KEY_ENCRYPTION_KEY: '11'.repeat(32),
    SESSION_TOKEN_PEPPER: 'test-pepper'
  };
}

test('POST /v1/auth/bind stores only encrypted Torn credentials and returns an opaque session once', async () => {
  const { createApp } = loadApp();
  const persisted = [];
  const userRepository = {
    async bindIdentity(record) {
      persisted.push(record);
      return { userId: '11111111-1111-1111-1111-111111111111', sessionId: '22222222-2222-2222-2222-222222222222' };
    }
  };
  const tornClient = {
    async getKeyInfo(apiKey) {
      assert.equal(apiKey, 'raw-torn-api-key');
      return {
        tornId: 1234567,
        name: 'ReviverOne',
        access: {
          level: 1,
          type: 'Custom',
          faction: false,
          company: false,
          log: { custom_permissions: true, available: [] },
          selections: { user: ['basic'], key: ['info'] }
        }
      };
    }
  };

  const app = createApp({ config: config(), tornClient, userRepository });
  const reply = await app.inject({
    method: 'POST',
    url: '/v1/auth/bind',
    payload: { apiKey: 'raw-torn-api-key', clientVersion: '0.3.0' }
  });

  assert.equal(reply.statusCode, 200);
  const body = reply.json();
  assert.equal(body.user.tornId, 1234567);
  assert.equal(body.user.name, 'ReviverOne');
  assert.equal(body.keyAccess.type, 'Custom');
  assert.equal(typeof body.token, 'string');
  assert.ok(body.token.length >= 32);
  assert.doesNotMatch(JSON.stringify(body), /raw-torn-api-key/);

  assert.equal(persisted.length, 1);
  const stored = persisted[0];
  assert.equal(stored.tornId, 1234567);
  assert.equal(stored.name, 'ReviverOne');
  assert.equal(stored.clientVersion, '0.3.0');
  assert.equal(typeof stored.tokenHash, 'string');
  assert.notEqual(stored.tokenHash, body.token);
  assert.equal(typeof stored.encryptedCredential.ciphertext, 'string');
  assert.equal(typeof stored.encryptedCredential.iv, 'string');
  assert.equal(typeof stored.encryptedCredential.tag, 'string');
  assert.doesNotMatch(JSON.stringify(stored), /raw-torn-api-key/);

  await app.close();
});

test('POST /v1/auth/bind maps invalid Torn keys to 401 without echoing the key', async () => {
  const { createApp } = loadApp();
  const tornClient = {
    async getKeyInfo() {
      const error = new Error('Torn rejected the API key');
      error.code = 'TORN_INVALID_KEY';
      throw error;
    }
  };
  const userRepository = {
    async bindIdentity() {
      throw new Error('must not persist invalid identity');
    }
  };
  const app = createApp({ config: config(), tornClient, userRepository });

  const reply = await app.inject({
    method: 'POST',
    url: '/v1/auth/bind',
    payload: { apiKey: 'bad-secret-value', clientVersion: '0.3.0' }
  });

  assert.equal(reply.statusCode, 401);
  assert.equal(reply.json().code, 'TORN_INVALID_KEY');
  assert.doesNotMatch(reply.body, /bad-secret-value/);
  await app.close();
});

test('POST /v1/auth/bind validates request shape before contacting Torn', async () => {
  const { createApp } = loadApp();
  let contacted = false;
  const app = createApp({
    config: config(),
    tornClient: { async getKeyInfo() { contacted = true; } },
    userRepository: { async bindIdentity() { throw new Error('unexpected'); } }
  });

  const reply = await app.inject({
    method: 'POST',
    url: '/v1/auth/bind',
    payload: { apiKey: '', clientVersion: '' }
  });

  assert.equal(reply.statusCode, 422);
  assert.equal(contacted, false);
  await app.close();
});
