const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../src/app');

function createRequestTestApp(requestRepository) {
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
          userId: '11111111-1111-1111-1111-111111111111',
          tornId: 7654321,
          sessionRevokedAt: null,
          expiresAt: null,
          accountState: 'active',
          isReviver: false,
          reviverStanding: null,
          activeBan: false
        };
      }
    },
    requestRepository
  });
}

function activeRequest(overrides = {}) {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    requesterId: '11111111-1111-1111-1111-111111111111',
    paymentMethod: 'cash',
    offerAmount: 500000,
    comment: null,
    state: 'AVAILABLE',
    createdAt: new Date('2026-08-23T18:00:00.000Z'),
    updatedAt: new Date('2026-08-23T18:00:00.000Z'),
    cancelledAt: null,
    closedAt: null,
    ...overrides
  };
}

test('POST /v1/requests derives requester from authenticated session and creates validated offer', async () => {
  const calls = [];
  const app = createRequestTestApp({
    async createOrGetActive(input) {
      calls.push(input);
      return { request: activeRequest({ paymentMethod: input.paymentMethod, offerAmount: input.offerAmount, comment: input.comment }), created: true };
    },
    async getActive() { return null; },
    async cancelAvailable() { return null; }
  });

  const reply = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: 'Bearer token' },
    payload: { paymentMethod: 'cash', offerAmount: 500000, comment: '  please hurry  ' }
  });

  assert.equal(reply.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requesterId, '11111111-1111-1111-1111-111111111111');
  assert.equal(calls[0].comment, 'please hurry');
  assert.equal(reply.json().request.state, 'AVAILABLE');
  await app.close();
});

test('POST /v1/requests rejects client-supplied requester identity and invalid offers', async () => {
  let creates = 0;
  const app = createRequestTestApp({
    async createOrGetActive() { creates += 1; },
    async getActive() { return null; },
    async cancelAvailable() { return null; }
  });

  const forged = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: 'Bearer token' },
    payload: { requesterId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', paymentMethod: 'cash', offerAmount: 500000 }
  });
  assert.equal(forged.statusCode, 422);

  const tooLow = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: 'Bearer token' },
    payload: { paymentMethod: 'cash', offerAmount: 499999 }
  });
  assert.equal(tooLow.statusCode, 422);
  assert.equal(creates, 0);
  await app.close();
});

test('GET active and POST cancel operate only on authenticated requester request', async () => {
  const calls = [];
  const request = activeRequest();
  const app = createRequestTestApp({
    async createOrGetActive() { throw new Error('not used'); },
    async getActive(requesterId) {
      calls.push(['get', requesterId]);
      return request;
    },
    async cancelAvailable(requestId, requesterId) {
      calls.push(['cancel', requestId, requesterId]);
      return activeRequest({ state: 'CANCELLED', closedAt: new Date('2026-08-23T18:01:00.000Z') });
    }
  });

  const active = await app.inject({
    method: 'GET',
    url: '/v1/requests/active',
    headers: { authorization: 'Bearer token' }
  });
  assert.equal(active.statusCode, 200);
  assert.equal(active.json().request.id, request.id);

  const cancelled = await app.inject({
    method: 'POST',
    url: `/v1/requests/${request.id}/cancel`,
    headers: { authorization: 'Bearer token' }
  });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.json().request.state, 'CANCELLED');
  assert.deepEqual(calls, [
    ['get', '11111111-1111-1111-1111-111111111111'],
    ['cancel', request.id, '11111111-1111-1111-1111-111111111111']
  ]);
  await app.close();
});
