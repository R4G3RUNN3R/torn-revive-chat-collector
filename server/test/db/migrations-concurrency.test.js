const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');

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
    await Promise.all(pools.map(pool => migrate(pool, migrationsDir)));

    const result = await pools[0].query(`
      SELECT COUNT(*)::int AS count
      FROM schema_migrations
    `);
    assert.equal(result.rows[0].count, 1);
  } finally {
    await Promise.allSettled(pools.map(pool => pool.end()));
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminPool.end();
  }
});
