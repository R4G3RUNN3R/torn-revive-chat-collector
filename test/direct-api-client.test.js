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
  'checkRefund',
  'getProStatus',
  'startProTrial',
  'getProPlans',
  'createProInvoice',
  'getProInvoice',
  'deleteAccount'
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
  await api.getProStatus();
  await api.startProTrial();
  await api.getProPlans();
  await api.createProInvoice({ planId: 'monthly', currency: 'xanax' });
  await api.getProInvoice('66666666-6666-4666-8666-666666666666');
  await api.deleteAccount();

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
    ['POST', '/v1/transactions/tx%20id/check-refund'],
    ['GET', '/v1/pro/status'],
    ['POST', '/v1/pro/trial'],
    ['GET', '/v1/pro/plans'],
    ['POST', '/v1/pro/invoices'],
    ['GET', '/v1/pro/invoices/66666666-6666-4666-8666-666666666666'],
    ['DELETE', '/v1/account']
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
  assert.deepEqual(calls[23].body, { planId: 'monthly', currency: 'xanax' });
  assert.deepEqual(calls[25].body, { confirm: 'DELETE REVIVERELAY ACCOUNT' });
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


test('unified client preserves bounded server error codes and retryability', async () => {
  const direct = require('../src/direct-api-client');
  const cases = [
    [{ status:403, body:{ error:'REVIVER_PRO_REQUIRED', secret:'must-not-survive' } }, 'REVIVER_PRO_REQUIRED', false],
    [{ status:409, body:{ error:'REVIVE_ABILITY_PERMISSION_REQUIRED' } }, 'REVIVE_ABILITY_PERMISSION_REQUIRED', false],
    [{ status:422, body:{ error:'INVALID_INVOICE_REQUEST' } }, 'INVALID_INVOICE_REQUEST', false],
    [{ status:503, body:{ error:'TORN_UNAVAILABLE' } }, 'TORN_UNAVAILABLE', true]
  ];
  for (const [response, expectedCode, retryable] of cases) {
    const api=direct.createDirectApiClient({
      baseUrl:'https://reviverelay.example',getToken:()=> 'token',request:async()=>response
    });
    await assert.rejects(()=>api.getProStatus(),error=>{
      assert.equal(error.code,expectedCode);
      assert.equal(error.status,response.status);
      assert.equal(error.retryable,retryable);
      assert.equal(error.details && Object.hasOwn(error.details,'secret'),false);
      return true;
    });
  }

  const unsafe=direct.createDirectApiClient({
    baseUrl:'https://reviverelay.example',getToken:()=> 'token',
    request:async()=>({status:503,body:{error:'<script>alert(1)</script>',token:'leak'}})
  });
  await assert.rejects(()=>unsafe.getProStatus(),error=>{
    assert.equal(error.code,'SERVER_UNAVAILABLE');
    assert.equal(error.retryable,true);
    assert.deepEqual(error.details,{});
    return true;
  });
});

test('unified client validates invoice selection before transport', async () => {
  const direct=require('../src/direct-api-client');
  const calls=[];
  const api=direct.createDirectApiClient({
    baseUrl:'https://reviverelay.example',getToken:()=> 'token',
    request:async input=>{calls.push(input);return {status:200,body:{}};}
  });
  for (const payload of [
    {planId:'monthly',currency:'cash',expectedAmount:1},
    {planId:'monthly',currency:'cash',months:12},
    {planId:'monthly',currency:'cash',tornId:123},
    {planId:'not-a-plan',currency:'cash'},
    {planId:'monthly',currency:'gold'}
  ]) {
    await assert.rejects(()=>api.createProInvoice(payload),error=>error && error.code==='INVALID_INVOICE_SELECTION');
  }
  await assert.rejects(()=>api.getProInvoice(''),error=>error && error.code==='INVALID_INVOICE_ID');
  assert.equal(calls.length,0);
});
