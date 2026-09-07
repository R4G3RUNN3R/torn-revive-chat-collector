const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

function buildDirectOnlyApp() {
  return buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '66'.repeat(32),
      SESSION_TOKEN_PEPPER: 'test-pepper'
    },
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
}

test('direct-only app does not expose public-chat candidate ingestion', async t => {
  const app = buildDirectOnlyApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/v1/candidates',
    headers: { authorization: 'Bearer connected-client' },
    payload: {
      channelId: 'public_global', senderName: 'X', text: 'rev me',
      classifierVersion: '2.0.0', score: 99
    }
  });
  assert.equal(response.statusCode, 404);
});
