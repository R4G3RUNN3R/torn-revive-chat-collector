const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withDisposableDatabase } = require('../../test-support/database');

test('008 adds presence and requester status columns', async () => {
  await withDisposableDatabase('lite_state_schema', async pool => {
    const result = await pool.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE (table_name = 'sessions' AND column_name = 'last_seen_at')
         OR (table_name = 'revive_requests' AND column_name IN ('hospital_until','abroad','status_checked_at','status_refreshed_at'))
      ORDER BY table_name, column_name
    `);
    assert.deepEqual(result.rows.map(row => `${row.table_name}.${row.column_name}:${row.data_type}:${row.is_nullable}`), [
      'revive_requests.abroad:boolean:YES',
      'revive_requests.hospital_until:timestamp with time zone:YES',
      'revive_requests.status_checked_at:timestamp with time zone:YES',
      'revive_requests.status_refreshed_at:timestamp with time zone:YES',
      'sessions.last_seen_at:timestamp with time zone:YES'
    ]);
  });
});

test('008 sets a lock timeout as its first statement', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../src/db/migrations/008_lite_state.sql'), 'utf8');
  assert.match(sql, /^SET LOCAL lock_timeout = '5s';\n/);
});
