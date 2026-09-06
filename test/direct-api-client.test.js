const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const REQUIRED_METHODS = [
  'bind',
  'createRequest',
  'getActiveRequest',
  'cancelRequest',
  'getMe',
  'getClientVersionManifest',
  'submitTelemetry',
  'getVerificationCredential',
  'bindVerificationCredential',
  'revokeVerificationCredential',
  'getReviverEligibility',
  'registerReviver',
  'getReviverQueue',
  'acceptRequest',
  'getTransaction',
  'checkPayment',
  'requestRetry',
  'respondRetry',
  'requestRefund',
  'checkRefund'
];

test('direct API client exposes only the direct marketplace/session surface', () => {
  const direct = require('../src/direct-api-client');
  assert.equal(typeof direct.createDirectApiClient, 'function');
  assert.equal(typeof direct.createGmRequestAdapter, 'function');

  const calls = [];
  const api = direct.createDirectApiClient({
    baseUrl: 'https://reviverelay.example',
    getToken: () => 'session-token',
    request: async request => {
      calls.push(request);
      return { status: 200, body: {} };
    },
    clientVersion: '0.5.0',
    releaseChannel: 'manual'
  });

  assert.deepEqual(Object.keys(api).sort(), [...REQUIRED_METHODS].sort());
});


test('direct API client maps the marketplace routes and carries the bound session', async () => {
  const direct = require('../src/direct-api-client');
  const calls = [];
  const api = direct.createDirectApiClient({
    baseUrl: 'https://reviverelay.example/',
    getToken: () => '',
    request: async request => {
      calls.push(request);
      if (request.url.endsWith('/v1/auth/bind')) return { status: 200, body: { token: 'bound-session' } };
      return { status: 200, body: {} };
    },
    clientVersion: '0.5.0',
    releaseChannel: 'manual'
  });

  await api.bind('identity-key', '0.5.0');
  await api.createRequest({ paymentMethod: 'cash', offerAmount: 500000, comment: '' });
  await api.getActiveRequest();
  await api.cancelRequest('request id');
  await api.getMe();
  await api.getClientVersionManifest();
  await api.submitTelemetry([]);
  await api.getVerificationCredential();
  await api.bindVerificationCredential('restricted-key');
  await api.revokeVerificationCredential();
  await api.getReviverEligibility();
  await api.registerReviver();
  await api.getReviverQueue();
  await api.acceptRequest('request id');
  await api.getTransaction('tx id');
  await api.checkPayment('tx id');
  await api.requestRetry('tx id');
  await api.respondRetry('tx id', 'accept');
  await api.requestRefund('tx id');
  await api.checkRefund('tx id');

  assert.deepEqual(calls.map(call => [call.method, new URL(call.url).pathname]), [
    ['POST', '/v1/auth/bind'],
    ['POST', '/v1/requests'],
    ['GET', '/v1/requests/active'],
    ['POST', '/v1/requests/request%20id/cancel'],
    ['GET', '/v1/me'],
    ['GET', '/v1/client/version'],
    ['POST', '/v1/telemetry/errors'],
    ['GET', '/v1/verification-credential'],
    ['POST', '/v1/verification-credential'],
    ['DELETE', '/v1/verification-credential'],
    ['GET', '/v1/reviver/eligibility'],
    ['POST', '/v1/reviver/register'],
    ['GET', '/v1/reviver/queue'],
    ['POST', '/v1/requests/request%20id/accept'],
    ['GET', '/v1/transactions/tx%20id'],
    ['POST', '/v1/transactions/tx%20id/check-payment'],
    ['POST', '/v1/transactions/tx%20id/retry-request'],
    ['POST', '/v1/transactions/tx%20id/retry-response'],
    ['POST', '/v1/transactions/tx%20id/request-refund'],
    ['POST', '/v1/transactions/tx%20id/check-refund']
  ]);

  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[5].headers.Authorization, undefined);
  for (const [index, call] of calls.entries()) {
    if (index === 0 || index === 5) continue;
    assert.equal(call.headers.Authorization, 'Bearer bound-session');
    assert.equal(call.headers['X-ReviveRelay-Version'], '0.5.0');
    assert.equal(call.headers['X-ReviveRelay-Channel'], 'manual');
  }
  assert.deepEqual(calls[0].body, { apiKey: 'identity-key', clientVersion: '0.5.0' });
  assert.deepEqual(calls[17].body, { decision: 'accept' });
});

test('direct API client contains no chat candidate or retry-outbox machinery', () => {
  const source = fs.readFileSync('src/direct-api-client.js', 'utf8');
  for (const forbidden of [
    '/v1/candidates',
    'submitCandidate',
    'candidateOutbox',
    'createOutboxEntry',
    'drainCandidateOutbox',
    'nextRetryDelay'
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('0.5.0 runtime consumes the direct API client global only', () => {
  const source = fs.readFileSync('torn-revive-chat-collector.user.js', 'utf8');
  assert.match(source, /ReviveRelayDirectApiClient/);
  assert.doesNotMatch(source, /ReviveRelayApiClient/);
});
