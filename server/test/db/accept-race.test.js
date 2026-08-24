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

test('two revivers accepting the same request produce exactly one winner', async () => {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  assert.ok(sourceUrl, 'TEST_DATABASE_URL is required');

  const dbName = `reviverelay_accept_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${dbName}`;

  const adminPool = createPool(adminUrl.toString());
  const pool = createPool(targetUrl.toString());

  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    await migrate(pool, path.resolve(__dirname, '../../src/db/migrations'));

    const requester = await pool.query(`
      INSERT INTO users (torn_id, current_name)
      VALUES (111111, 'Requester')
      RETURNING id
    `);
    const revivers = await pool.query(`
      INSERT INTO users (torn_id, current_name)
      VALUES (222222, 'Reviver A'), (333333, 'Reviver B')
      RETURNING id
    `);

    await pool.query(`
      INSERT INTO revivers (user_id, standing)
      VALUES ($1, 'active'), ($2, 'active')
    `, [revivers.rows[0].id, revivers.rows[1].id]);

    const request = await pool.query(`
      INSERT INTO revive_requests
        (requester_id, payment_method, offer_amount, state)
      VALUES ($1, 'cash', 500000, 'AVAILABLE')
      RETURNING id
    `, [requester.rows[0].id]);

    const now = new Date('2026-08-24T00:00:00Z');
    const [a, b] = await Promise.all([
      acceptRequest(pool, {
        requestId: request.rows[0].id,
        reviverId: revivers.rows[0].id,
        now
      }),
      acceptRequest(pool, {
        requestId: request.rows[0].id,
        reviverId: revivers.rows[1].id,
        now
      })
    ]);

    assert.equal([a.accepted, b.accepted].filter(Boolean).length, 1);
    const winner = a.accepted ? a : b;
    const loser = a.accepted ? b : a;
    assert.equal(loser.reason, 'REQUEST_UNAVAILABLE');

    const transactions = await pool.query(`
      SELECT * FROM transactions WHERE request_id = $1
    `, [request.rows[0].id]);
    assert.equal(transactions.rowCount, 1);
    assert.equal(transactions.rows[0].reviver_id, winner.transaction.reviverId);
    assert.equal(transactions.rows[0].state, 'WAITING_FOR_PAYMENT');
    assert.equal(
      new Date(transactions.rows[0].payment_deadline).getTime(),
      now.getTime() + (3 * 60 * 1000)
    );

    const requestState = await pool.query(`
      SELECT state FROM revive_requests WHERE id = $1
    `, [request.rows[0].id]);
    assert.equal(requestState.rows[0].state, 'WAITING_FOR_PAYMENT');
  } finally {
    await pool.end();
    await waitForDatabaseSessionsToClose(adminPool, dbName);
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminPool.end();
  }
});
