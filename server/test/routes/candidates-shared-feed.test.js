const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

function makeSessionRepository(authenticated = true) {
  return {
    async findByTokenHash() {
      if (!authenticated) return null;
      return {
        sessionId: 'session-1',
        userId: 'user-1',
        tornId: 24680,
        expiresAt: null,
        revokedAt: null,
        reviverStanding: null,
        activeBan: false
      };
    }
  };
}

test('GET /v1/candidates/recent returns the central shared public-chat feed for any authenticated client', async t => {
  const shared = [{
    id: 'candidate-1',
    channelId: 'public_hospital',
    channelName: 'Hospital',
    channelType: 'hospital',
    senderId: '4251791',
    senderName: 'pramzz99',
    text: 'Revive please',
    canonicalKey: 'internal-dedupe-key',
    fallbackBasisHash: 'internal-fallback-hash',
    sourceMessageId: 'internal-source-message-id',
    classifierVersion: '2.0.0',
    score: 95,
    reasons: ['internal-classifier-reason'],
    firstSeenAt: '2026-08-27T13:35:54.936Z',
    lastSeenAt: '2026-08-27T13:35:56.591Z',
    seenCount: 2
  }];
  let queryOptions = null;

  const app = buildApp({
    config: { API_KEY_ENCRYPTION_KEY: '88'.repeat(32), SESSION_TOKEN_PEPPER: 'test-pepper' },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() {} },
    sessionRepository: makeSessionRepository(true),
    candidateRepository: {
      async upsertCandidate() { throw new Error('not used'); },
      async listRecentCandidates(options) {
        queryOptions = options;
        return shared;
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/candidates/recent',
    headers: { authorization: 'Bearer connected-client' }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().candidates, [{
    id: 'candidate-1',
    channelId: 'public_hospital',
    channelName: 'Hospital',
    channelType: 'hospital',
    senderId: '4251791',
    senderName: 'pramzz99',
    text: 'Revive please',
    firstSeenAt: '2026-08-27T13:35:54.936Z',
    lastSeenAt: '2026-08-27T13:35:56.591Z',
    seenCount: 2
  }]);
  for (const forbidden of ['canonicalKey', 'fallbackBasisHash', 'sourceMessageId', 'classifierVersion', 'score', 'reasons']) {
    assert.equal(Object.hasOwn(response.json().candidates[0], forbidden), false, `${forbidden} must remain server-side`);
  }
  assert.equal(queryOptions.limit, 50);
  assert.ok(queryOptions.freshSince instanceof Date);
});

test('GET /v1/candidates/recent requires a ReviveRelay session but not a reviver verification credential', async t => {
  const app = buildApp({
    config: { API_KEY_ENCRYPTION_KEY: '99'.repeat(32), SESSION_TOKEN_PEPPER: 'test-pepper' },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() {} },
    sessionRepository: makeSessionRepository(false),
    candidateRepository: {
      async upsertCandidate() { throw new Error('not used'); },
      async listRecentCandidates() { return []; }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/v1/candidates/recent' });
  assert.equal(response.statusCode, 401);
});
