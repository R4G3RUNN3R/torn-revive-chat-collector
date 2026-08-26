const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { createPool } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');

async function waitForSessions(adminPool, dbName) {
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

async function withDisposableDatabase(prefix, fn) {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  if (!sourceUrl) throw new Error('TEST_DATABASE_URL is required');
  if (typeof fn !== 'function') throw new Error('Disposable database callback is required');

  const safePrefix = String(prefix || 'reviverelay_test').replace(/[^a-zA-Z0-9_]/g, '_');
  const dbName = `${safePrefix}_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${dbName}`;

  const adminPool = createPool(adminUrl.toString());
  const pool = createPool(targetUrl.toString());

  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    await migrate(pool, path.resolve(__dirname, '../src/db/migrations'));
    return await fn(pool);
  } finally {
    await pool.end();
    await waitForSessions(adminPool, dbName);
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminPool.end();
  }
}

module.exports = {
  withDisposableDatabase
};
