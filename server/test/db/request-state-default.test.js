const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');

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

test('revive request database default matches the canonical AVAILABLE state', async () => {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  assert.ok(sourceUrl, 'TEST_DATABASE_URL is required');

  const dbName = `reviverelay_request_default_${process.pid}_${Date.now()}`;
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
      VALUES (919191, 'Default State Tester')
      RETURNING id
    `);

    const request = await pool.query(`
      INSERT INTO revive_requests (requester_id, payment_method, offer_amount)
      VALUES ($1, 'cash', 500000)
      RETURNING state
    `, [user.rows[0].id]);

    assert.equal(request.rows[0].state, 'AVAILABLE');
  } finally {
    await pool.end();
    await waitForDatabaseSessionsToClose(adminPool, dbName);
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminPool.end();
  }
});
