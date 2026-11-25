const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthenticateRequest } = require('../../src/security/authenticate');

const record = {
  sessionId: 'session-1', userId: 'user-1', tornId: 1, name: 'A',
  expiresAt: null, revokedAt: null, reviverStanding: null, activeBan: false
};
const request = { headers: { authorization: 'Bearer token-1' } };
const now = new Date('2026-11-25T12:00:00Z');

test('successful authentication touches the session', async () => {
  const touched = [];
  const authenticate = createAuthenticateRequest({
    sessionRepository: { async findByTokenHash() { return record; }, async touch(input) { touched.push(input); return true; } },
    pepper: 'pepper',
    now: () => now
  });
  const user = await authenticate(request);
  assert.equal(user.userId, 'user-1');
  assert.deepEqual(touched, [{ sessionId: 'session-1', now }]);
});

test('a failing touch never fails authentication', async () => {
  const authenticate = createAuthenticateRequest({
    sessionRepository: { async findByTokenHash() { return record; }, async touch() { throw new Error('db down'); } },
    pepper: 'pepper',
    now: () => now
  });
  const user = await authenticate(request);
  assert.equal(user.sessionId, 'session-1');
});

test('repositories without touch still authenticate', async () => {
  const authenticate = createAuthenticateRequest({
    sessionRepository: { async findByTokenHash() { return record; } },
    pepper: 'pepper',
    now: () => now
  });
  assert.equal((await authenticate(request)).tornId, 1);
});
