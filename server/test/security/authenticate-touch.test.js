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
  const warnings = [];
  const authenticate = createAuthenticateRequest({
    sessionRepository: { async findByTokenHash() { return record; }, async touch() { throw new Error('db down'); } },
    pepper: 'pepper',
    now: () => now,
    logger: { warn(message) { warnings.push(message); } }
  });
  const user = await authenticate(request);
  assert.equal(user.sessionId, 'session-1');
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('db down'));
});

test('presence failures warn at most once per minute', async () => {
  let clock = new Date('2026-11-25T12:00:00Z');
  const warnings = [];
  let touchCalls = 0;
  const authenticate = createAuthenticateRequest({
    sessionRepository: { async findByTokenHash() { return record; }, async touch() { touchCalls += 1; throw new Error('db down'); } },
    pepper: 'pepper',
    now: () => clock,
    logger: { warn(message) { warnings.push(message); } }
  });

  for (const at of ['2026-11-25T12:00:00Z', '2026-11-25T12:00:30Z', '2026-11-25T12:01:00Z']) {
    clock = new Date(at);
    const user = await authenticate(request);
    assert.equal(user.userId, 'user-1');
  }

  assert.equal(touchCalls, 3);
  assert.equal(warnings.length, 2);
});

test('repositories without touch still authenticate', async () => {
  const authenticate = createAuthenticateRequest({
    sessionRepository: { async findByTokenHash() { return record; } },
    pepper: 'pepper',
    now: () => now
  });
  assert.equal((await authenticate(request)).tornId, 1);
});
