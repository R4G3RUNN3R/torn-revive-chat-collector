const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

test('POST /v1/candidates rejects forbidden chat even from a modified client', async t => {
  let inserts = 0;
  const app = buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '66'.repeat(32),
      SESSION_TOKEN_PEPPER: 'test-pepper'
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() {} },
    sessionRepository: {
      async findByTokenHash() {
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
    },
    candidateRepository: {
      async upsertCandidate() {
        inserts += 1;
        return { duplicate: false, candidate: { id: 'candidate-1' } };
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/candidates',
    headers: { authorization: 'Bearer contributor-token' },
    payload: {
      channelId: 'faction-123',
      senderId: '1',
      senderName: 'X',
      text: 'rev me',
      classifierVersion: '2',
      score: 99
    }
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error, 'CHANNEL_NOT_ALLOWED');
  assert.equal(inserts, 0);
});

test('POST /v1/candidates accepts allowlisted public candidate shape', async t => {
  let stored;
  const app = buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '77'.repeat(32),
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
      async upsertCandidate(candidate) {
        stored = candidate;
        return { duplicate: false, candidate: { id: 'candidate-1' } };
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/candidates',
    headers: { authorization: 'Bearer contributor-token' },
    payload: {
      channelId: 'public_global',
      senderId: '123',
      senderName: 'NeedsRevive',
      text: 'rev me please',
      classifierVersion: '2.0.0',
      score: 95,
      reasons: ['direct-request'],
      capturedAt: '2026-08-23T12:00:00Z'
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(stored.channelId, 'public_global');
  assert.equal(stored.channelType, 'global');
  assert.equal(stored.contributorUserId, 'user-1');
});
