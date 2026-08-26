const test=require('node:test');
const assert=require('node:assert/strict');
const {withDisposableDatabase}=require('../../test-support/database');
const {createReviveAttemptRepository}=require('../../src/db/revive-attempts');

async function seed(pool){
  const requester=await pool.query("INSERT INTO users(torn_id,current_name) VALUES(820001,'requester') RETURNING id");
  const reviver=await pool.query("INSERT INTO users(torn_id,current_name) VALUES(820002,'reviver') RETURNING id");
  const request=await pool.query("INSERT INTO revive_requests(requester_id,payment_method,offer_amount,state) VALUES($1,'xanax',1,'WAITING_FOR_REVIVE') RETURNING id",[requester.rows[0].id]);
  const txn=await pool.query(`INSERT INTO transactions(request_id,requester_id,reviver_id,state,accepted_at,payment_deadline,payment_verified_at,revive_deadline) VALUES($1,$2,$3,'WAITING_FOR_REVIVE','2026-08-26T10:00:00Z','2026-08-26T10:03:00Z','2026-08-26T10:01:00Z','2026-08-26T10:06:00Z') RETURNING id`,[request.rows[0].id,requester.rows[0].id,reviver.rows[0].id]);
  await pool.query(`INSERT INTO transaction_state_history(transaction_id,from_state,to_state,event_code,actor_type,created_at) VALUES($1,'WAITING_FOR_PAYMENT','WAITING_FOR_REVIVE','payment_verified','system','2026-08-26T10:01:00Z')`,[txn.rows[0].id]);
  return {transactionId:txn.rows[0].id,requesterUserId:requester.rows[0].id,reviverUserId:reviver.rows[0].id};
}

test('context exposes attempt window and immutable hospital baseline fields',async()=>{
  await withDisposableDatabase('revive_context',async pool=>{
    const ids=await seed(pool); const repo=createReviveAttemptRepository(pool);
    const ctx=await repo.getVerificationContext(ids.transactionId);
    assert.equal(ctx.requesterTornId,820001);
    assert.equal(ctx.reviverTornId,820002);
    assert.equal(ctx.attemptWindowStart.toISOString(),'2026-08-26T10:01:00.000Z');
    assert.equal(ctx.requesterHospitalUntil,null);
    const baseline=await repo.recordHospitalBaseline({transactionId:ids.transactionId,until:new Date('2026-08-26T10:20:00Z'),observedAt:new Date('2026-08-26T10:01:05Z')});
    assert.equal(baseline.requesterHospitalUntil.toISOString(),'2026-08-26T10:20:00.000Z');
    const unchanged=await repo.recordHospitalBaseline({transactionId:ids.transactionId,until:new Date('2026-08-26T11:00:00Z'),observedAt:new Date('2026-08-26T10:02:00Z')});
    assert.equal(unchanged.requesterHospitalUntil.toISOString(),'2026-08-26T10:20:00.000Z');
  });
});

test('attempt evidence is immutable/idempotent and receives monotonic sequence numbers',async()=>{
  await withDisposableDatabase('revive_attempts',async pool=>{
    const ids=await seed(pool); const repo=createReviveAttemptRepository(pool);
    const first=await repo.recordAttempt({transactionId:ids.transactionId,reviverUserId:ids.reviverUserId,evidence:{id:'r1',at:new Date('2026-08-26T10:02:00Z'),success:false}});
    const duplicate=await repo.recordAttempt({transactionId:ids.transactionId,reviverUserId:ids.reviverUserId,evidence:{id:'r1',at:new Date('2026-08-26T10:02:00Z'),success:false}});
    const second=await repo.recordAttempt({transactionId:ids.transactionId,reviverUserId:ids.reviverUserId,evidence:{id:'r2',at:new Date('2026-08-26T10:02:30Z'),success:true}});
    assert.equal(first.id,duplicate.id);
    assert.equal(first.sequenceNumber,1);
    assert.equal(second.sequenceNumber,2);
    const rows=await pool.query('SELECT COUNT(*)::int AS count FROM revive_attempts WHERE transaction_id=$1',[ids.transactionId]);
    assert.equal(rows.rows[0].count,2);
  });
});
