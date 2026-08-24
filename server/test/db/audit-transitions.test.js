const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');
const { createRequest, cancelRequest } = require('../../src/db/requests');
const { acceptRequest } = require('../../src/db/transactions');

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

test('request creation, acceptance, and cancellation write non-secret audit events', async () => {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  assert.ok(sourceUrl, 'TEST_DATABASE_URL is required');

  const dbName = `reviverelay_audit_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${dbName}`;

  const adminPool = createPool(adminUrl.toString());
  const pool = createPool(targetUrl.toString());

  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    await migrate(pool, path.resolve(__dirname, '../../src/db/migrations'));

    const requester = await pool.query(`
      INSERT INTO users (torn_id, current_name)
      VALUES (515151, 'Audit Requester')
      RETURNING id
    `);
    const reviver = await pool.query(`
      INSERT INTO users (torn_id, current_name)
      VALUES (616161, 'Audit Reviver')
      RETURNING id
    `);
    const requesterId = requester.rows[0].id;
    const reviverId = reviver.rows[0].id;

    await pool.query(`
      INSERT INTO revivers (user_id, standing)
      VALUES ($1, 'active')
    `, [reviverId]);

    const created = await createRequest(pool, {
      requesterId,
      paymentMethod: 'cash',
      offerAmount: 500000,
      comment: 'Do not duplicate this into audit details'
    });
    assert.equal(created.created, true);

    const acceptedAt = new Date('2026-08-24T00:00:00Z');
    const accepted = await acceptRequest(pool, {
      requestId: created.request.id,
      reviverId,
      now: acceptedAt
    });
    assert.equal(accepted.accepted, true);

    const cancelledAt = new Date('2026-08-24T00:01:00Z');
    const cancelled = await cancelRequest(pool, {
      requestId: created.request.id,
      requesterId,
      now: cancelledAt
    });
    assert.equal(cancelled.cancelled, true);

    const audit = await pool.query(`
      SELECT actor_type, actor_id, entity_type, entity_id, action, details
      FROM audit_events
      WHERE action IN ('request.created', 'transaction.accepted', 'request.cancelled')
      ORDER BY created_at ASC, action ASC
    `);

    assert.equal(audit.rowCount, 3);
    const byAction = Object.fromEntries(audit.rows.map(row => [row.action, row]));

    assert.equal(byAction['request.created'].actor_type, 'user');
    assert.equal(byAction['request.created'].actor_id, requesterId);
    assert.equal(byAction['request.created'].entity_type, 'revive_request');
    assert.equal(byAction['request.created'].entity_id, created.request.id);
    assert.deepEqual(byAction['request.created'].details, {
      paymentMethod: 'cash',
      offerAmount: 500000
    });

    assert.equal(byAction['transaction.accepted'].actor_type, 'user');
    assert.equal(byAction['transaction.accepted'].actor_id, reviverId);
    assert.equal(byAction['transaction.accepted'].entity_type, 'transaction');
    assert.equal(byAction['transaction.accepted'].entity_id, accepted.transaction.id);
    assert.equal(byAction['transaction.accepted'].details.requestId, created.request.id);
    assert.equal(byAction['transaction.accepted'].details.requesterId, requesterId);
    assert.ok(byAction['transaction.accepted'].details.paymentDeadline);

    assert.equal(byAction['request.cancelled'].actor_type, 'user');
    assert.equal(byAction['request.cancelled'].actor_id, requesterId);
    assert.equal(byAction['request.cancelled'].entity_type, 'revive_request');
    assert.equal(byAction['request.cancelled'].entity_id, created.request.id);
    assert.equal(byAction['request.cancelled'].details.previousState, 'WAITING_FOR_PAYMENT');
    assert.equal(byAction['request.cancelled'].details.transactionId, accepted.transaction.id);

    const serialized = JSON.stringify(audit.rows);
    assert.doesNotMatch(serialized, /Do not duplicate this into audit details/);
  } finally {
    await pool.end();
    await waitForDatabaseSessionsToClose(adminPool, dbName);
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminPool.end();
  }
});
