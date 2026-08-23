const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../src/app');

function createMarketplaceApp(transactionRepository, { reviver = true } = {}) {
  return createApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '11'.repeat(32),
      SESSION_TOKEN_PEPPER: 'pepper'
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    userRepository: { async bindIdentity() { throw new Error('not used'); } },
    sessionRepository: {
      async findByTokenHash() {
        return {
          sessionId: '22222222-2222-2222-2222-222222222222',
          userId: '44444444-4444-4444-4444-444444444444',
          tornId: 7000002,
          sessionRevokedAt: null,
          expiresAt: null,
          accountState: 'active',
          isReviver: reviver,
          reviverStanding: reviver ? 'ACTIVE' : null,
          activeBan: false
        };
      }
    },
    transactionRepository
  });
}

test('registered active reviver can list available direct requests and accept one', async () => {
  const calls = [];
  const transactionRepository = {
    async listAvailable() {
      return [{
        id: '33333333-3333-3333-3333-333333333333',
        requesterTornId: 7000001,
        requesterName: 'Requester',
        paymentMethod: 'cash',
        offerAmount: 500000,
        comment: 'help',
        createdAt: new Date('2026-08-23T18:00:00.000Z')
      }];
    },
    async acceptRequest(input) {
      calls.push(input);
      return {
        id: '55555555-5555-5555-5555-555555555555',
        requestId: input.requestId,
        reviverId: input.reviverId,
        state: 'WAITING_FOR_PAYMENT',
        acceptedAt: new Date('2026-08-23T18:30:00.000Z'),
        paymentDeadline: new Date('2026-08-23T18:33:00.000Z')
      };
    }
  };
  const app = createMarketplaceApp(transactionRepository);

  const queue = await app.inject({
    method: 'GET',
    url: '/v1/reviver/queue',
    headers: { authorization: 'Bearer token' }
  });
  assert.equal(queue.statusCode, 200);
  assert.equal(queue.json().requests.length, 1);

  const accepted = await app.inject({
    method: 'POST',
    url: '/v1/requests/33333333-3333-3333-3333-333333333333/accept',
    headers: { authorization: 'Bearer token' }
  });
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.json().transaction.state, 'WAITING_FOR_PAYMENT');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reviverId, '44444444-4444-4444-4444-444444444444');
  await app.close();
});

test('ordinary requester session cannot access reviver queue or Accept', async () => {
  let calls = 0;
  const transactionRepository = {
    async listAvailable() { calls += 1; return []; },
    async acceptRequest() { calls += 1; }
  };
  const app = createMarketplaceApp(transactionRepository, { reviver: false });

  const queue = await app.inject({
    method: 'GET',
    url: '/v1/reviver/queue',
    headers: { authorization: 'Bearer token' }
  });
  assert.equal(queue.statusCode, 403);
  assert.equal(queue.json().code, 'REVIVER_REQUIRED');

  const accepted = await app.inject({
    method: 'POST',
    url: '/v1/requests/33333333-3333-3333-3333-333333333333/accept',
    headers: { authorization: 'Bearer token' }
  });
  assert.equal(accepted.statusCode, 403);
  assert.equal(calls, 0);
  await app.close();
});

test('losing an Accept race returns a typed conflict', async () => {
  const transactionRepository = {
    async listAvailable() { return []; },
    async acceptRequest() {
      const error = new Error('already accepted');
      error.code = 'REQUEST_NOT_AVAILABLE';
      throw error;
    }
  };
  const app = createMarketplaceApp(transactionRepository);

  const reply = await app.inject({
    method: 'POST',
    url: '/v1/requests/33333333-3333-3333-3333-333333333333/accept',
    headers: { authorization: 'Bearer token' }
  });

  assert.equal(reply.statusCode, 409);
  assert.equal(reply.json().code, 'REQUEST_NOT_AVAILABLE');
  await app.close();
});
