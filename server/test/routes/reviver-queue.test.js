const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

const VALID_REQUEST_ID = '22222222-2222-4222-8222-222222222222';

function makeSessionRepository({ reviver = true } = {}) {
  return {
    async findByTokenHash() {
      return {
        sessionId: 'session-1',
        userId: 'reviver-user-id',
        tornId: 222222,
        expiresAt: null,
        revokedAt: null,
        reviverStanding: reviver ? 'active' : null,
        activeBan: false
      };
    }
  };
}

function makeApp(transactionRepository, options = {}) {
  const credentialStatus = Object.hasOwn(options, 'credentialStatus') ? options.credentialStatus : { id: 'cred-r', usable: true, capabilities: { requester: false, reviver: true } };
  return buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '88'.repeat(32),
      SESSION_TOKEN_PEPPER: 'test-pepper'
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() {} },
    sessionRepository: makeSessionRepository(options),
    transactionRepository,
    verificationCredentialRepository: { async getStatus() { return credentialStatus; }, async bind() { throw new Error('not used'); }, async revoke() { return false; } },
    logMetadataResolver: { async get() { return { categories: {} }; } }
  });
}

test('reviver queue and accept use the authenticated reviver identity', async t => {
  const calls = [];
  const app = makeApp({
    async listAvailableRequests() {
      return [{ id: VALID_REQUEST_ID, state: 'AVAILABLE' }];
    },
    async acceptRequest(input) {
      calls.push(input);
      return {
        accepted: true,
        transaction: {
          id: 'tx-1',
          requestId: input.requestId,
          reviverId: input.reviverId,
          state: 'WAITING_FOR_PAYMENT'
        }
      };
    }
  });
  t.after(() => app.close());

  const queue = await app.inject({
    method: 'GET',
    url: '/v1/reviver/queue',
    headers: { authorization: 'Bearer reviver-token' }
  });
  assert.equal(queue.statusCode, 200);
  assert.equal(queue.json().requests.length, 1);

  const accepted = await app.inject({
    method: 'POST',
    url: `/v1/requests/${VALID_REQUEST_ID}/accept`,
    headers: { authorization: 'Bearer reviver-token' },
    payload: { reviverId: 'attacker-supplied-id' }
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestId, VALID_REQUEST_ID);
  assert.equal(calls[0].reviverId, 'reviver-user-id');
});

test('self-acceptance returns a specific conflict instead of creating a transaction', async t => {
  const app = makeApp({
    async listAvailableRequests() { return []; },
    async acceptRequest() {
      return { accepted: false, reason: 'SELF_ACCEPT_NOT_ALLOWED' };
    }
  });
  t.after(() => app.close());

  const accepted = await app.inject({
    method: 'POST',
    url: `/v1/requests/${VALID_REQUEST_ID}/accept`,
    headers: { authorization: 'Bearer reviver-token' }
  });

  assert.equal(accepted.statusCode, 409);
  assert.equal(accepted.json().error, 'SELF_ACCEPT_NOT_ALLOWED');
});

test('accept rejects malformed request ids before repository access', async t => {
  let calls = 0;
  const app = makeApp({
    async listAvailableRequests() { return []; },
    async acceptRequest() { calls += 1; }
  });
  t.after(() => app.close());

  const accepted = await app.inject({
    method: 'POST',
    url: '/v1/requests/not-a-uuid/accept',
    headers: { authorization: 'Bearer reviver-token' }
  });

  assert.equal(accepted.statusCode, 422);
  assert.equal(accepted.json().error, 'INVALID_REQUEST_ID');
  assert.equal(calls, 0);
});

test('non-reviver sessions cannot view or accept the reviver queue', async t => {
  const app = makeApp({
    async listAvailableRequests() { throw new Error('must not be called'); },
    async acceptRequest() { throw new Error('must not be called'); }
  }, { reviver: false });
  t.after(() => app.close());

  const queue = await app.inject({
    method: 'GET',
    url: '/v1/reviver/queue',
    headers: { authorization: 'Bearer requester-token' }
  });
  assert.equal(queue.statusCode, 403);

  const accepted = await app.inject({
    method: 'POST',
    url: `/v1/requests/${VALID_REQUEST_ID}/accept`,
    headers: { authorization: 'Bearer requester-token' }
  });
  assert.equal(accepted.statusCode, 403);
});


test('reviver queue and Accept require a usable reviver-capable transaction credential', async t => {
  let calls = 0;
  const app = makeApp({
    async listAvailableRequests() { calls += 1; return []; },
    async acceptRequest() { calls += 1; return { accepted: false }; }
  }, { credentialStatus: null });
  t.after(() => app.close());

  const queue = await app.inject({ method: 'GET', url: '/v1/reviver/queue', headers: { authorization: 'Bearer reviver-token' } });
  assert.equal(queue.statusCode, 409);
  assert.equal(queue.json().error, 'VERIFICATION_CREDENTIAL_REQUIRED');

  const accepted = await app.inject({ method: 'POST', url: `/v1/requests/${VALID_REQUEST_ID}/accept`, headers: { authorization: 'Bearer reviver-token' } });
  assert.equal(accepted.statusCode, 409);
  assert.equal(accepted.json().error, 'VERIFICATION_CREDENTIAL_REQUIRED');
  assert.equal(calls, 0);
});
