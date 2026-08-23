const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAuthenticateRequest,
  AuthError
} = require('../../src/security/authenticate');
const { hashSessionToken } = require('../../src/security/sessions');

function requestWithToken(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}

test('valid active reviver session authenticates with requester and reviver roles', async () => {
  const token = 'opaque-session-token';
  const pepper = 'test-pepper';
  const expectedHash = hashSessionToken(token, pepper);
  const authenticateRequest = createAuthenticateRequest({
    pepper,
    now: () => new Date('2026-08-23T12:00:00Z'),
    sessionRepository: {
      async findByTokenHash(hash) {
        assert.equal(hash, expectedHash);
        return {
          sessionId: 'session-1',
          userId: 'user-1',
          tornId: 24680,
          expiresAt: new Date('2026-08-24T12:00:00Z'),
          revokedAt: null,
          reviverStanding: 'active',
          activeBan: false
        };
      }
    }
  });

  const identity = await authenticateRequest(requestWithToken(token));
  assert.deepEqual(identity, {
    sessionId: 'session-1',
    userId: 'user-1',
    tornId: 24680,
    roles: ['requester', 'reviver'],
    reviverStanding: 'active'
  });
});

test('missing or unknown bearer token is rejected', async () => {
  const authenticateRequest = createAuthenticateRequest({
    pepper: 'pepper',
    sessionRepository: { async findByTokenHash() { return null; } }
  });

  await assert.rejects(
    () => authenticateRequest({ headers: {} }),
    error => error instanceof AuthError && error.code === 'AUTH_REQUIRED' && error.statusCode === 401
  );
  await assert.rejects(
    () => authenticateRequest(requestWithToken('unknown')),
    error => error instanceof AuthError && error.code === 'AUTH_REQUIRED'
  );
});

test('revoked or expired session is rejected', async () => {
  const records = [
    {
      sessionId: 'revoked', userId: 'user-1', tornId: 1,
      revokedAt: new Date('2026-08-23T11:00:00Z'), expiresAt: null
    },
    {
      sessionId: 'expired', userId: 'user-1', tornId: 1,
      revokedAt: null, expiresAt: new Date('2026-08-23T11:59:59Z')
    }
  ];
  let index = 0;
  const authenticateRequest = createAuthenticateRequest({
    pepper: 'pepper',
    now: () => new Date('2026-08-23T12:00:00Z'),
    sessionRepository: { async findByTokenHash() { return records[index++]; } }
  });

  await assert.rejects(
    () => authenticateRequest(requestWithToken('revoked')),
    error => error instanceof AuthError && error.code === 'SESSION_REVOKED'
  );
  await assert.rejects(
    () => authenticateRequest(requestWithToken('expired')),
    error => error instanceof AuthError && error.code === 'SESSION_EXPIRED'
  );
});

test('banned reviver remains authenticated as requester but receives no reviver capability', async () => {
  const authenticateRequest = createAuthenticateRequest({
    pepper: 'pepper',
    sessionRepository: {
      async findByTokenHash() {
        return {
          sessionId: 'session-1',
          userId: 'user-1',
          tornId: 24680,
          expiresAt: null,
          revokedAt: null,
          reviverStanding: 'banned',
          activeBan: true
        };
      }
    }
  });

  const identity = await authenticateRequest(requestWithToken('token'));
  assert.deepEqual(identity.roles, ['requester']);
  assert.equal(identity.reviverStanding, 'banned');
});
