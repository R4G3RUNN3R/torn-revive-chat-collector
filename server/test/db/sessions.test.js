const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { migrate } = require('../../src/db/migrate');

const modulePath = path.resolve(__dirname, '../../src/db/sessions.js');
const migrationsDir = path.resolve(__dirname, '../../src/db/migrations');
const databaseUrl = process.env.TEST_DATABASE_URL;

test('session repository returns server-held identity, reviver standing and ban state', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(modulePath), 'server/src/db/sessions.js must exist');
  const { createSessionRepository } = require(modulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await migrate(pool, migrationsDir);
    await pool.query('TRUNCATE audit_events, subscriptions, bans, disputes, refunds, revive_attempts, payments, transactions, revive_requests, public_chat_candidates, revivers, sessions, api_credentials, users RESTART IDENTITY CASCADE');

    const userResult = await pool.query(`
      INSERT INTO users (torn_id, display_name)
      VALUES (1234567, 'ReviverOne')
      RETURNING id
    `);
    const userId = userResult.rows[0].id;

    const sessionResult = await pool.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, 'hashed-token', '2030-01-01T00:00:00Z')
      RETURNING id
    `, [userId]);

    await pool.query(`
      INSERT INTO revivers (user_id, standing)
      VALUES ($1, 'ACTIVE')
    `, [userId]);

    const repo = createSessionRepository(pool);
    const active = await repo.findByTokenHash('hashed-token');

    assert.equal(active.sessionId, sessionResult.rows[0].id);
    assert.equal(active.userId, userId);
    assert.equal(active.tornId, 1234567);
    assert.equal(active.accountState, 'active');
    assert.equal(active.isReviver, true);
    assert.equal(active.reviverStanding, 'ACTIVE');
    assert.equal(active.activeBan, false);

    await pool.query(`
      INSERT INTO bans (reviver_id, reason)
      VALUES ($1, 'test ban')
    `, [userId]);

    const banned = await repo.findByTokenHash('hashed-token');
    assert.equal(banned.activeBan, true);
    assert.equal(await repo.findByTokenHash('missing-token'), null);
  } finally {
    await pool.end();
  }
});
