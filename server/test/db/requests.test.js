const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { migrate } = require('../../src/db/migrate');

const modulePath = path.resolve(__dirname, '../../src/db/requests.js');
const migrationsDir = path.resolve(__dirname, '../../src/db/migrations');
const databaseUrl = process.env.TEST_DATABASE_URL;

async function seedRequester(pool) {
  const result = await pool.query(`
    INSERT INTO users (torn_id, display_name)
    VALUES (7654321, 'RequesterOne')
    RETURNING id
  `);
  return result.rows[0].id;
}

async function clean(pool) {
  await migrate(pool, migrationsDir);
  await pool.query('TRUNCATE audit_events, subscriptions, bans, disputes, refunds, revive_attempts, payments, transactions, revive_requests, public_chat_candidates, revivers, sessions, api_credentials, users RESTART IDENTITY CASCADE');
}

test('concurrent creates for one requester produce exactly one active request', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(modulePath), 'server/src/db/requests.js must exist');
  const { createRequestRepository } = require(modulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await clean(pool);
    const requesterId = await seedRequester(pool);
    const repo = createRequestRepository(pool);
    const now = new Date('2026-08-23T18:00:00.000Z');

    const [first, second] = await Promise.all([
      repo.createOrGetActive({ requesterId, paymentMethod: 'cash', offerAmount: 500000, comment: null, now }),
      repo.createOrGetActive({ requesterId, paymentMethod: 'xanax', offerAmount: 1, comment: 'second click', now })
    ]);

    assert.equal(first.request.id, second.request.id);
    assert.equal([first.created, second.created].filter(Boolean).length, 1);

    const rows = await pool.query('SELECT * FROM revive_requests WHERE requester_id = $1 AND closed_at IS NULL', [requesterId]);
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].state, 'AVAILABLE');
  } finally {
    await pool.end();
  }
});

test('active request lookup and cancellation are scoped to the authenticated requester', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(modulePath), 'server/src/db/requests.js must exist');
  const { createRequestRepository } = require(modulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await clean(pool);
    const requesterId = await seedRequester(pool);
    const otherResult = await pool.query(`
      INSERT INTO users (torn_id, display_name)
      VALUES (8765432, 'OtherPlayer')
      RETURNING id
    `);
    const otherId = otherResult.rows[0].id;
    const repo = createRequestRepository(pool);

    const created = await repo.createOrGetActive({
      requesterId,
      paymentMethod: 'xanax',
      offerAmount: 1,
      comment: 'help',
      now: new Date('2026-08-23T18:00:00.000Z')
    });

    assert.equal((await repo.getActive(requesterId)).id, created.request.id);
    assert.equal(await repo.getActive(otherId), null);
    assert.equal(await repo.cancelAvailable(created.request.id, otherId, new Date('2026-08-23T18:01:00.000Z')), null);

    const cancelled = await repo.cancelAvailable(
      created.request.id,
      requesterId,
      new Date('2026-08-23T18:01:00.000Z')
    );
    assert.equal(cancelled.state, 'CANCELLED');
    assert.ok(cancelled.closedAt);
    assert.equal(await repo.getActive(requesterId), null);
  } finally {
    await pool.end();
  }
});
