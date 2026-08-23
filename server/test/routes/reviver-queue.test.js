const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

function makeSessionRepository({ reviver = true } = {}) {
  return {
    async findByTokenHash() {
      return {
        sessionId: 'session-1',
        userId: 'reviver-user-id',
        tornId: 222222,
        expiresAt: null,
        revokedAt: null,
        reviverStanding: reviver ? 'active' : null,
        activeBan: false
      };
    }
  };
}

function makeApp(transactionRepository, options = {}) {
  return buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '88'.repeat(32),
      SESSION_TOKEN_PEPPER: 'test-pepper'
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() {} },
    sessionRepository: makeSessionRepository(options),
    transactionRepository
  });
}

test('reviver queue and accept use the authenticated reviver identity', async t => {
  const calls = [];
  const app = makeApp({
    async listAvailableRequests() {
      return [{ id: 'request-1', state: 'AVAILABLE' }];
    },
    async acceptRequest(input) {
      calls.push(input);
      return {
        accepted: true,
        transaction: {
          id: 'tx-1',
          requestId: input.requestId,
          reviverId: input.reviverId,
          state: 'WAITING_FOR_PAYMENT'
        }
      };
    }
  });
  t.after(() => app.close());

  const queue = await app.inject({
    method: 'GET',
    url: '/v1/reviver/queue',
    headers: { authorization: 'Bearer reviver-token' }
  });
  assert.equal(queue.statusCode, 200);
  assert.equal(queue.json().requests.length, 1);

  const accepted = await app.inject({
    method: 'POST',
    url: '/v1/requests/request-1/accept',
    headers: { authorization: 'Bearer reviver-token' },
    payload: { reviverId: 'attacker-supplied-id' }
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestId, 'request-1');
  assert.equal(calls[0].reviverId, 'reviver-user-id');
});

test('non-reviver sessions cannot view or accept the reviver queue', async t => {
  const app = makeApp({
    async listAvailableRequests() { throw new Error('must not be called'); },
    async acceptRequest() { throw new Error('must not be called'); }
  }, { reviver: false });
  t.after(() => app.close());

  const queue = await app.inject({
    method: 'GET',
    url: '/v1/reviver/queue',
    headers: { authorization: 'Bearer requester-token' }
  });
  assert.equal(queue.statusCode, 403);

  const accepted = await app.inject({
    method: 'POST',
    url: '/v1/requests/request-1/accept',
    headers: { authorization: 'Bearer requester-token' }
  });
  assert.equal(accepted.statusCode, 403);
});
