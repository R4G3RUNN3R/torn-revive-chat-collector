const test = require('node:test');
const assert = require('node:assert/strict');
const { RATE_LIMITS } = require('../../src/security/rate-limits');
const { buildApp } = require('../../src/app');

test('security policies cover the Stage 1 abuse-sensitive routes', () => {
  assert.deepEqual(RATE_LIMITS.AUTH_BIND, { max: 10, timeWindow: '1 minute' });
  assert.deepEqual(RATE_LIMITS.CANDIDATE_INGEST, { max: 120, timeWindow: '1 minute' });
  assert.deepEqual(RATE_LIMITS.REQUEST_WRITE, { max: 20, timeWindow: '1 minute' });
  assert.deepEqual(RATE_LIMITS.REVIVER_QUEUE, { max: 120, timeWindow: '1 minute' });
  assert.deepEqual(RATE_LIMITS.ACCEPT, { max: 60, timeWindow: '1 minute' });
});

test('auth binding is rate limited per trusted proxy client IP', async t => {
  let bindCalls = 0;
  const app = buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '88'.repeat(32),
      SESSION_TOKEN_PEPPER: 'rate-limit-pepper'
    },
    tornClient: {
      async getKeyInfo() {
        return {
          tornId: 123456,
          name: 'RateLimitTester',
          access: { level: 1 }
        };
      }
    },
    identityRepository: {
      async bindIdentity() {
        bindCalls += 1;
      }
    }
  });
  t.after(() => app.close());

  const payload = {
    apiKey: 'test-api-key',
    clientVersion: 'stage1-rate-limit-test'
  };

  for (let i = 0; i < 10; i += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/bind',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      payload
    });
    assert.equal(response.statusCode, 200, `request ${i + 1} should be allowed`);
  }

  const blocked = await app.inject({
    method: 'POST',
    url: '/v1/auth/bind',
    headers: { 'x-forwarded-for': '203.0.113.10' },
    payload
  });
  assert.equal(blocked.statusCode, 429);
  assert.equal(bindCalls, 10, 'rate-limited request must not reach the auth handler');

  const otherClient = await app.inject({
    method: 'POST',
    url: '/v1/auth/bind',
    headers: { 'x-forwarded-for': '203.0.113.11' },
    payload
  });
  assert.equal(otherClient.statusCode, 200);
  assert.equal(bindCalls, 11);
});

const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const fastifyRateLimit = require('@fastify/rate-limit');
const rateLimits = require('../../src/security/rate-limits');
const { registerStateRoute } = require('../../src/routes/state');
const { registerPlayerBadgeRoute } = require('../../src/routes/player-badge');

test('polling limits: per-session and per-IP ceiling definitions, no token-hash helper', () => {
  const { RATE_LIMITS } = rateLimits;
  assert.deepEqual(RATE_LIMITS.STATE, { max: 30, timeWindow: '1 minute' });
  assert.deepEqual(RATE_LIMITS.STATE_IP, { max: 120, timeWindow: '1 minute' });
  assert.deepEqual(RATE_LIMITS.PLAYER_BADGE, { max: 60, timeWindow: '1 minute' });
  assert.deepEqual(RATE_LIMITS.PLAYER_BADGE_IP, { max: 120, timeWindow: '1 minute' });
  assert.equal(rateLimits.bearerTokenRateLimitKey, undefined);
  const src = fs.readFileSync(path.join(__dirname, '../../src/security/rate-limits.js'), 'utf8');
  assert.doesNotMatch(src, /createHash|sha256|authorization/i);
});

const SESSIONS = { 'token-a': 'session-a', 'token-b': 'session-b', 'token-a2': 'session-a' };

async function makePollingApp() {
  const app = Fastify();
  await app.register(fastifyRateLimit, { global: false });
  app.decorateRequest('reviveRelayUser', null);
  app.decorate('authenticate', async (request, reply) => {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const sessionId = SESSIONS[token];
    if (!sessionId) return reply.code(401).send({ error: 'AUTH_REQUIRED' });
    request.reviveRelayUser = { sessionId, userId: 'u', tornId: 1, name: 'N', roles: ['requester'] };
  });
  await registerStateRoute(app, {
    requestRepository: { async getActiveRequest() { return null; } },
    transactionRepository: {
      async listOpenTransactionIdsForUser() { return []; },
      async getTransactionForUser() { return null; },
      async countAvailableRequests() { return 0; }
    },
    config: { SUBSCRIPTION_MODE: 'free' }
  });
  await registerPlayerBadgeRoute(app, {
    presenceRepository: { async getPlayerBadge(tornId) { return { tornId, requesterVerified: false, reviverVerified: false }; } }
  });
  return app;
}

for (const [name, url, session, ip] of [
  ['state', '/v1/state', rateLimits.RATE_LIMITS.STATE, rateLimits.RATE_LIMITS.STATE_IP],
  ['player badge', '/v1/players/7/badge', rateLimits.RATE_LIMITS.PLAYER_BADGE, rateLimits.RATE_LIMITS.PLAYER_BADGE_IP]
]) {
  const get = (app, token) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

  test(`${name}: a session is limited at its per-session max, other sessions are not`, async t => {
    const app = await makePollingApp();
    t.after(() => app.close());
    for (let i = 0; i < session.max; i += 1) {
      assert.equal((await get(app, 'token-a')).statusCode, 200, `request ${i + 1} should be allowed`);
    }
    const blocked = await get(app, 'token-a');
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().statusCode, 429);
    assert.match(blocked.json().message, /Rate limit exceeded, retry in/);
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    // a different token resolving to the same session shares the bucket
    assert.equal((await get(app, 'token-a2')).statusCode, 429);
    // a different session from the same IP has its own bucket
    assert.equal((await get(app, 'token-b')).statusCode, 200);
  });

  test(`${name}: rotating failing tokens are 401 until the per-IP ceiling returns 429`, async t => {
    const app = await makePollingApp();
    t.after(() => app.close());
    for (let i = 0; i < ip.max; i += 1) {
      assert.equal((await get(app, `fake-${i}`)).statusCode, 401, `request ${i + 1} should reach auth`);
    }
    assert.equal((await get(app, 'fake-over')).statusCode, 429);
    // the ceiling is per IP, so another IP is unaffected
    const other = await app.inject({ method: 'GET', url, remoteAddress: '198.51.100.9', headers: { authorization: 'Bearer fake-x' } });
    assert.equal(other.statusCode, 401);
  });
}
