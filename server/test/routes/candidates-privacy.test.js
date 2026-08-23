const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../src/app');

function createCandidateTestApp(candidateRepository) {
  return createApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '11'.repeat(32),
      SESSION_TOKEN_PEPPER: 'pepper'
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    userRepository: { async bindIdentity() { throw new Error('not used'); } },
    sessionRepository: {
      async findByTokenHash() {
        return {
          sessionId: '22222222-2222-2222-2222-222222222222',
          userId: '11111111-1111-1111-1111-111111111111',
          tornId: 1234567,
          sessionRevokedAt: null,
          expiresAt: null,
          accountState: 'active',
          isReviver: false,
          reviverStanding: null,
          activeBan: false
        };
      }
    },
    candidateRepository
  });
}

const baseCandidate = {
  senderId: '1',
  senderName: 'X',
  text: 'rev me',
  classifierVersion: '2.0.0',
  score: 99,
  reasons: ['direct-request'],
  capturedAt: '2026-08-23T17:00:00.000Z'
};

test('POST /v1/candidates rejects Faction data before any repository write', async () => {
  let writes = 0;
  const app = createCandidateTestApp({
    async acceptCandidate() {
      writes += 1;
      throw new Error('forbidden candidate must never reach storage');
    }
  });

  const reply = await app.inject({
    method: 'POST',
    url: '/v1/candidates',
    headers: { authorization: 'Bearer contributor-token' },
    payload: { ...baseCandidate, channelId: 'faction-123' }
  });

  assert.equal(reply.statusCode, 422);
  assert.equal(reply.json().code, 'CHANNEL_NOT_ALLOWED');
  assert.equal(writes, 0);
  await app.close();
});

test('POST /v1/candidates rejects unknown public-looking channels before storage', async () => {
  let writes = 0;
  const app = createCandidateTestApp({ async acceptCandidate() { writes += 1; } });

  const reply = await app.inject({
    method: 'POST',
    url: '/v1/candidates',
    headers: { authorization: 'Bearer contributor-token' },
    payload: { ...baseCandidate, channelId: 'public_future_secret' }
  });

  assert.equal(reply.statusCode, 422);
  assert.equal(reply.json().code, 'CHANNEL_NOT_ALLOWED');
  assert.equal(writes, 0);
  await app.close();
});

test('POST /v1/candidates canonicalizes an allowed public channel before handing it to storage', async () => {
  const writes = [];
  const app = createCandidateTestApp({
    async acceptCandidate(candidate, actor) {
      writes.push({ candidate, actor });
      return { id: '33333333-3333-3333-3333-333333333333', duplicate: false };
    }
  });

  const reply = await app.inject({
    method: 'POST',
    url: '/v1/candidates',
    headers: { authorization: 'Bearer contributor-token' },
    payload: { ...baseCandidate, channelId: 'public_global' }
  });

  assert.equal(reply.statusCode, 201);
  assert.equal(reply.json().ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].candidate.channel, {
    id: 'public_global',
    name: 'Global',
    type: 'global'
  });
  assert.equal(writes[0].actor.tornId, 1234567);
  await app.close();
});
