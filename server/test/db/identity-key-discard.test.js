const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');
const { createIdentityRepository } = require('../../src/db/users');

async function waitForDatabaseSessionsToClose(adminPool, dbName) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await adminPool.query(
      'SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = $1',
      [dbName]
    );
    if (result.rows[0].count === 0) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for PostgreSQL sessions to close for ${dbName}`);
}

test('identity binding creates user/session but persists zero Torn API credentials', async () => {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  assert.ok(sourceUrl, 'TEST_DATABASE_URL is required');
  const dbName = `reviverelay_identity_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
  const targetUrl = new URL(sourceUrl); targetUrl.pathname = `/${dbName}`;
  const adminPool = createPool(adminUrl.toString());
  const pool = createPool(targetUrl.toString());
  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    await migrate(pool, path.resolve(__dirname, '../../src/db/migrations'));
    const repo = createIdentityRepository(pool);
    const result = await repo.bindIdentity({
      tornId: 987654,
      name: 'Identity Only',
      access: { level: 1 },
      tokenHash: 'a'.repeat(64),
      clientVersion: '0.3.0'
    });
    assert.ok(result.userId);
    const users = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE torn_id = 987654');
    const sessions = await pool.query('SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = $1', [result.userId]);
    const credentials = await pool.query('SELECT COUNT(*)::int AS count FROM api_credentials WHERE user_id = $1', [result.userId]);
    assert.equal(users.rows[0].count, 1);
    assert.equal(sessions.rows[0].count, 1);
    assert.equal(credentials.rows[0].count, 0);
  } finally {
    await pool.end();
    await waitForDatabaseSessionsToClose(adminPool, dbName);
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminPool.end();
  }
});
