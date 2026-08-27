const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');
const { hashSessionToken } = require('../../src/security/sessions');

const config = {
  API_KEY_ENCRYPTION_KEY: '99'.repeat(32),
  SESSION_TOKEN_PEPPER: 'telemetry-test-pepper'
};

const baseError = {
  component: 'client',
  version: '0.4.0',
  buildCommit: 'abc123',
  severity: 'high',
  errorName: 'TypeError',
  errorCode: 'TYPE_ERROR',
  message: 'boom',
  stack: 'at render (ui.js:1:1)',
  context: { operation: 'render' },
  occurredAt: '2026-08-26T12:00:00Z'
};

function createApp({ repository, sessionRepository } = {}) {
  return buildApp({
    config,
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() { throw new Error('not used'); } },
    sessionRepository,
    errorTelemetryRepository: repository || {
      async recordOccurrence() {}
    }
  });
}

test('POST /v1/telemetry/errors sanitizes, fingerprints and records an anonymous envelope', async t => {
  const calls = [];
  const app = createApp({
    repository: {
      async recordOccurrence(envelope) {
        calls.push(envelope);
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/telemetry/errors',
    headers: { 'x-forwarded-for': '203.0.113.20' },
    payload: {
      errors: [{
        ...baseError,
        userId: 'forged-user-id',
        message: 'Authorization: Bearer SECRET_TOKEN boom',
        context: {
          operation: 'render',
          route: '/v1/requests',
          requestBody: { apiKey: 'ABC123' }
        }
      }]
    }
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { accepted: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].product, 'reviverelay');
  assert.equal(calls[0].component, 'client');
  assert.equal(calls[0].source, 'client');
  assert.equal(calls[0].userId, null);
  assert.match(calls[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(calls[0].summary, 'Authorization: [REDACTED] boom');
  assert.equal(calls[0].representativeStack, baseError.stack);
  assert.deepEqual(calls[0].context, { operation: 'render', route: '/v1/requests' });
  assert.equal(calls[0].occurredAt.toISOString(), new Date(baseError.occurredAt).toISOString());
  assert.doesNotMatch(JSON.stringify(calls[0]), /SECRET_TOKEN|ABC123|requestBody|203\.0\.113\.20|forged-user-id/);
});

test('POST /v1/telemetry/errors accepts a batch of 20 and rejects larger or malformed batches', async t => {
  const calls = [];
  const app = createApp({
    repository: { async recordOccurrence(envelope) { calls.push(envelope); } }
  });
  t.after(() => app.close());

  const accepted = await app.inject({
    method: 'POST', url: '/v1/telemetry/errors',
    payload: { errors: Array.from({ length: 20 }, () => ({ ...baseError })) }
  });
  assert.equal(accepted.statusCode, 202);
  assert.equal(calls.length, 20);

  for (const payload of [
    { errors: Array.from({ length: 21 }, () => ({ ...baseError })) },
    { errors: [] },
    { errors: [{ ...baseError, occurredAt: 'not-a-date' }] },
    { errors: [{ ...baseError, component: 'server' }] },
    { errors: 'not-an-array' }
  ]) {
    const response = await app.inject({
      method: 'POST', url: '/v1/telemetry/errors', payload
    });
    assert.equal(response.statusCode, 422);
    assert.deepEqual(response.json(), { error: 'INVALID_TELEMETRY' });
  }
  assert.equal(calls.length, 20, 'invalid payloads must not reach the repository');
});

test('valid bearer auth links only the authenticated internal user UUID', async t => {
  const calls = [];
  const app = createApp({
    sessionRepository: {
      async findByTokenHash(hash) {
        assert.equal(hash, hashSessionToken('valid-session', config.SESSION_TOKEN_PEPPER));
        return {
          sessionId: 'session-id',
          userId: '12c44f27-49f4-4bd8-83f5-00ef26dd6cb1',
          tornId: 123456,
          expiresAt: null,
          revokedAt: null,
          reviverStanding: null,
          activeBan: false
        };
      }
    },
    repository: { async recordOccurrence(envelope) { calls.push(envelope); } }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST', url: '/v1/telemetry/errors',
    headers: { authorization: 'Bearer valid-session' },
    payload: { errors: [{ ...baseError, userId: 'client-forged-id' }] }
  });

  assert.equal(response.statusCode, 202);
  assert.equal(calls[0].userId, '12c44f27-49f4-4bd8-83f5-00ef26dd6cb1');
  assert.doesNotMatch(JSON.stringify(calls[0]), /client-forged-id|123456|session-id/);
});

test('invalid bearer auth fails safely without recording telemetry', async t => {
  let calls = 0;
  const app = createApp({
    sessionRepository: { async findByTokenHash() { return null; } },
    repository: { async recordOccurrence() { calls += 1; } }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST', url: '/v1/telemetry/errors',
    headers: { authorization: 'Bearer invalid-session' },
    payload: { errors: [{ ...baseError }] }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'AUTH_REQUIRED' });
  assert.equal(calls, 0);
});

test('repository failure returns a bounded 503 and does not recursively record', async t => {
  let calls = 0;
  const app = createApp({
    repository: {
      async recordOccurrence() {
        calls += 1;
        throw new Error(`database unavailable ${'sensitive detail '.repeat(100)}`);
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST', url: '/v1/telemetry/errors',
    payload: { errors: [{ ...baseError }] }
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: 'TELEMETRY_UNAVAILABLE' });
  assert.ok(response.body.length < 100);
  assert.equal(calls, 1);
});
