const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

function makeApp({ presenceRepository = null, verificationStatus = null } = {}) {
  return buildApp({
    config: { API_KEY_ENCRYPTION_KEY: '88'.repeat(32), SESSION_TOKEN_PEPPER: 'test-pepper', SUBSCRIPTION_MODE: 'free' },
    tornClient: {
      async getKeyInfo() { throw new Error('not used'); },
      async getUserPerks() { throw new Error('not used'); }
    },
    identityRepository: { async bindIdentity() {} },
    sessionRepository: {
      async findByTokenHash() {
        return { sessionId: 's', userId: 'u', tornId: 5, name: 'N', expiresAt: null, revokedAt: null, reviverStanding: null, activeBan: false };
      }
    },
    entitlementRepository: {
      async getStatus() { return { state: 'NONE', trialEligible: true, trialStartedAt: null, validUntil: null }; },
      async startTrial() { throw new Error('not used'); }
    },
    requestRepository: { async getActiveRequest() { return null; }, async createRequest() {}, async cancelRequest() {} },
    transactionRepository: {
      async listOpenTransactionIdsForUser() { return []; },
      async getTransactionForUser() { return null; },
      async listAvailableRequests() { return []; },
      async countAvailableRequests() { return 0; },
      async acceptRequest() { throw new Error('not used'); }
    },
    verificationCredentialRepository: {
      async getStatus() { return verificationStatus; },
      async bind() {},
      async revoke() { return false; },
      async getDecryptedActiveForUser() { return null; }
    },
    logMetadataResolver: { async get() { return { categories: {} }; } },
    presenceRepository
  });
}

test('buildApp serves /v1/state', async t => {
  const app = makeApp();
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/state', headers: { authorization: 'Bearer x' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().revivers.online, null);
});

test('buildApp serves the badge route only with a presence repository', async t => {
  const without = makeApp();
  const withPresence = makeApp({
    presenceRepository: {
      async countOnlineRevivers() { return 1; },
      async getPlayerBadge(tornId) { return { tornId, requesterVerified: false, reviverVerified: false }; }
    }
  });
  t.after(() => Promise.all([without.close(), withPresence.close()]));
  const headers = { authorization: 'Bearer x' };
  assert.equal((await without.inject({ method: 'GET', url: '/v1/players/7/badge', headers })).statusCode, 404);
  assert.equal((await withPresence.inject({ method: 'GET', url: '/v1/players/7/badge', headers })).statusCode, 200);
  assert.equal((await withPresence.inject({ method: 'GET', url: '/v1/state', headers })).json().revivers.online, 1);
});

test('buildApp passes the verification credential repository to /v1/state', async t => {
  const app = makeApp({
    verificationStatus: { id: 'c', purpose: 'transaction_verification', capabilities: { requester: true, reviver: false }, accessScope: {}, lastValidatedAt: null, usable: true, unusableReason: null }
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/state', headers: { authorization: 'Bearer x' } });
  assert.deepEqual(response.json().me.verification, { usable: true, requester: true, reviver: false });
});
