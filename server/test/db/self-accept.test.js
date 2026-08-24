const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');
const { acceptRequest } = require('../../src/db/transactions');

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

test('a reviver cannot accept their own revive request', async () => {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  assert.ok(sourceUrl, 'TEST_DATABASE_URL is required');

  const dbName = `reviverelay_self_accept_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${dbName}`;

  const adminPool = createPool(adminUrl.toString());
  const pool = createPool(targetUrl.toString());

  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    await migrate(pool, path.resolve(__dirname, '../../src/db/migrations'));

    const user = await pool.query(`
      INSERT INTO users (torn_id, current_name)
      VALUES (444444, 'Self Reviver')
      RETURNING id
    `);
    const userId = user.rows[0].id;

    await pool.query(`
      INSERT INTO revivers (user_id, standing)
      VALUES ($1, 'active')
    `, [userId]);

    const request = await pool.query(`
      INSERT INTO revive_requests
        (requester_id, payment_method, offer_amount, state)
      VALUES ($1, 'cash', 500000, 'AVAILABLE')
      RETURNING id
    `, [userId]);

    const result = await acceptRequest(pool, {
      requestId: request.rows[0].id,
      reviverId: userId,
      now: new Date('2026-08-24T00:00:00Z')
    });

    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'SELF_ACCEPT_NOT_ALLOWED');

    const transactions = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM transactions
      WHERE request_id = $1
    `, [request.rows[0].id]);
    assert.equal(transactions.rows[0].count, 0);

    const requestState = await pool.query(`
      SELECT state
      FROM revive_requests
      WHERE id = $1
    `, [request.rows[0].id]);
    assert.equal(requestState.rows[0].state, 'AVAILABLE');
  } finally {
    await pool.end();
    await waitForDatabaseSessionsToClose(adminPool, dbName);
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminPool.end();
  }
});
