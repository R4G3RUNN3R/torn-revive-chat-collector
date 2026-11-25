const test = require('node:test');
const assert = require('node:assert/strict');
const { STATE_PATH, BADGE_CACHE, createStateClient } = require('../src/lite/state-client');
const { DirectApiClientError } = require('../src/direct-api-client');

const BASE = 'https://reviverelay.voidsmithindustries.com/review';
const VERSION_A = '0123456789abcdef';
const VERSION_B = 'fedcba9876543210';

function stateBody(stateVersion = VERSION_A) {
  return {
    stateVersion,
    nextPollMs: 60000,
    me: { tornId: 1001, name: 'Patient', roles: ['requester'], verification: null },
    pro: { state: 'NONE' },
    activeRequest: null,
    activeTransactions: [],
    revivers: { online: 2 },
    queue: null
  };
}

function transport(responses) {
  const calls = [];
  const request = async input => {
    calls.push(input);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(input) : next;
  };
  return { calls, request };
}

function client(responses, options = {}) {
  const t = transport(responses);
  const api = createStateClient({
    baseUrl: `${BASE}/`,
    request: t.request,
    getToken: () => 'session-token',
    clientVersion: '1.0.0',
    releaseChannel: 'review',
    ...options
  });
  return { api, calls: t.calls };
}

test('GET /review/v1/state with the direct client headers and no If-None-Match on the first call', async () => {
  const { api, calls } = client([{ status: 200, body: stateBody(), responseText: '' }]);
  const result = await api.getState();
  assert.equal(STATE_PATH, '/v1/state');
  assert.deepEqual(calls, [{
    method: 'GET',
    url: `${BASE}/v1/state`,
    headers: {
      Accept: 'application/json',
      'X-ReviveRelay-Version': '1.0.0',
      'X-ReviveRelay-Channel': 'review',
      Authorization: 'Bearer session-token'
    }
  }]);
  assert.equal(result.notModified, false);
  assert.equal(result.snapshot.stateVersion, VERSION_A);
  assert.equal(api.lastStateVersion(), VERSION_A);
});

test('sends If-None-Match from the last stateVersion; 304 → notModified', async () => {
  const { api, calls } = client([
    { status: 200, body: stateBody(VERSION_A) },
    { status: 304, body: {}, responseText: '' },
    { status: 200, responseText: JSON.stringify(stateBody(VERSION_B)) }
  ]);
  await api.getState();
  const second = await api.getState();
  assert.equal(calls[1].headers['If-None-Match'], `"${VERSION_A}"`);
  assert.deepEqual(second, { notModified: true, stateVersion: VERSION_A });
  const third = await api.getState();
  assert.equal(calls[2].headers['If-None-Match'], `"${VERSION_A}"`);
  assert.equal(third.snapshot.stateVersion, VERSION_B);
  assert.equal(api.lastStateVersion(), VERSION_B);
});

test('no token → no Authorization header', async () => {
  const { api, calls } = client([{ status: 200, body: stateBody() }], { getToken: () => '' });
  await api.getState();
  assert.equal('Authorization' in calls[0].headers, false);
});

test('HTTP errors map through mapHttpError; transport errors become retryable NETWORK_ERROR', async () => {
  const { api } = client([
    { status: 401, body: { error: 'AUTH_REQUIRED' } },
    { status: 429, body: {} },
    { status: 503, body: {} },
    new Error('socket hang up'),
    new DirectApiClientError('NETWORK_ERROR', { retryable: true })
  ]);
  await assert.rejects(api.getState(), error => error instanceof DirectApiClientError && error.code === 'AUTH_REQUIRED' && error.status === 401 && !error.retryable);
  await assert.rejects(api.getState(), error => error.code === 'RATE_LIMITED' && error.retryable);
  await assert.rejects(api.getState(), error => error.code === 'SERVER_UNAVAILABLE' && error.retryable);
  await assert.rejects(api.getState(), error => error instanceof DirectApiClientError && error.code === 'NETWORK_ERROR' && error.retryable);
  await assert.rejects(api.getState(), error => error.code === 'NETWORK_ERROR');
  assert.equal(api.lastStateVersion(), null);
});

