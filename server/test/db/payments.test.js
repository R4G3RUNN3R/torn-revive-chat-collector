const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createPaymentRepository } = require('../../src/db/payments');

async function seed(pool) {
  const requester = await pool.query("INSERT INTO users(torn_id,current_name) VALUES(810001,'requester') RETURNING id");
  const reviver = await pool.query("INSERT INTO users(torn_id,current_name) VALUES(810002,'reviver') RETURNING id");
  await pool.query("INSERT INTO revivers(user_id,standing) VALUES($1,'active')",[reviver.rows[0].id]);
  const request = await pool.query("INSERT INTO revive_requests(requester_id,payment_method,offer_amount,state) VALUES($1,'xanax',3,'WAITING_FOR_PAYMENT') RETURNING id",[requester.rows[0].id]);
  const txn = await pool.query(`INSERT INTO transactions(request_id,requester_id,reviver_id,state,accepted_at,payment_deadline) VALUES($1,$2,$3,'WAITING_FOR_PAYMENT','2026-08-26T10:00:00Z','2026-08-26T10:03:00Z') RETURNING id`,[request.rows[0].id,requester.rows[0].id,reviver.rows[0].id]);
  return { transactionId:txn.rows[0].id, requesterId:requester.rows[0].id, reviverId:reviver.rows[0].id };
}

test('records one aggregate payment per transaction with idempotent child evidence', async () => {
  await withDisposableDatabase('reviverelay_payment_repo', async pool => {
    const ids=await seed(pool); const repo=createPaymentRepository(pool);
    const input={transactionId:ids.transactionId,method:'xanax',expectedAmount:3,verifiedAmount:3,verifiedAt:new Date('2026-08-26T10:02:10Z'),evidence:[
      {id:'a',amount:1,at:new Date('2026-08-26T10:01:00Z')},
      {id:'b',amount:2,at:new Date('2026-08-26T10:02:00Z')}
    ]};
    const first=await repo.recordVerifiedPayment(input);
    const second=await repo.recordVerifiedPayment(input);
    assert.equal(first.id,second.id);
    const aggregates=await pool.query('SELECT * FROM payments WHERE transaction_id=$1',[ids.transactionId]);
    assert.equal(aggregates.rowCount,1);
    assert.equal(Number(aggregates.rows[0].verified_amount),3);
    const evidence=await pool.query('SELECT torn_evidence_id FROM payment_evidence WHERE payment_id=$1 ORDER BY torn_evidence_id',[first.id]);
    assert.deepEqual(evidence.rows.map(row=>row.torn_evidence_id),['a','b']);
  });
});

test('verification context includes contract and Torn identities', async () => {
  await withDisposableDatabase('reviverelay_payment_context', async pool => {
    const ids=await seed(pool); const repo=createPaymentRepository(pool);
    const context=await repo.getVerificationContext(ids.transactionId);
    assert.equal(context.requesterTornId,810001);
    assert.equal(context.reviverTornId,810002);
    assert.equal(context.method,'xanax');
    assert.equal(context.offerAmount,3);
    assert.equal(context.state,'WAITING_FOR_PAYMENT');
  });
});
