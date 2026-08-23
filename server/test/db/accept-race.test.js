const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { migrate } = require('../../src/db/migrate');

const modulePath = path.resolve(__dirname, '../../src/db/transactions.js');
const migrationsDir = path.resolve(__dirname, '../../src/db/migrations');
const databaseUrl = process.env.TEST_DATABASE_URL;

async function clean(pool) {
  await migrate(pool, migrationsDir);
  await pool.query('TRUNCATE audit_events, subscriptions, bans, disputes, refunds, revive_attempts, payments, transactions, revive_requests, public_chat_candidates, revivers, sessions, api_credentials, users RESTART IDENTITY CASCADE');
}

async function seed(pool) {
  const requester = await pool.query(`
    INSERT INTO users (torn_id, display_name)
    VALUES (7000001, 'Requester') RETURNING id
  `);
  const revivers = [];
  for (const [tornId, name] of [[7000002, 'ReviverA'], [7000003, 'ReviverB']]) {
    const user = await pool.query(
      'INSERT INTO users (torn_id, display_name) VALUES ($1, $2) RETURNING id',
      [tornId, name]
    );
    await pool.query('INSERT INTO revivers (user_id, standing) VALUES ($1, $2)', [user.rows[0].id, 'ACTIVE']);
    revivers.push(user.rows[0].id);
  }
  const request = await pool.query(`
    INSERT INTO revive_requests (requester_id, payment_method, offer_amount, state)
    VALUES ($1, 'cash', 500000, 'AVAILABLE') RETURNING id
  `, [requester.rows[0].id]);

  return { requestId: request.rows[0].id, reviverIds: revivers };
}

test('two revivers racing to accept one request produce exactly one open transaction', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(modulePath), 'server/src/db/transactions.js must exist');
  const { createTransactionRepository } = require(modulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await clean(pool);
    const { requestId, reviverIds } = await seed(pool);
    const repo = createTransactionRepository(pool);
    const now = new Date('2026-08-23T18:30:00.000Z');

    const results = await Promise.allSettled([
      repo.acceptRequest({ requestId, reviverId: reviverIds[0], now }),
      repo.acceptRequest({ requestId, reviverId: reviverIds[1], now })
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected);
    assert.equal(rejected.reason.code, 'REQUEST_NOT_AVAILABLE');

    const transactions = await pool.query('SELECT * FROM transactions WHERE request_id = $1 AND terminal_at IS NULL', [requestId]);
    assert.equal(transactions.rowCount, 1);
    assert.equal(transactions.rows[0].state, 'WAITING_FOR_PAYMENT');
    assert.equal(new Date(transactions.rows[0].payment_deadline).toISOString(), '2026-08-23T18:33:00.000Z');

    const request = await pool.query('SELECT state FROM revive_requests WHERE id = $1', [requestId]);
    assert.equal(request.rows[0].state, 'WAITING_FOR_PAYMENT');
  } finally {
    await pool.end();
  }
});

test('a released request can be accepted again after the previous transaction is terminal', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(modulePath), 'server/src/db/transactions.js must exist');
  const { createTransactionRepository } = require(modulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await clean(pool);
    const { requestId, reviverIds } = await seed(pool);
    const repo = createTransactionRepository(pool);

    const first = await repo.acceptRequest({
      requestId,
      reviverId: reviverIds[0],
      now: new Date('2026-08-23T18:30:00.000Z')
    });

    await pool.query('UPDATE transactions SET terminal_at = $2, state = $3 WHERE id = $1', [
      first.id,
      new Date('2026-08-23T18:34:00.000Z'),
      'PAYMENT_EXPIRED'
    ]);
    await pool.query('UPDATE revive_requests SET state = $2, updated_at = $3 WHERE id = $1', [
      requestId,
      'AVAILABLE',
      new Date('2026-08-23T18:34:00.000Z')
    ]);

    const second = await repo.acceptRequest({
      requestId,
      reviverId: reviverIds[1],
      now: new Date('2026-08-23T18:35:00.000Z')
    });

    assert.notEqual(first.id, second.id);
    assert.equal(second.reviverId, reviverIds[1]);
    const rows = await pool.query('SELECT id, terminal_at FROM transactions WHERE request_id = $1 ORDER BY accepted_at', [requestId]);
    assert.equal(rows.rowCount, 2);
    assert.ok(rows.rows[0].terminal_at);
    assert.equal(rows.rows[1].terminal_at, null);
  } finally {
    await pool.end();
  }
});
