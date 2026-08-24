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
