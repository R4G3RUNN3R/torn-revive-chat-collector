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

const crypto = require('node:crypto');
const Fastify = require('fastify');
const fastifyRateLimit = require('@fastify/rate-limit');
const { bearerTokenRateLimitKey } = require('../../src/security/rate-limits');
const { registerStateRoute } = require('../../src/routes/state');
const { registerPlayerBadgeRoute } = require('../../src/routes/player-badge');

test('polling rate limit key is a SHA-256 digest of the bearer token, falling back to the IP', () => {
  const digest = crypto.createHash('sha256').update('secret-token', 'utf8').digest('hex');
  const key = bearerTokenRateLimitKey({ headers: { authorization: 'Bearer secret-token' }, ip: '198.51.100.7' });
  assert.equal(key, digest);
  assert.doesNotMatch(key, /secret-token/);
  assert.equal(bearerTokenRateLimitKey({ headers: {}, ip: '198.51.100.7' }), '198.51.100.7');
  assert.equal(bearerTokenRateLimitKey({ headers: { authorization: 'Basic abc' }, ip: '198.51.100.8' }), '198.51.100.8');
  assert.equal(RATE_LIMITS.STATE.keyGenerator, bearerTokenRateLimitKey);
  assert.equal(RATE_LIMITS.PLAYER_BADGE.keyGenerator, bearerTokenRateLimitKey);
  assert.equal(RATE_LIMITS.STATE.max, 30);
  assert.equal(RATE_LIMITS.PLAYER_BADGE.max, 60);
});

async function makePollingApp() {
  const app = Fastify();
  await app.register(fastifyRateLimit, { global: false });
  app.decorateRequest('reviveRelayUser', null);
  app.decorate('authenticate', async request => {
    request.reviveRelayUser = { sessionId: 's', userId: 'u', tornId: 1, name: 'N', roles: ['requester'] };
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

for (const [name, url, policy] of [['state', '/v1/state', RATE_LIMITS.STATE], ['player badge', '/v1/players/7/badge', RATE_LIMITS.PLAYER_BADGE]]) {
  test(`${name} polling is rate limited per bearer token, not per shared IP`, async t => {
    const app = await makePollingApp();
    t.after(() => app.close());
    const as = token => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

    for (let i = 0; i < policy.max; i += 1) {
      assert.equal((await as('token-a')).statusCode, 200, `request ${i + 1} should be allowed`);
    }
    assert.equal((await as('token-a')).statusCode, 429);
    assert.equal((await as('token-b')).statusCode, 200);
  });
}
