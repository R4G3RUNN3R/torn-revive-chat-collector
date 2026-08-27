const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ApiClientError,
  createApiClient,
  createGmRequestAdapter,
  createOutboxEntry,
  nextRetryDelay,
  drainCandidateOutbox
} = require('../src/api-client');

function fakeRequest(responses, calls) {
  return async (request) => {
    calls.push(request);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next || { status: 200, body: {} };
  };
}

test('bind stores returned session token for subsequent authenticated calls', async () => {
  const calls = [];
  const api = createApiClient({
    baseUrl: 'https://relay.example/',
    getToken: () => '',
    request: fakeRequest([
      { status: 200, body: { token: 'session-secret', user: { tornId: 123, name: 'Tester' } } },
      { status: 201, body: { duplicate: false, candidate: { id: 'c1' } } }
    ], calls)
  });

  await api.bind('torn-api-key', '0.3.0');
  await api.submitCandidate({ channelId: 'public_global', senderName: 'Player', text: 'need revive', classifierVersion: '2.0.0', score: 80 });

  assert.equal(calls[0].url, 'https://relay.example/v1/auth/bind');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.deepEqual(calls[0].body, { apiKey: 'torn-api-key', clientVersion: '0.3.0' });
  assert.equal(calls[1].headers.Authorization, 'Bearer session-secret');
});

test('pre-existing session token is attached to authenticated operations', async () => {
  const calls = [];
  const api = createApiClient({
    baseUrl: 'https://relay.example',
    getToken: () => 'stored-session',
    request: fakeRequest([{ status: 200, body: { request: null } }], calls)
  });

  await api.getActiveRequest();
  assert.equal(calls[0].headers.Authorization, 'Bearer stored-session');
  assert.equal(calls[0].url, 'https://relay.example/v1/requests/active');
});

test('client maps authentication, conflict, validation, rate-limit and server errors', async () => {
  const cases = [
    [{ status: 401, body: { error: 'NO_SESSION' } }, 'AUTH_REQUIRED', false],
    [{ status: 409, body: { error: 'REQUEST_COMMITTED' } }, 'CONFLICT', false],
    [{ status: 422, body: { error: 'INVALID_OFFER' } }, 'INVALID_REQUEST', false],
    [{ status: 429, body: { error: 'RATE_LIMITED' } }, 'RATE_LIMITED', true],
    [{ status: 503, body: { error: 'TORN_UNAVAILABLE' } }, 'SERVER_UNAVAILABLE', true]
  ];

  for (const [response, code, retryable] of cases) {
    const api = createApiClient({
      baseUrl: 'https://relay.example',
      getToken: () => 'stored-session',
      request: async () => response
    });

    await assert.rejects(
      () => api.getActiveRequest(),
      (error) => error instanceof ApiClientError && error.code === code && error.retryable === retryable
    );
  }
});

test('network transport failures become retryable typed errors without exposing secrets', async () => {
  const api = createApiClient({
    baseUrl: 'https://relay.example',
    getToken: () => 'stored-session-secret',
    request: async () => { throw new Error('socket closed'); }
  });

  await assert.rejects(
    () => api.submitCandidate({ text: 'need revive' }),
    (error) => {
      assert.equal(error instanceof ApiClientError, true);
      assert.equal(error.code, 'NETWORK_ERROR');
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /stored-session-secret/);
      return true;
    }
  );
});

test('API methods use the Stage 1 route contract', async () => {
  const calls = [];
  const api = createApiClient({
    baseUrl: 'https://relay.example',
    getToken: () => 'token',
    request: fakeRequest([
      { status: 200, body: {} },
      { status: 201, body: {} },
      { status: 200, body: {} },
      { status: 200, body: {} },
      { status: 200, body: {} }
    ], calls)
  });

  await api.submitCandidate({ text: 'x' });
  await api.createRequest({ paymentMethod: 'cash', offerAmount: 500000 });
  await api.getActiveRequest();
  await api.cancelRequest('123e4567-e89b-12d3-a456-426614174000');
  await api.getMe();

  assert.deepEqual(calls.map((call) => [call.method, new URL(call.url).pathname]), [
    ['POST', '/v1/candidates'],
    ['POST', '/v1/requests'],
    ['GET', '/v1/requests/active'],
    ['POST', '/v1/requests/123e4567-e89b-12d3-a456-426614174000/cancel'],
    ['GET', '/v1/me']
  ]);
});

