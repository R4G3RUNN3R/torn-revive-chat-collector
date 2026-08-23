const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');

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
  'audit_events',
  'jobs'
];

test('initial migrations create the Stage 1 schema and are idempotent', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, 'TEST_DATABASE_URL is required');

  const pool = createPool(connectionString);
  t.after(async () => {
    await pool.end();
  });

  const migrationsDir = path.resolve(__dirname, '../../src/db/migrations');

  await migrate(pool, migrationsDir);
  await migrate(pool, migrationsDir);

  const tablesResult = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const tables = new Set(tablesResult.rows.map(row => row.table_name));

  for (const table of expectedTables) {
    assert.ok(tables.has(table), `expected table ${table}`);
  }

  const indexResult = await pool.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'revive_requests_one_active_per_requester'
  `);

  assert.equal(indexResult.rowCount, 1);
  assert.match(indexResult.rows[0].indexdef, /WHERE \(closed_at IS NULL\)/i);
});
