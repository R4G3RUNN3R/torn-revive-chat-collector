const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

test('direct-only app does not expose the legacy shared public-chat feed', async t => {
  const app = buildApp({
    config: { API_KEY_ENCRYPTION_KEY: '99'.repeat(32), SESSION_TOKEN_PEPPER: 'test-pepper' },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() {} },
    sessionRepository: {
      async findByTokenHash() {
        return {
          sessionId: 'session-1', userId: 'user-1', tornId: 24680,
          expiresAt: null, revokedAt: null, reviverStanding: null, activeBan: false
        };
      }
    },
    candidateRepository: {
      async upsertCandidate() { throw new Error('candidate ingestion must be unreachable'); },
      async listRecentCandidates() { throw new Error('candidate feed must be unreachable'); }
    }
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/v1/candidates/recent',
    headers: { authorization: 'Bearer connected-client' }
  });
  assert.equal(response.statusCode, 404);
});
