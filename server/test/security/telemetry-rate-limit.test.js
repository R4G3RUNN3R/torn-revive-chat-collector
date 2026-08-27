const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

const baseError = {
  component: 'client',
  version: '0.4.0',
  severity: 'high',
  errorName: 'TypeError',
  message: 'boom',
  stack: 'at render (ui.js:1:1)',
  context: { operation: 'render' },
  occurredAt: '2026-08-26T12:00:00Z'
};

test('telemetry ingestion is limited to 60 requests per five minutes per trusted proxy source', async t => {
  let recordCalls = 0;
  const app = buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: 'aa'.repeat(32),
      SESSION_TOKEN_PEPPER: 'telemetry-rate-limit-pepper'
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() { throw new Error('not used'); } },
    errorTelemetryRepository: {
      async recordOccurrence() {
        recordCalls += 1;
      }
    }
  });
  t.after(() => app.close());

  for (let index = 0; index < 60; index += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/telemetry/errors',
      headers: { 'x-forwarded-for': '203.0.113.30' },
      payload: { errors: [{ ...baseError }] }
    });
    assert.equal(response.statusCode, 202, `request ${index + 1} should be allowed`);
  }

  const blocked = await app.inject({
    method: 'POST',
    url: '/v1/telemetry/errors',
    headers: { 'x-forwarded-for': '203.0.113.30' },
    payload: { errors: [{ ...baseError }] }
  });
  assert.equal(blocked.statusCode, 429);
  assert.equal(recordCalls, 60, 'rate-limited requests must not reach storage');

  const otherSource = await app.inject({
    method: 'POST',
    url: '/v1/telemetry/errors',
    headers: { 'x-forwarded-for': '203.0.113.31' },
    payload: { errors: [{ ...baseError }] }
  });
  assert.equal(otherSource.statusCode, 202);
  assert.equal(recordCalls, 61);
  assert.equal(otherSource.headers['x-ratelimit-limit'], '60');
  assert.match(otherSource.headers['x-ratelimit-reset'], /^\d+$/);
});