test('GM adapter serializes JSON and parses successful JSON response', async () => {
  const calls = [];
  const request = createGmRequestAdapter((options) => {
    calls.push(options);
    options.onload({ status: 201, responseText: '{"duplicate":true}' });
  });

  const result = await request({
    method: 'POST',
    url: 'https://relay.example/v1/candidates',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: { text: 'need revive' }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].data, '{"text":"need revive"}');
  assert.equal(calls[0].timeout, 20_000);
  assert.deepEqual(result, { status: 201, body: { duplicate: true } });
});

test('GM adapter rejects network and timeout callbacks without embedding request secrets', async () => {
  for (const callback of ['onerror', 'ontimeout']) {
    const request = createGmRequestAdapter((options) => options[callback]());
    await assert.rejects(
      () => request({
        method: 'GET',
        url: 'https://relay.example/v1/me',
        headers: { Authorization: 'Bearer do-not-leak' }
      }),
      (error) => {
        assert.equal(error instanceof Error, true);
        assert.doesNotMatch(error.message, /do-not-leak/);
        return true;
      }
    );
  }
});

test('candidate retry schedule is bounded at 5s, 15s, 30s and 60s', () => {
  assert.equal(nextRetryDelay(1), 5_000);
  assert.equal(nextRetryDelay(2), 15_000);
  assert.equal(nextRetryDelay(3), 30_000);
  assert.equal(nextRetryDelay(4), 60_000);
  assert.equal(nextRetryDelay(5), 60_000);
  assert.equal(nextRetryDelay(99), 60_000);
});

test('outbox entry contains stable queue metadata without mutating candidate payload', () => {
  const candidate = { channelId: 'public_hospital', text: 'rev?' };
  const entry = createOutboxEntry(candidate, { now: 10_000, id: 'queue-1' });

  assert.deepEqual(entry, {
    id: 'queue-1',
    candidate,
    attempts: 0,
    nextAttemptAt: 10_000
  });
  assert.notEqual(entry.candidate, candidate);
});

test('outbox does not submit while Torn is inactive', async () => {
  const entries = [createOutboxEntry({ text: 'need rev' }, { now: 1_000, id: 'one' })];
  let submissions = 0;

  const result = await drainCandidateOutbox({
    entries,
    now: 10_000,
    isActive: () => false,
    submitCandidate: async () => { submissions += 1; }
  });

  assert.equal(submissions, 0);
  assert.equal(result.pending.length, 1);
  assert.equal(result.delivered.length, 0);
});

test('successful and server-duplicate candidate submissions are removed from outbox', async () => {
  const entries = [
    createOutboxEntry({ text: 'one' }, { now: 1_000, id: 'one' }),
    createOutboxEntry({ text: 'two' }, { now: 1_000, id: 'two' })
  ];

  const result = await drainCandidateOutbox({
    entries,
    now: 10_000,
    isActive: () => true,
    submitCandidate: async (candidate) => candidate.text === 'two'
      ? { duplicate: true }
      : { duplicate: false }
  });

  assert.equal(result.pending.length, 0);
  assert.deepEqual(result.delivered.map((entry) => entry.id), ['one', 'two']);
});

test('retryable candidate failure is rescheduled and non-retryable failure is dead-lettered', async () => {
  const retryable = createOutboxEntry({ text: 'retry' }, { now: 1_000, id: 'retry' });
  const invalid = createOutboxEntry({ text: 'invalid' }, { now: 1_000, id: 'invalid' });

  const result = await drainCandidateOutbox({
    entries: [retryable, invalid],
    now: 10_000,
    isActive: () => true,
    submitCandidate: async (candidate) => {
      if (candidate.text === 'retry') throw new ApiClientError('SERVER_UNAVAILABLE', { retryable: true });
      throw new ApiClientError('INVALID_REQUEST', { retryable: false });
    }
  });

  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].id, 'retry');
  assert.equal(result.pending[0].attempts, 1);
  assert.equal(result.pending[0].nextAttemptAt, 15_000);
  assert.deepEqual(result.deadLetter.map((entry) => entry.id), ['invalid']);
});