test('a malformed 200 or an unexpected 304 is rejected and never moves the version', async () => {
  const { api } = client([
    { status: 304, body: {} },
    { status: 200, body: { stateVersion: 'not-hex' } },
    { status: 200, body: stateBody(VERSION_A) },
    { status: 200, body: [] }
  ]);
  await assert.rejects(api.getState(), error => error.code === 'INVALID_STATE_RESPONSE');
  await assert.rejects(api.getState(), error => error.code === 'INVALID_STATE_RESPONSE');
  await api.getState();
  await assert.rejects(api.getState(), error => error.code === 'INVALID_STATE_RESPONSE');
  assert.equal(api.lastStateVersion(), VERSION_A);
});

test('getPlayerBadge fetches once and serves from cache for 10 minutes', async () => {
  let now = 0;
  const { api, calls } = client([
    { status: 200, body: { tornId: 42, requesterVerified: true, reviverVerified: 'yes' } },
    { status: 200, body: { tornId: 42, requesterVerified: false, reviverVerified: true } }
  ], { now: () => now });
  const first = await api.getPlayerBadge(42);
  assert.deepEqual(first, { tornId: 42, requesterVerified: true, reviverVerified: false });
  assert.equal(calls[0].url, `${BASE}/v1/players/42/badge`);
  now = BADGE_CACHE.ttlMs - 1;
  assert.equal(await api.getPlayerBadge('42'), first);
  assert.equal(calls.length, 1);
  now = BADGE_CACHE.ttlMs;
  const refreshed = await api.getPlayerBadge(42);
  assert.equal(calls.length, 2);
  assert.equal(refreshed.reviverVerified, true);
});

test('badge cache is an LRU bounded at 200 entries', async () => {
  assert.deepEqual(BADGE_CACHE, { ttlMs: 600000, maxEntries: 200 });
  const responder = input => ({ status: 200, body: { requesterVerified: true, reviverVerified: false, url: input.url } });
  const { api: lru, calls: lruCalls } = client(Array.from({ length: 203 }, () => responder), { now: () => 0 });
  for (let id = 1; id <= 200; id += 1) await lru.getPlayerBadge(id);
  assert.equal(lru.badgeCacheSize(), 200);
  await lru.getPlayerBadge(1);
  assert.equal(lruCalls.length, 200);
  await lru.getPlayerBadge(201);
  assert.equal(lru.badgeCacheSize(), 200);
  await lru.getPlayerBadge(1);
  assert.equal(lruCalls.length, 201);
  await lru.getPlayerBadge(2);
  assert.equal(lruCalls.length, 202);
});

test('getPlayerBadge rejects invalid ids without a request and maps HTTP errors', async () => {
  const { api, calls } = client([{ status: 429, body: {} }]);
  for (const bad of [0, '-1', 'abc', '0123', null, '1234567890123']) {
    await assert.rejects(api.getPlayerBadge(bad), error => error.code === 'INVALID_TORN_ID');
  }
  assert.equal(calls.length, 0);
  await assert.rejects(api.getPlayerBadge(7), error => error.code === 'RATE_LIMITED');
  assert.equal(api.badgeCacheSize(), 0);
});

test('reset forgets the version and the badge cache', async () => {
  const { api, calls } = client([{ status: 200, body: stateBody() }, { status: 200, body: stateBody() }]);
  await api.getState();
  api.reset();
  await api.getState();
  assert.equal('If-None-Match' in calls[1].headers, false);
});

test('constructor validation', () => {
  assert.throws(() => createStateClient({ baseUrl: 'ftp://x', request: () => {} }), /baseUrl/);
  assert.throws(() => createStateClient({ baseUrl: BASE }), /request transport/);
});
