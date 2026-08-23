const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { migrate } = require('../src/db/migrate');
const { hashSessionToken } = require('../src/security/sessions');
const { createRuntime } = require('../src/server');
const path = require('node:path');

const databaseUrl = process.env.TEST_DATABASE_URL;
const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
const PEPPER = 'stage1-smoke-pepper';

async function clean(pool) {
  await migrate(pool, migrationsDir);
  await pool.query(`
    TRUNCATE jobs, audit_events, subscriptions, bans, disputes, refunds,
      revive_attempts, payments, transactions, revive_requests,
      public_chat_candidates, revivers, sessions, api_credentials, users
    RESTART IDENTITY CASCADE
  `);
}

async function seedUser(pool, tornId, name, token, { reviver = false } = {}) {
  const user = await pool.query(
    'INSERT INTO users (torn_id, display_name) VALUES ($1, $2) RETURNING id',
    [tornId, name]
  );
  const userId = user.rows[0].id;

  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, client_version) VALUES ($1, $2, $3)',
    [userId, hashSessionToken(token, PEPPER), 'stage1-smoke']
  );

  if (reviver) {
    await pool.query(
      "INSERT INTO revivers (user_id, standing) VALUES ($1, 'ACTIVE')",
      [userId]
    );
  }

  return userId;
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

test('Stage 1 production runtime passes the protected marketplace smoke flow', { skip: !databaseUrl }, async () => {
  assert.equal(typeof createRuntime, 'function', 'server.js must export createRuntime');

  const pool = new Pool({ connectionString: databaseUrl });
  let app;

  try {
    await clean(pool);

    const requesterToken = 'requester-session-token';
    const reviverAToken = 'reviver-a-session-token';
    const reviverBToken = 'reviver-b-session-token';

    await seedUser(pool, 8100001, 'Requester', requesterToken);
    await seedUser(pool, 8100002, 'ReviverA', reviverAToken, { reviver: true });
    await seedUser(pool, 8100003, 'ReviverB', reviverBToken, { reviver: true });

    const runtime = createRuntime({
      config: {
        DATABASE_URL: databaseUrl,
        API_KEY_ENCRYPTION_KEY: '11'.repeat(32),
        SESSION_TOKEN_PEPPER: PEPPER,
        TORN_API_BASE_URL: 'https://api.torn.com/v2'
      },
      pool,
      tornClient: {
        async getKeyInfo() {
          throw new Error('Torn network must not be needed for this smoke flow');
        }
      },
      logger: false
    });
    app = runtime.app;

    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { ok: true });

    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/candidates',
      headers: auth(requesterToken),
      payload: {
        channelId: 'faction-123',
        senderId: '8100001',
        senderName: 'Requester',
        text: 'rev me',
        classifierVersion: '2.0.0',
        score: 95,
        reasons: ['direct-request'],
        capturedAt: '2026-08-23T18:00:00.000Z'
      }
    });
    assert.equal(forbidden.statusCode, 422);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM public_chat_candidates')).rows[0].count, 0);

    const valid = await app.inject({
      method: 'POST',
      url: '/v1/candidates',
      headers: auth(requesterToken),
      payload: {
        channelId: 'public_hospital',
        senderId: '8100001',
        senderName: 'Requester',
        text: 'rev me please',
        sourceMessageId: 'smoke-msg-1',
        messageTimestamp: '2026-08-23T18:00:00.000Z',
        classifierVersion: '2.0.0',
        score: 95,
        reasons: ['direct-request'],
        capturedAt: '2026-08-23T18:00:01.000Z'
      }
    });
    assert.equal(valid.statusCode, 201);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM public_chat_candidates')).rows[0].count, 1);

    const firstRequest = await app.inject({
      method: 'POST',
      url: '/v1/requests',
      headers: auth(requesterToken),
      payload: { paymentMethod: 'cash', offerAmount: 500000, comment: 'smoke test' }
    });
    assert.equal(firstRequest.statusCode, 201);
    const requestId = firstRequest.json().request.id;

    const secondRequest = await app.inject({
      method: 'POST',
      url: '/v1/requests',
      headers: auth(requesterToken),
      payload: { paymentMethod: 'xanax', offerAmount: 1 }
    });
    assert.equal(secondRequest.statusCode, 200);
    assert.equal(secondRequest.json().request.id, requestId);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM revive_requests WHERE closed_at IS NULL')).rows[0].count, 1);

    const [acceptA, acceptB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/requests/${requestId}/accept`,
        headers: auth(reviverAToken)
      }),
      app.inject({
        method: 'POST',
        url: `/v1/requests/${requestId}/accept`,
        headers: auth(reviverBToken)
      })
    ]);

    assert.deepEqual([acceptA.statusCode, acceptB.statusCode].sort(), [201, 409]);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM transactions WHERE terminal_at IS NULL')).rows[0].count, 1);
  } finally {
    if (app) await app.close();
    await pool.end();
  }
});
