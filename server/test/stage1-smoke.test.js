const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { createPool } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const { createSessionRepository } = require('../src/db/sessions');
const { createCandidateRepository } = require('../src/db/candidates');
const { createRequestRepository } = require('../src/db/requests');
const { createTransactionRepository } = require('../src/db/transactions');
const { hashSessionToken } = require('../src/security/sessions');
const { buildApp } = require('../src/app');

async function waitForDatabaseSessionsToClose(adminPool, dbName) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await adminPool.query(`
      SELECT COUNT(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = $1
    `, [dbName]);

    if (result.rows[0].count === 0) return;
    await sleep(10);
  }

  throw new Error(`Timed out waiting for PostgreSQL sessions to close for ${dbName}`);
}

async function insertUser(pool, tornId, name) {
  const result = await pool.query(`
    INSERT INTO users (torn_id, current_name)
    VALUES ($1, $2)
    RETURNING id
  `, [tornId, name]);
  return result.rows[0].id;
}

async function insertSession(pool, userId, token, pepper) {
  await pool.query(`
    INSERT INTO sessions (user_id, token_hash, client_version)
    VALUES ($1, $2, 'stage1-smoke')
  `, [userId, hashSessionToken(token, pepper)]);
}

test('Stage 1 API smoke: privacy, request uniqueness, and accept race hold end to end', async () => {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  assert.ok(sourceUrl, 'TEST_DATABASE_URL is required');

  const dbName = `reviverelay_smoke_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${dbName}`;

  const adminPool = createPool(adminUrl.toString());
  const pool = createPool(targetUrl.toString());
  let app = null;

  const pepper = 'stage1-smoke-pepper';
  const requesterToken = 'requester-smoke-token';
  const reviverAToken = 'reviver-a-smoke-token';
  const reviverBToken = 'reviver-b-smoke-token';

  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    await migrate(pool, path.resolve(__dirname, '../src/db/migrations'));

    const requesterId = await insertUser(pool, 810001, 'Smoke Requester');
    const reviverAId = await insertUser(pool, 810002, 'Smoke Reviver A');
    const reviverBId = await insertUser(pool, 810003, 'Smoke Reviver B');

    await pool.query(`
      INSERT INTO revivers (user_id, standing)
      VALUES ($1, 'active'), ($2, 'active')
    `, [reviverAId, reviverBId]);

    await insertSession(pool, requesterId, requesterToken, pepper);
    await insertSession(pool, reviverAId, reviverAToken, pepper);
    await insertSession(pool, reviverBId, reviverBToken, pepper);

    app = buildApp({
      config: {
        API_KEY_ENCRYPTION_KEY: '88'.repeat(32),
        SESSION_TOKEN_PEPPER: pepper
      },
      tornClient: {
        async getKeyInfo() {
          throw new Error('Torn API is not part of the Stage 1 smoke flow');
        }
      },
      identityRepository: {
        async bindIdentity() {
          throw new Error('identity binding is not part of the Stage 1 smoke flow');
        }
      },
      sessionRepository: createSessionRepository(pool),
      candidateRepository: createCandidateRepository(pool),
      requestRepository: createRequestRepository(pool),
      transactionRepository: createTransactionRepository(pool)
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { ok: true });

    const forbiddenCandidate = await app.inject({
      method: 'POST',
      url: '/v1/candidates',
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: {
        channelId: 'faction-123',
        senderId: 910001,
        senderName: 'Private Sender',
        text: 'rev me',
        classifierVersion: 'stage1-smoke',
        score: 99
      }
    });
    assert.equal(forbiddenCandidate.statusCode, 422);
    assert.equal(forbiddenCandidate.json().error, 'CHANNEL_NOT_ALLOWED');

    let candidateCount = await pool.query('SELECT COUNT(*)::int AS count FROM public_chat_candidates');
    assert.equal(candidateCount.rows[0].count, 0);

    const validCandidate = await app.inject({
      method: 'POST',
      url: '/v1/candidates',
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: {
        channelId: 'public_trade',
        senderId: 910002,
        senderName: 'Public Sender',
        text: 'need a revive please',
        sourceMessageId: 'stage1-smoke-message-1',
        messageTimestamp: '2026-08-24T00:00:00.000Z',
        classifierVersion: 'stage1-smoke',
        score: 96,
        reasons: ['revive phrase']
      }
    });
    assert.equal(validCandidate.statusCode, 201);
    assert.equal(validCandidate.json().duplicate, false);

    candidateCount = await pool.query('SELECT COUNT(*)::int AS count FROM public_chat_candidates');
    assert.equal(candidateCount.rows[0].count, 1);

    const firstRequest = await app.inject({
      method: 'POST',
      url: '/v1/requests',
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: {
        paymentMethod: 'cash',
        offerAmount: 500000,
        comment: 'Stage 1 smoke request'
      }
    });
    assert.equal(firstRequest.statusCode, 201);
    assert.equal(firstRequest.json().created, true);
    const requestId = firstRequest.json().request.id;

    const secondRequest = await app.inject({
      method: 'POST',
      url: '/v1/requests',
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: {
        paymentMethod: 'xanax',
        offerAmount: 1
      }
    });
    assert.equal(secondRequest.statusCode, 200);
    assert.equal(secondRequest.json().created, false);
    assert.equal(secondRequest.json().request.id, requestId);

    const requestCount = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM revive_requests
      WHERE requester_id = $1 AND closed_at IS NULL
    `, [requesterId]);
    assert.equal(requestCount.rows[0].count, 1);

    const [acceptA, acceptB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/requests/${requestId}/accept`,
        headers: { authorization: `Bearer ${reviverAToken}` }
      }),
      app.inject({
        method: 'POST',
        url: `/v1/requests/${requestId}/accept`,
        headers: { authorization: `Bearer ${reviverBToken}` }
      })
    ]);

    assert.deepEqual(
      [acceptA.statusCode, acceptB.statusCode].sort((a, b) => a - b),
      [200, 409]
    );

    const transactionCount = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM transactions
      WHERE request_id = $1
    `, [requestId]);
    assert.equal(transactionCount.rows[0].count, 1);

    const finalRequest = await pool.query(`
      SELECT state
      FROM revive_requests
      WHERE id = $1
    `, [requestId]);
    assert.equal(finalRequest.rows[0].state, 'WAITING_FOR_PAYMENT');
  } finally {
    if (app) await app.close();
    await pool.end();
    await waitForDatabaseSessionsToClose(adminPool, dbName);
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminPool.end();
  }
});
