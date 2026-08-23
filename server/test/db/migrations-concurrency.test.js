const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
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

test('concurrent migration runners safely serialize on the same fresh database', async () => {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  assert.ok(sourceUrl, 'TEST_DATABASE_URL is required');

  const dbName = `reviverelay_migration_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${dbName}`;

  const adminPool = createPool(adminUrl.toString());
  const pools = [];
  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    for (let i = 0; i < 5; i += 1) {
      pools.push(createPool(targetUrl.toString()));
    }

    const migrationsDir = path.resolve(__dirname, '../../src/db/migrations');
    const expectedMigrationCount = (await fs.readdir(migrationsDir))
      .filter(name => name.endsWith('.sql')).length;

    await Promise.all(pools.map(pool => migrate(pool, migrationsDir)));

    const result = await pools[0].query(`
      SELECT COUNT(*)::int AS count
      FROM schema_migrations
    `);
    assert.equal(result.rows[0].count, expectedMigrationCount);
  } finally {
    await Promise.all(pools.map(pool => pool.end()));
    await waitForDatabaseSessionsToClose(adminPool, dbName);
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminPool.end();
  }
});
