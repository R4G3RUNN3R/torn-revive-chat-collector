const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

const VALID_REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function makeSessionRepository() {
  return {
    async findByTokenHash() {
      return {
        sessionId: 'session-1',
        userId: 'requester-user-id',
        tornId: 123456,
        expiresAt: null,
        revokedAt: null,
        reviverStanding: null,
        activeBan: false
      };
    }
  };
}

function makeApp(requestRepository) {
  return buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '88'.repeat(32),
      SESSION_TOKEN_PEPPER: 'test-pepper'
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() {} },
    sessionRepository: makeSessionRepository(),
    requestRepository
  });
}

test('POST /v1/requests derives requester identity from authenticated session', async t => {
  let seen;
  const app = makeApp({
    async createRequest(input) {
      seen = input;
      return {
        created: true,
        request: {
          id: VALID_REQUEST_ID,
          requesterId: input.requesterId,
          paymentMethod: input.paymentMethod,
          offerAmount: input.offerAmount,
          comment: input.comment,
          state: 'AVAILABLE'
        }
      };
    },
    async getActiveRequest() { return null; },
    async cancelRequest() { throw new Error('not used'); }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: 'Bearer requester-token' },
    payload: {
      requesterId: 'attacker-supplied-id',
      paymentMethod: 'cash',
      offerAmount: 500000,
      comment: '  Please revive me  '
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(seen.requesterId, 'requester-user-id');
  assert.equal(seen.paymentMethod, 'cash');
  assert.equal(seen.offerAmount, 500000);
  assert.equal(seen.comment, 'Please revive me');
});

test('POST /v1/requests rejects invalid offer server-side', async t => {
  let calls = 0;
  const app = makeApp({
    async createRequest() { calls += 1; },
    async getActiveRequest() { return null; },
    async cancelRequest() { throw new Error('not used'); }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: 'Bearer requester-token' },
    payload: { paymentMethod: 'cash', offerAmount: 499999 }
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error, 'INVALID_OFFER');
  assert.equal(calls, 0);
});

test('GET active and POST cancel are scoped to authenticated requester', async t => {
  const calls = [];
  const app = makeApp({
    async createRequest() { throw new Error('not used'); },
    async getActiveRequest(requesterId) {
      calls.push(['active', requesterId]);
      return { id: VALID_REQUEST_ID, requesterId, state: 'AVAILABLE' };
    },
    async cancelRequest(input) {
      calls.push(['cancel', input.requesterId, input.requestId]);
      return {
        cancelled: true,
        request: { id: input.requestId, state: 'CANCELLED' }
      };
    }
  });
  t.after(() => app.close());

  const active = await app.inject({
    method: 'GET',
    url: '/v1/requests/active',
    headers: { authorization: 'Bearer requester-token' }
  });
  assert.equal(active.statusCode, 200);

  const cancelled = await app.inject({
    method: 'POST',
    url: `/v1/requests/${VALID_REQUEST_ID}/cancel`,
    headers: { authorization: 'Bearer requester-token' }
  });
  assert.equal(cancelled.statusCode, 200);

  assert.deepEqual(calls, [
    ['active', 'requester-user-id'],
    ['cancel', 'requester-user-id', VALID_REQUEST_ID]
  ]);
});

test('POST cancel rejects malformed request ids before repository access', async t => {
  let calls = 0;
  const app = makeApp({
    async createRequest() { throw new Error('not used'); },
    async getActiveRequest() { return null; },
    async cancelRequest() { calls += 1; }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/requests/not-a-uuid/cancel',
    headers: { authorization: 'Bearer requester-token' }
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error, 'INVALID_REQUEST_ID');
  assert.equal(calls, 0);
});
