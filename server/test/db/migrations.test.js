const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const migrateModulePath = path.resolve(__dirname, '../../src/db/migrate.js');
const migrationsDir = path.resolve(__dirname, '../../src/db/migrations');
const databaseUrl = process.env.TEST_DATABASE_URL;

const expectedTables = [
  'users',
  'api_credentials',
  'sessions',
  'revivers',
  'public_chat_candidates',
  'revive_requests',
  'transactions',
  'payments',
  'revive_attempts',
  'refunds',
  'disputes',
  'bans',
  'subscriptions',
  'audit_events'
];

test('migration runner creates the initial ReviveRelay schema idempotently', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(migrateModulePath), 'server/src/db/migrate.js must exist');
  assert.ok(fs.existsSync(migrationsDir), 'server/src/db/migrations must exist');

  const { migrate } = require(migrateModulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool, migrationsDir);
    await migrate(pool, migrationsDir);

    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const tableNames = new Set(tablesResult.rows.map((row) => row.table_name));

    for (const tableName of expectedTables) {
      assert.ok(tableNames.has(tableName), `expected table ${tableName}`);
    }

    const indexResult = await pool.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'revive_requests_one_active_per_requester'
    `);

    assert.equal(indexResult.rowCount, 1);
    assert.match(indexResult.rows[0].indexdef, /WHERE \(closed_at IS NULL\)/i);
  } finally {
    await pool.end();
  }
});