test('Stage 3 protected marketplace API methods use exact server routes and never invent state payloads', async () => {
  const calls=[];
  const responses=Array.from({length:12},()=>({status:200,body:{}}));
  const api=createApiClient({baseUrl:'https://relay.example',getToken:()=> 'session',request:fakeRequest(responses,calls)});
  await api.getVerificationCredential();
  await api.bindVerificationCredential('verification-key');
  await api.revokeVerificationCredential();
  await api.registerReviver();
  await api.getReviverQueue();
  await api.acceptRequest('123e4567-e89b-12d3-a456-426614174000');
  await api.getTransaction('223e4567-e89b-12d3-a456-426614174000');
  await api.checkPayment('223e4567-e89b-12d3-a456-426614174000');
  await api.requestRetry('223e4567-e89b-12d3-a456-426614174000');
  await api.respondRetry('223e4567-e89b-12d3-a456-426614174000','accept');
  await api.requestRefund('223e4567-e89b-12d3-a456-426614174000');
  await api.checkRefund('223e4567-e89b-12d3-a456-426614174000');

  assert.deepEqual(calls.map(c=>[c.method,new URL(c.url).pathname,c.body]),[
    ['GET','/v1/verification-credential',undefined],
    ['POST','/v1/verification-credential',{apiKey:'verification-key'}],
    ['DELETE','/v1/verification-credential',undefined],
    ['POST','/v1/reviver/register',undefined],
    ['GET','/v1/reviver/queue',undefined],
    ['POST','/v1/requests/123e4567-e89b-12d3-a456-426614174000/accept',undefined],
    ['GET','/v1/transactions/223e4567-e89b-12d3-a456-426614174000',undefined],
    ['POST','/v1/transactions/223e4567-e89b-12d3-a456-426614174000/check-payment',{}],
    ['POST','/v1/transactions/223e4567-e89b-12d3-a456-426614174000/retry-request',{}],
    ['POST','/v1/transactions/223e4567-e89b-12d3-a456-426614174000/retry-response',{decision:'accept'}],
    ['POST','/v1/transactions/223e4567-e89b-12d3-a456-426614174000/request-refund',{}],
    ['POST','/v1/transactions/223e4567-e89b-12d3-a456-426614174000/check-refund',{}]
  ]);
  assert.equal(calls.some(c=>c.body && Object.hasOwn(c.body,'state')),false);
});

test('retry response client rejects any value other than accept or decline before network access', async () => {
  let calls=0;
  const api=createApiClient({baseUrl:'https://relay.example',getToken:()=> 'session',request:async()=>{calls+=1;return {status:200,body:{}};}});
  assert.throws(()=>api.respondRetry('223e4567-e89b-12d3-a456-426614174000','COMPLETED'),/accept or decline/i);
  assert.equal(calls,0);
});

test('API client sends version/channel headers and maps HTTP 426 explicitly', async () => {
  const calls=[];
  const api=createApiClient({baseUrl:'https://relay.example',getToken:()=>'',clientVersion:'0.4.0',releaseChannel:'manual',request:fakeRequest([{status:426,body:{error:'CLIENT_UPDATE_REQUIRED',minimumVersion:'0.4.1'}}],calls)});
  await assert.rejects(()=>api.createRequest({paymentMethod:'cash',offerAmount:500000}), error => error instanceof ApiClientError && error.code==='CLIENT_UPDATE_REQUIRED' && error.status===426);
  assert.equal(calls[0].headers['X-ReviveRelay-Version'],'0.4.0');
  assert.equal(calls[0].headers['X-ReviveRelay-Channel'],'manual');
});

test('client version manifest route is fetched without requiring authentication', async () => {
  const calls=[]; const api=createApiClient({baseUrl:'https://relay.example',getToken:()=> 'secret',clientVersion:'0.4.0',releaseChannel:'manual',request:fakeRequest([{status:200,body:{latestVersion:'0.4.0'}}],calls)});
  await api.getClientVersionManifest();
  assert.equal(calls[0].url,'https://relay.example/v1/client/version');
  assert.equal(calls[0].headers.Authorization,undefined);
});


test('shared public candidate feed uses the authenticated recent-candidates route', async () => {
  const calls = [];
  const api = createApiClient({
    baseUrl: 'https://relay.example',
    getToken: () => 'session',
    request: fakeRequest([{ status: 200, body: { candidates: [] } }], calls)
  });
  await api.getRecentCandidates();
  assert.deepEqual(calls.map(c => [c.method, new URL(c.url).pathname, c.body]), [
    ['GET', '/v1/candidates/recent', undefined]
  ]);
});
