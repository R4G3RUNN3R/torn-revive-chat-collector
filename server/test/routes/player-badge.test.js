const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const fastifyRateLimit = require('@fastify/rate-limit');
const { registerPlayerBadgeRoute } = require('../../src/routes/player-badge');

async function makeApp(seen = []) {
  const app = Fastify();
  await app.register(fastifyRateLimit, { global: false });
  app.decorateRequest('reviveRelayUser', null);
  app.decorate('authenticate', async request => { request.reviveRelayUser = { userId: 'u', tornId: 1, roles: ['requester'] }; });
  await registerPlayerBadgeRoute(app, {
    presenceRepository: { async getPlayerBadge(tornId) { seen.push(tornId); return { tornId, requesterVerified: true, reviverVerified: false }; } }
  });
  return app;
}

test('returns the badge for a numeric Torn id with a 10 minute private cache', async t => {
  const seen = [];
  const app = await makeApp(seen);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/players/3532145/badge' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { tornId: 3532145, requesterVerified: true, reviverVerified: false });
  assert.equal(response.headers['cache-control'], 'private, max-age=600');
  assert.deepEqual(seen, [3532145]);
});

test('rejects non-numeric ids', async t => {
  const app = await makeApp();
  t.after(() => app.close());
  for (const id of ['abc', '0', '-5', '1.5']) {
    const response = await app.inject({ method: 'GET', url: `/v1/players/${id}/badge` });
    assert.equal(response.statusCode, 422, id);
    assert.deepEqual(response.json(), { error: 'INVALID_TORN_ID' });
  }
});
