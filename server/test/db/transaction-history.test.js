const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');

async function seedMarketplace(pool) {
  const users = [];
  for (const [tornId, name] of [[1001, 'Requester'], [2001, 'Reviver A'], [2002, 'Reviver B']]) {
    const result = await pool.query(`
      INSERT INTO users (torn_id, current_name)
      VALUES ($1, $2)
      RETURNING id
    `, [tornId, name]);
    users.push(result.rows[0].id);
  }

  const request = await pool.query(`
    INSERT INTO revive_requests (requester_id, payment_method, offer_amount)
    VALUES ($1, 'xanax', 1)
    RETURNING id
  `, [users[0]]);

  return {
    requesterId: users[0],
    reviverAId: users[1],
    reviverBId: users[2],
    requestId: request.rows[0].id
  };
}

async function insertTransaction(pool, { requestId, requesterId, reviverId, closed = false }) {
  const result = await pool.query(`
    INSERT INTO transactions (
      request_id, requester_id, reviver_id, state,
      accepted_at, payment_deadline, closed_at
    ) VALUES (
      $1, $2, $3, $4,
      '2026-08-26T10:00:00Z', '2026-08-26T10:03:00Z',
      CASE WHEN $5::boolean THEN '2026-08-26T10:04:00Z'::timestamptz ELSE NULL END
    )
    RETURNING id
  `, [requestId, requesterId, reviverId, closed ? 'PAYMENT_EXPIRED' : 'WAITING_FOR_PAYMENT', closed]);
  return result.rows[0].id;
}

test('one request preserves multiple closed reservations but rejects a second open assignment', async () => {
  await withDisposableDatabase('reviverelay_stage3_history', async pool => {
    const seed = await seedMarketplace(pool);

    await insertTransaction(pool, { ...seed, reviverId: seed.reviverAId, closed: true });
    await insertTransaction(pool, { ...seed, reviverId: seed.reviverBId, closed: true });

    const openId = await insertTransaction(pool, { ...seed, reviverId: seed.reviverAId, closed: false });
    assert.ok(openId);

    await assert.rejects(
      insertTransaction(pool, { ...seed, reviverId: seed.reviverBId, closed: false }),
      error => error && error.code === '23505'
    );

    const rows = await pool.query('SELECT id, closed_at FROM transactions WHERE request_id = $1 ORDER BY created_at, id', [seed.requestId]);
    assert.equal(rows.rowCount, 3);
    assert.equal(rows.rows.filter(row => row.closed_at === null).length, 1);
  });
});

test('payment evidence IDs are globally idempotent', async () => {
  await withDisposableDatabase('reviverelay_stage3_payment_evidence', async pool => {
    const seed = await seedMarketplace(pool);
    const transactionId = await insertTransaction(pool, { ...seed, reviverId: seed.reviverAId, closed: false });
    const payment = await pool.query(`
      INSERT INTO payments (transaction_id, method, expected_amount, verified_amount, evidence_timestamp)
      VALUES ($1, 'xanax', 1, 1, '2026-08-26T10:01:00Z')
      RETURNING id
    `, [transactionId]);

    await pool.query(`
      INSERT INTO payment_evidence (payment_id, torn_evidence_id, evidence_timestamp, amount)
      VALUES ($1, 'torn-payment-1', '2026-08-26T10:01:00Z', 1)
    `, [payment.rows[0].id]);

    await assert.rejects(
      pool.query(`
        INSERT INTO payment_evidence (payment_id, torn_evidence_id, evidence_timestamp, amount)
        VALUES ($1, 'torn-payment-1', '2026-08-26T10:01:01Z', 1)
      `, [payment.rows[0].id]),
      error => error && error.code === '23505'
    );
  });
});

test('refund evidence IDs are globally idempotent', async () => {
  await withDisposableDatabase('reviverelay_stage3_refund_evidence', async pool => {
    const seed = await seedMarketplace(pool);
    const transactionId = await insertTransaction(pool, { ...seed, reviverId: seed.reviverAId, closed: false });
    const refund = await pool.query(`
      INSERT INTO refunds (transaction_id, method, required_amount, required_at, deadline)
      VALUES ($1, 'xanax', 1, '2026-08-26T10:05:00Z', '2026-08-26T10:15:00Z')
      RETURNING id
    `, [transactionId]);

    await pool.query(`
      INSERT INTO refund_evidence (refund_id, torn_evidence_id, evidence_timestamp, amount)
      VALUES ($1, 'torn-refund-1', '2026-08-26T10:06:00Z', 1)
    `, [refund.rows[0].id]);

    await assert.rejects(
      pool.query(`
        INSERT INTO refund_evidence (refund_id, torn_evidence_id, evidence_timestamp, amount)
        VALUES ($1, 'torn-refund-1', '2026-08-26T10:06:01Z', 1)
      `, [refund.rows[0].id]),
      error => error && error.code === '23505'
    );
  });
});
