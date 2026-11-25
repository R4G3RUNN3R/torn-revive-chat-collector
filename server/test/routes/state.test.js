const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const fastifyRateLimit = require('@fastify/rate-limit');
const { registerStateRoute, STATE_POLL_MS } = require('../../src/routes/state');

const NOW = new Date('2026-11-25T12:00:00Z');
const REQUESTER = { sessionId: 's1', userId: 'user-1', tornId: 111, name: 'Req', roles: ['requester'] };
const REVIVER = { sessionId: 's2', userId: 'user-2', tornId: 222, name: 'Rev', roles: ['requester', 'reviver'] };

async function makeApp({ user = REQUESTER, activeRequest = null, openTransactionId = null, transaction = null, queue = [], online = 3, presence = true } = {}) {
  const app = Fastify();
  await app.register(fastifyRateLimit, { global: false });
  app.decorateRequest('reviveRelayUser', null);
  app.decorate('authenticate', async request => { request.reviveRelayUser = user; });
  const calls = { online: [] };
  await registerStateRoute(app, {
    requestRepository: { async getActiveRequest(userId) { assert.equal(userId, user.userId); return activeRequest; } },
    transactionRepository: {
      async findOpenTransactionIdForUser() { return openTransactionId; },
      async getTransactionForUser(input) { assert.deepEqual(input, { transactionId: openTransactionId, userId: user.userId }); return transaction; },
      async listAvailableRequests() { return queue; }
    },
    entitlementRepository: { async getStatus() { return { state: 'NONE', trialEligible: true, trialStartedAt: null, validUntil: null }; } },
    presenceRepository: presence ? { async countOnlineRevivers(input) { calls.online.push(input); return online; } } : null,
    config: { SUBSCRIPTION_MODE: 'review', PRO_RECEIVER_TORN_ID: 3877028 },
    clock: () => NOW
  });
  return { app, calls };
}

test('idle requester gets a 60s poll, online count and no queue', async t => {
  const { app, calls } = await makeApp();
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/state' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.nextPollMs, STATE_POLL_MS.IDLE);
  assert.deepEqual(body.me, { tornId: 111, name: 'Req', roles: ['requester'] });
  assert.equal(body.activeRequest, null);
  assert.equal(body.activeTransaction, null);
  assert.deepEqual(body.revivers, { online: 3 });
  assert.equal(body.queue, null);
  assert.match(body.stateVersion, /^[0-9a-f]{16}$/);
  assert.equal(response.headers.etag, `"${body.stateVersion}"`);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(calls.online, [{ now: NOW, requireEntitlement: true, ownerTornId: 3877028 }]);
  assert.ok(body.pro);
});

test('active request or transaction polls every 5s and includes both', async t => {
  const activeRequest = { id: 'r-1', requesterId: 'user-1', state: 'AVAILABLE', paymentMethod: 'cash', offerAmount: 1000000, createdAt: new Date('2026-11-25T11:59:00Z'), transactionId: 'tx-1', comment: null };
  const transaction = { id: 'tx-1', state: 'WAITING_FOR_PAYMENT', participantRole: 'requester' };
  const { app } = await makeApp({ activeRequest, openTransactionId: 'tx-1', transaction });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.equal(body.nextPollMs, STATE_POLL_MS.ACTIVE);
  assert.deepEqual(body.activeRequest, { id: 'r-1', state: 'AVAILABLE', paymentMethod: 'cash', offerAmount: 1000000, createdAt: '2026-11-25T11:59:00.000Z', transactionId: 'tx-1' });
  assert.deepEqual(body.activeTransaction, transaction);
});

test('reviver without a transaction gets queue count and a 20s poll', async t => {
  const { app } = await makeApp({ user: REVIVER, queue: [{ id: 'a' }, { id: 'b' }] });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.deepEqual(body.queue, { count: 2 });
  assert.equal(body.nextPollMs, STATE_POLL_MS.REVIVER);
});

test('matching If-None-Match returns 304 with no body', async t => {
  const { app } = await makeApp();
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/v1/state' });
  const second = await app.inject({ method: 'GET', url: '/v1/state', headers: { 'if-none-match': first.headers.etag } });
  assert.equal(second.statusCode, 304);
  assert.equal(second.body, '');
});

test('state changes produce a different version', async t => {
  const a = await makeApp({ online: 3 });
  const b = await makeApp({ online: 4 });
  t.after(() => Promise.all([a.app.close(), b.app.close()]));
  const va = (await a.app.inject({ method: 'GET', url: '/v1/state' })).json().stateVersion;
  const vb = (await b.app.inject({ method: 'GET', url: '/v1/state' })).json().stateVersion;
  assert.notEqual(va, vb);
});

test('without a presence repository the online count is null', async t => {
  const { app } = await makeApp({ presence: false });
  t.after(() => app.close());
  assert.deepEqual((await app.inject({ method: 'GET', url: '/v1/state' })).json().revivers, { online: null });
});
