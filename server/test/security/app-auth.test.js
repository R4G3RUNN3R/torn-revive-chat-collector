const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../src/app');

function createTestApp(sessionRepository) {
  const app = createApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '11'.repeat(32),
      SESSION_TOKEN_PEPPER: 'pepper'
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    userRepository: { async bindIdentity() { throw new Error('not used'); } },
    sessionRepository
  });

  app.get('/test/protected', {
    preHandler: app.authenticateReviveRelay
  }, async (request) => request.reviveRelayUser);

  return app;
}

test('Fastify auth decorator attaches authenticated ReviveRelay user to protected routes', async () => {
  const app = createTestApp({
    async findByTokenHash() {
      return {
        sessionId: '22222222-2222-2222-2222-222222222222',
        userId: '11111111-1111-1111-1111-111111111111',
        tornId: 1234567,
        sessionRevokedAt: null,
        expiresAt: null,
        accountState: 'active',
        isReviver: true,
        reviverStanding: 'ACTIVE',
        activeBan: false
      };
    }
  });

  const reply = await app.inject({
    method: 'GET',
    url: '/test/protected',
    headers: { authorization: 'Bearer session-token' }
  });

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.json(), {
    userId: '11111111-1111-1111-1111-111111111111',
    tornId: 1234567,
    roles: ['user', 'reviver'],
    sessionId: '22222222-2222-2222-2222-222222222222'
  });
  await app.close();
});

test('Fastify auth decorator returns typed 401 for a missing session token', async () => {
  const app = createTestApp({ async findByTokenHash() { return null; } });

  const reply = await app.inject({ method: 'GET', url: '/test/protected' });

  assert.equal(reply.statusCode, 401);
  assert.equal(reply.json().code, 'AUTH_REQUIRED');
  await app.close();
});
