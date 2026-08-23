const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../src/security/authenticate.js');

function loadAuth() {
  assert.ok(fs.existsSync(modulePath), 'server/src/security/authenticate.js must exist');
  return require(modulePath);
}

function requestWith(token) {
  return {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
  };
}

function record(overrides = {}) {
  return {
    sessionId: '22222222-2222-2222-2222-222222222222',
    userId: '11111111-1111-1111-1111-111111111111',
    tornId: 1234567,
    sessionRevokedAt: null,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    accountState: 'active',
    isReviver: true,
    reviverStanding: 'ACTIVE',
    activeBan: false,
    ...overrides
  };
}

test('valid Bearer session authenticates from server-held state and grants active reviver capability', async () => {
  const { createAuthenticator } = loadAuth();
  let lookedUpHash;
  const authenticateRequest = createAuthenticator({
    pepper: 'pepper',
    now: () => new Date('2029-01-01T00:00:00Z'),
    sessionRepository: {
      async findByTokenHash(hash) {
        lookedUpHash = hash;
        return record();
      }
    }
  });

  const user = await authenticateRequest(requestWith('session-secret'));

  assert.equal(user.tornId, 1234567);
  assert.equal(user.userId, '11111111-1111-1111-1111-111111111111');
  assert.equal(user.sessionId, '22222222-2222-2222-2222-222222222222');
  assert.deepEqual(user.roles, ['user', 'reviver']);
  assert.equal(typeof lookedUpHash, 'string');
  assert.notEqual(lookedUpHash, 'session-secret');
});

test('missing and malformed Bearer tokens are rejected before database lookup', async () => {
  const { createAuthenticator } = loadAuth();
  let lookups = 0;
  const authenticateRequest = createAuthenticator({
    pepper: 'pepper',
    sessionRepository: { async findByTokenHash() { lookups += 1; } }
  });

  await assert.rejects(() => authenticateRequest(requestWith()), (error) => error.code === 'AUTH_REQUIRED');
  await assert.rejects(
    () => authenticateRequest({ headers: { authorization: 'Basic abc' } }),
    (error) => error.code === 'AUTH_REQUIRED'
  );
  assert.equal(lookups, 0);
});

test('unknown, revoked and expired sessions are rejected', async () => {
  const { createAuthenticator } = loadAuth();

  for (const [name, stored, expectedCode] of [
    ['unknown', null, 'AUTH_REQUIRED'],
    ['revoked', record({ sessionRevokedAt: new Date('2028-01-01T00:00:00Z') }), 'SESSION_REVOKED'],
    ['expired', record({ expiresAt: new Date('2028-12-31T23:59:59Z') }), 'SESSION_EXPIRED']
  ]) {
    const authenticateRequest = createAuthenticator({
      pepper: 'pepper',
      now: () => new Date('2029-01-01T00:00:00Z'),
      sessionRepository: { async findByTokenHash() { return stored; } }
    });
    await assert.rejects(
      () => authenticateRequest(requestWith('token')),
      (error) => {
        assert.equal(error.code, expectedCode, name);
        return true;
      }
    );
  }
});

test('banned or suspended revivers keep a user session but never receive reviver capability', async () => {
  const { createAuthenticator } = loadAuth();

  for (const stored of [
    record({ activeBan: true }),
    record({ reviverStanding: 'BANNED' }),
    record({ reviverStanding: 'SUSPENDED' })
  ]) {
    const authenticateRequest = createAuthenticator({
      pepper: 'pepper',
      now: () => new Date('2029-01-01T00:00:00Z'),
      sessionRepository: { async findByTokenHash() { return stored; } }
    });
    const user = await authenticateRequest(requestWith('token'));
    assert.deepEqual(user.roles, ['user']);
  }
});

test('client-supplied roles are ignored', async () => {
  const { createAuthenticator } = loadAuth();
  const authenticateRequest = createAuthenticator({
    pepper: 'pepper',
    now: () => new Date('2029-01-01T00:00:00Z'),
    sessionRepository: { async findByTokenHash() { return record({ isReviver: false }); } }
  });

  const request = requestWith('token');
  request.body = { roles: ['admin', 'reviver'] };
  const user = await authenticateRequest(request);
  assert.deepEqual(user.roles, ['user']);
});
