const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');
const {
  createRequest,
  getActiveRequest,
  cancelRequest
} = require('../../src/db/requests');

async function setup(t) {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, 'TEST_DATABASE_URL is required');
  const pool = createPool(connectionString);
  t.after(async () => pool.end());
  await migrate(pool, path.resolve(__dirname, '../../src/db/migrations'));
  await pool.query(`
    TRUNCATE audit_events, disputes, refunds, revive_attempts, payments,
      transactions, revive_requests, bans, subscriptions, revivers,
      sessions, api_credentials, users CASCADE
  `);
  const user = await pool.query(`
    INSERT INTO users (torn_id, current_name)
    VALUES (123456, 'Requester')
    RETURNING id
  `);
  return { pool, requesterId: user.rows[0].id };
}

test('concurrent creates for one requester return one active request', async t => {
  const { pool, requesterId } = await setup(t);
  const payload = {
    requesterId,
    paymentMethod: 'cash',
    offerAmount: 500000,
    comment: null
  };

  const [a, b] = await Promise.all([
    createRequest(pool, payload),
    createRequest(pool, payload)
  ]);

  assert.equal([a.created, b.created].filter(Boolean).length, 1);
  assert.equal(a.request.id, b.request.id);
  assert.equal(a.request.state, 'AVAILABLE');

  const rows = await pool.query(`
    SELECT id, state
    FROM revive_requests
    WHERE requester_id = $1 AND closed_at IS NULL
  `, [requesterId]);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].state, 'AVAILABLE');

  const active = await getActiveRequest(pool, requesterId);
  assert.equal(active.id, a.request.id);
});

test('resubmitting an AVAILABLE request updates its terms in place', async t => {
  const { pool, requesterId } = await setup(t);

  const first = await createRequest(pool, {
    requesterId,
    paymentMethod: 'cash',
    offerAmount: 500000,
    comment: 'Old terms'
  });

  const second = await createRequest(pool, {
    requesterId,
    paymentMethod: 'xanax',
    offerAmount: 2,
    comment: 'New terms'
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.updated, true);
  assert.equal(second.request.id, first.request.id);
  assert.equal(second.request.paymentMethod, 'xanax');
  assert.equal(second.request.offerAmount, 2);
  assert.equal(second.request.comment, 'New terms');

  const rows = await pool.query(`
    SELECT id, payment_method, offer_amount, comment, state
    FROM revive_requests
    WHERE requester_id = $1 AND closed_at IS NULL
  `, [requesterId]);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].id, first.request.id);
  assert.equal(rows.rows[0].payment_method, 'xanax');
  assert.equal(Number(rows.rows[0].offer_amount), 2);
  assert.equal(rows.rows[0].comment, 'New terms');
  assert.equal(rows.rows[0].state, 'AVAILABLE');

  const audit = await pool.query(`
    SELECT action, details
    FROM audit_events
    WHERE entity_id = $1
    ORDER BY created_at ASC, action ASC
  `, [first.request.id]);
  assert.deepEqual(audit.rows.map(row => row.action).sort(), [
    'request.created',
    'request.updated'
  ]);
  const updatedAudit = audit.rows.find(row => row.action === 'request.updated');
  assert.deepEqual(updatedAudit.details, {
    paymentMethod: 'xanax',
    offerAmount: 2
  });
});

test('resubmitting a committed request does not silently change the accepted contract', async t => {
  const { pool, requesterId } = await setup(t);
  const reviver = await pool.query(`
    INSERT INTO users (torn_id, current_name)
    VALUES (777777, 'Committed Reviver')
    RETURNING id
  `);

  const first = await createRequest(pool, {
    requesterId,
    paymentMethod: 'cash',
    offerAmount: 750000,
    comment: 'Accepted terms'
  });

  await pool.query(`
    UPDATE revive_requests
    SET state = 'WAITING_FOR_PAYMENT'
    WHERE id = $1
  `, [first.request.id]);
  await pool.query(`
    INSERT INTO transactions
      (request_id, requester_id, reviver_id, state, accepted_at, payment_deadline)
    VALUES ($1, $2, $3, 'WAITING_FOR_PAYMENT', now(), now() + interval '3 minutes')
  `, [first.request.id, requesterId, reviver.rows[0].id]);

  const second = await createRequest(pool, {
    requesterId,
    paymentMethod: 'xanax',
    offerAmount: 3,
    comment: 'Attempted replacement'
  });

  assert.equal(second.created, false);
  assert.equal(second.updated, false);
  assert.equal(second.reason, 'REQUEST_COMMITTED');
  assert.equal(second.request.id, first.request.id);
  assert.equal(second.request.paymentMethod, 'cash');
  assert.equal(second.request.offerAmount, 750000);
  assert.equal(second.request.comment, 'Accepted terms');

  const row = await pool.query(`
    SELECT payment_method, offer_amount, comment, state
    FROM revive_requests
    WHERE id = $1
  `, [first.request.id]);
  assert.equal(row.rows[0].payment_method, 'cash');
  assert.equal(Number(row.rows[0].offer_amount), 750000);
  assert.equal(row.rows[0].comment, 'Accepted terms');
  assert.equal(row.rows[0].state, 'WAITING_FOR_PAYMENT');
});

