const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const fastifyRateLimit = require('@fastify/rate-limit');
const { registerStateRoute, STATE_POLL_MS } = require('../../src/routes/state');

const NOW = new Date('2026-11-25T12:00:00Z');
const REQUESTER = { sessionId: 's1', userId: 'user-1', tornId: 111, name: 'Req', roles: ['requester'] };
const REVIVER = { sessionId: 's2', userId: 'user-2', tornId: 222, name: 'Rev', roles: ['requester', 'reviver'] };

async function makeApp({ user = REQUESTER, activeRequest = null, openTransactionIds = [], transactions = {}, queue = [], online = 3, presence = true, proState = 'NONE', mode = 'review', verificationStatus, verificationRepository = verificationStatus !== undefined } = {}) {
  const app = Fastify();
  await app.register(fastifyRateLimit, { global: false });
  app.decorateRequest('reviveRelayUser', null);
  app.decorate('authenticate', async request => { request.reviveRelayUser = user; });
  const calls = { online: [], count: 0 };
  await registerStateRoute(app, {
    requestRepository: { async getActiveRequest(userId) { assert.equal(userId, user.userId); return activeRequest; } },
    transactionRepository: {
      async listOpenTransactionIdsForUser(userId) { assert.equal(userId, user.userId); return openTransactionIds; },
      async getTransactionForUser({ transactionId, userId }) { assert.equal(userId, user.userId); return transactions[transactionId] || null; },
      async countAvailableRequests() { calls.count += 1; return queue.length; }
    },
    entitlementRepository: { async getStatus() { return { state: proState, trialEligible: true, trialStartedAt: null, validUntil: null }; } },
    presenceRepository: presence ? { async countOnlineRevivers(input) { calls.online.push(input); return online; } } : null,
    verificationCredentialRepository: verificationRepository
      ? { async getStatus(userId) { assert.equal(userId, user.userId); return verificationStatus === undefined ? null : verificationStatus; } }
      : null,
    config: { SUBSCRIPTION_MODE: mode, PRO_RECEIVER_TORN_ID: 3877028 },
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
  assert.deepEqual(body.me, { tornId: 111, name: 'Req', roles: ['requester'], verification: null });
  assert.equal(body.activeRequest, null);
  assert.deepEqual(body.activeTransactions, []);
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
  const { app } = await makeApp({ activeRequest, openTransactionIds: ['tx-1'], transactions: { 'tx-1': transaction } });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.equal(body.nextPollMs, STATE_POLL_MS.ACTIVE);
  assert.deepEqual(body.activeRequest, { id: 'r-1', state: 'AVAILABLE', paymentMethod: 'cash', offerAmount: 1000000, createdAt: '2026-11-25T11:59:00.000Z', transactionId: 'tx-1' });
  assert.deepEqual(body.activeTransactions, [transaction]);
  assert.equal('activeTransaction' in body, false);
});

test('reviver without a transaction gets queue count and a 20s poll', async t => {
  const { app } = await makeApp({ user: REVIVER, queue: [{ id: 'a' }, { id: 'b' }], proState: 'ACTIVE' });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.deepEqual(body.queue, { count: 2 });
  assert.equal(body.nextPollMs, STATE_POLL_MS.REVIVER);
});

test('reviver without Pro gets no queue count', async t => {
  const { app, calls } = await makeApp({ user: REVIVER, queue: [{ id: 'a' }], proState: 'NONE', mode: 'review' });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.equal(body.queue, null);
  assert.equal(calls.count, 0);
  assert.equal(body.nextPollMs, STATE_POLL_MS.REVIVER);
});

test('free mode shows the queue count without Pro', async t => {
  const { app } = await makeApp({ user: REVIVER, queue: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], proState: 'NONE', mode: 'free' });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.deepEqual(body.queue, { count: 3 });
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

test('all open transactions are returned, nearest deadline first', async t => {
  const asReviver = { id: 'tx-b', state: 'WAITING_FOR_REVIVE', participantRole: 'reviver', paymentDeadline: null, reviveDeadline: '2026-11-25T12:20:00.000Z', retryResponseDeadline: null, refundDeadline: null };
  const asRequester = { id: 'tx-a', state: 'WAITING_FOR_PAYMENT', participantRole: 'requester', paymentDeadline: '2026-11-25T12:10:00.000Z', reviveDeadline: '2026-11-25T12:30:00.000Z', retryResponseDeadline: null, refundDeadline: null };
  const noDeadline = { id: 'tx-0', state: 'VERIFICATION_HOLD', participantRole: 'reviver', paymentDeadline: null, reviveDeadline: null, retryResponseDeadline: null, refundDeadline: null };
  const { app } = await makeApp({
    user: REVIVER,
    proState: 'ACTIVE',
    openTransactionIds: ['tx-0', 'tx-b', 'tx-a'],
    transactions: { 'tx-0': noDeadline, 'tx-b': asReviver, 'tx-a': asRequester }
  });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.deepEqual(body.activeTransactions.map(entry => entry.id), ['tx-a', 'tx-b', 'tx-0']);
  assert.equal(body.nextPollMs, STATE_POLL_MS.ACTIVE);
});

test('deadline ties are broken by transaction id', async t => {
  const deadline = '2026-11-25T12:10:00.000Z';
  const { app } = await makeApp({
    openTransactionIds: ['tx-2', 'tx-1'],
    transactions: {
      'tx-2': { id: 'tx-2', paymentDeadline: deadline, reviveDeadline: null, retryResponseDeadline: null, refundDeadline: null },
      'tx-1': { id: 'tx-1', paymentDeadline: null, reviveDeadline: null, retryResponseDeadline: null, refundDeadline: deadline }
    }
  });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.deepEqual(body.activeTransactions.map(entry => entry.id), ['tx-1', 'tx-2']);
});

test('a reviver with an open transaction polls every 5s', async t => {
  const transaction = { id: 'tx-r', state: 'WAITING_FOR_REVIVE', participantRole: 'reviver', paymentDeadline: null, reviveDeadline: '2026-11-25T12:15:00.000Z', retryResponseDeadline: null, refundDeadline: null };
  const { app } = await makeApp({ user: REVIVER, proState: 'ACTIVE', openTransactionIds: ['tx-r'], transactions: { 'tx-r': transaction } });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.equal(body.activeRequest, null);
  assert.deepEqual(body.activeTransactions, [transaction]);
  assert.equal(body.nextPollMs, STATE_POLL_MS.ACTIVE);
});

function credentialStatus({ usable = true, requester = false, reviver = false } = {}) {
  return {
    id: 'cred-1',
    purpose: 'transaction_verification',
    capabilities: { requester, reviver },
    accessScope: {},
    lastValidatedAt: NOW,
    usable,
    unusableReason: usable ? null : 'TORN_INVALID_KEY'
  };
}

test('me.verification reports usable credential capabilities', async t => {
  const { app } = await makeApp({ user: REVIVER, verificationStatus: credentialStatus({ requester: true, reviver: true }) });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.deepEqual(body.me.verification, { usable: true, requester: true, reviver: true });
});

test('me.verification reports no capability while the credential is unusable', async t => {
  const { app } = await makeApp({ verificationStatus: credentialStatus({ usable: false, requester: true }) });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.deepEqual(body.me.verification, { usable: false, requester: false, reviver: false });
});

test('me.verification is null without a credential or without a repository', async t => {
  const none = await makeApp({ verificationStatus: null });
  const noRepo = await makeApp();
  t.after(() => Promise.all([none.app.close(), noRepo.app.close()]));
  assert.equal((await none.app.inject({ method: 'GET', url: '/v1/state' })).json().me.verification, null);
  assert.equal((await noRepo.app.inject({ method: 'GET', url: '/v1/state' })).json().me.verification, null);
});

test('verification changes produce a different state version', async t => {
  const a = await makeApp({ verificationStatus: credentialStatus({ requester: true }) });
  const b = await makeApp({ verificationStatus: credentialStatus({ requester: true, usable: false }) });
  t.after(() => Promise.all([a.app.close(), b.app.close()]));
  const va = (await a.app.inject({ method: 'GET', url: '/v1/state' })).json().stateVersion;
  const vb = (await b.app.inject({ method: 'GET', url: '/v1/state' })).json().stateVersion;
  assert.notEqual(va, vb);
});

test('weak If-None-Match form of the current tag returns 304', async t => {
  const { app } = await makeApp();
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/v1/state' });
  const second = await app.inject({ method: 'GET', url: '/v1/state', headers: { 'if-none-match': `W/${first.headers.etag}` } });
  assert.equal(second.statusCode, 304);
  assert.equal(second.body, '');
});

test('If-None-Match list containing the current tag returns 304', async t => {
  const { app } = await makeApp();
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/v1/state' });
  const header = `"0000000000000000",  W/"1111111111111111" ,${first.headers.etag}`;
  const second = await app.inject({ method: 'GET', url: '/v1/state', headers: { 'if-none-match': header } });
  assert.equal(second.statusCode, 304);
});

test('If-None-Match * returns 304', async t => {
  const { app } = await makeApp();
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/state', headers: { 'if-none-match': '*' } });
  assert.equal(response.statusCode, 304);
});

test('non-matching If-None-Match list returns 200 with the state body', async t => {
  const { app } = await makeApp();
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/state', headers: { 'if-none-match': '"0000000000000000", W/"1111111111111111"' } });
  assert.equal(response.statusCode, 200);
  assert.match(response.json().stateVersion, /^[0-9a-f]{16}$/);
});

test('canonical owner reviver sees the queue count in review mode without stored Pro', async t => {
  const owner = { sessionId: 's3', userId: 'user-3', tornId: 3877028, name: 'Owner', roles: ['requester', 'reviver'] };
  const { app, calls } = await makeApp({ user: owner, queue: [{ id: 'a' }, { id: 'b' }], proState: 'NONE', mode: 'review' });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.equal(body.pro.state, 'OWNER');
  assert.deepEqual(body.queue, { count: 2 });
  assert.equal(calls.count, 1);
});

test('trial reviver sees the queue count in review mode', async t => {
  const { app, calls } = await makeApp({ user: REVIVER, queue: [{ id: 'a' }], proState: 'TRIAL', mode: 'review' });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.equal(body.pro.state, 'TRIAL');
  assert.deepEqual(body.queue, { count: 1 });
  assert.equal(calls.count, 1);
});