test('cancellation closes an unaccepted request and removes it from active lookup', async t => {
  const { pool, requesterId } = await setup(t);
  const created = await createRequest(pool, {
    requesterId,
    paymentMethod: 'xanax',
    offerAmount: 1,
    comment: 'Quick please'
  });

  const cancelled = await cancelRequest(pool, {
    requestId: created.request.id,
    requesterId,
    now: new Date('2026-08-23T15:00:00Z')
  });

  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.request.state, 'CANCELLED');
  assert.ok(cancelled.request.closedAt);
  assert.equal(await getActiveRequest(pool, requesterId), null);
});

test('requester can cancel an accepted request during the pre-payment window', async t => {
  const { pool, requesterId } = await setup(t);
  const reviver = await pool.query(`
    INSERT INTO users (torn_id, current_name)
    VALUES (654321, 'Reviver')
    RETURNING id
  `);
  const created = await createRequest(pool, {
    requesterId,
    paymentMethod: 'cash',
    offerAmount: 750000,
    comment: null
  });

  await pool.query(`
    UPDATE revive_requests SET state = 'WAITING_FOR_PAYMENT' WHERE id = $1
  `, [created.request.id]);
  const transaction = await pool.query(`
    INSERT INTO transactions
      (request_id, requester_id, reviver_id, state, accepted_at, payment_deadline)
    VALUES ($1, $2, $3, 'WAITING_FOR_PAYMENT', now(), now() + interval '3 minutes')
    RETURNING id
  `, [created.request.id, requesterId, reviver.rows[0].id]);

  const now = new Date('2026-08-24T00:00:00Z');
  const result = await cancelRequest(pool, {
    requestId: created.request.id,
    requesterId,
    now
  });

  assert.equal(result.cancelled, true);
  assert.equal(result.request.state, 'CANCELLED');
  assert.equal(await getActiveRequest(pool, requesterId), null);

  const tx = await pool.query(`
    SELECT state, closed_at
    FROM transactions
    WHERE id = $1
  `, [transaction.rows[0].id]);
  assert.equal(tx.rows[0].state, 'CANCELLED_BY_REQUESTER');
  assert.equal(new Date(tx.rows[0].closed_at).getTime(), now.getTime());
});

test('requester cannot cancel after payment has been verified', async t => {
  const { pool, requesterId } = await setup(t);
  const reviver = await pool.query(`
    INSERT INTO users (torn_id, current_name)
    VALUES (654322, 'Reviver Paid')
    RETURNING id
  `);
  const created = await createRequest(pool, {
    requesterId,
    paymentMethod: 'cash',
    offerAmount: 750000,
    comment: null
  });

  await pool.query(`
    UPDATE revive_requests SET state = 'WAITING_FOR_REVIVE' WHERE id = $1
  `, [created.request.id]);
  await pool.query(`
    INSERT INTO transactions
      (request_id, requester_id, reviver_id, state, accepted_at, payment_deadline, payment_verified_at, revive_deadline)
    VALUES ($1, $2, $3, 'WAITING_FOR_REVIVE', now(), now() + interval '3 minutes', now(), now() + interval '5 minutes')
  `, [created.request.id, requesterId, reviver.rows[0].id]);

  const result = await cancelRequest(pool, {
    requestId: created.request.id,
    requesterId,
    now: new Date()
  });

  assert.equal(result.cancelled, false);
  assert.equal(result.reason, 'PAYMENT_COMMITTED');
});

test('active requester view exposes the current open transaction id after assignment', async t => {
  const { pool, requesterId } = await setup(t);
  const reviver = await pool.query(`
    INSERT INTO users (torn_id, current_name)
    VALUES (654399, 'Assigned Reviver')
    RETURNING id
  `);
  const created = await createRequest(pool, {
    requesterId,
    paymentMethod: 'xanax',
    offerAmount: 2,
    comment: null
  });
  await pool.query(`UPDATE revive_requests SET state='WAITING_FOR_PAYMENT' WHERE id=$1`, [created.request.id]);
  const tx = await pool.query(`
    INSERT INTO transactions (request_id, requester_id, reviver_id, state, accepted_at, payment_deadline)
    VALUES ($1,$2,$3,'WAITING_FOR_PAYMENT',now(),now()+interval '3 minutes')
    RETURNING id
  `, [created.request.id, requesterId, reviver.rows[0].id]);

  const active = await getActiveRequest(pool, requesterId);
  assert.equal(active.id, created.request.id);
  assert.equal(active.transactionId, tx.rows[0].id);
});
