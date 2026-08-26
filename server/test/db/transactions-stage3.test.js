const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createTransactionRepository } = require('../../src/db/transactions');
const { createTransactionService } = require('../../src/domain/transaction-service');
const { createRequestRepository } = require('../../src/db/requests');

async function seed(pool) {
  const ids = {};
  for (const [key, tornId] of [['requester',710001],['reviverA',710002],['reviverB',710003]]) {
    const row = await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id', [tornId,key]);
    ids[key] = row.rows[0].id;
  }
  await pool.query("INSERT INTO revivers (user_id,standing) VALUES ($1,'active'),($2,'active')", [ids.reviverA,ids.reviverB]);
  const request = await pool.query("INSERT INTO revive_requests (requester_id,payment_method,offer_amount,state) VALUES ($1,'xanax',1,'AVAILABLE') RETURNING id", [ids.requester]);
  ids.request = request.rows[0].id;
  return ids;
}

test('acceptance writes history, enqueues exactly one payment verification job, and unpaid expiry permits a later reservation', async () => {
  await withDisposableDatabase('reviverelay_stage3_transitions', async pool => {
    const ids = await seed(pool);
    const repo = createTransactionRepository(pool);
    const service = createTransactionService(pool);
    const acceptedAt = new Date('2026-08-26T10:00:00Z');
    const first = await repo.acceptRequest({ requestId:ids.request, reviverId:ids.reviverA, now:acceptedAt });
    assert.equal(first.accepted,true);

    let history = await pool.query('SELECT from_state,to_state,event_code FROM transaction_state_history WHERE transaction_id=$1 ORDER BY created_at,id', [first.transaction.id]);
    assert.deepEqual(history.rows, [{ from_state:'AVAILABLE', to_state:'WAITING_FOR_PAYMENT', event_code:'accept' }]);
    let jobs = await pool.query('SELECT type,dedupe_key FROM jobs WHERE entity_id=$1 AND completed_at IS NULL', [first.transaction.id]);
    assert.deepEqual(jobs.rows, [{ type:'payment.verify', dedupe_key:`payment.verify:${first.transaction.id}` }]);

    await service.transitionTransaction({ transactionId:first.transaction.id, event:'deadline', actor:{type:'system'}, now:new Date('2026-08-26T10:03:00Z') });
    const expired = await service.transitionTransaction({ transactionId:first.transaction.id, event:'payment_expired', actor:{type:'system'}, now:new Date('2026-08-26T10:03:30Z') });
    assert.equal(expired.transaction.state,'PAYMENT_EXPIRED');
    assert.ok(expired.transaction.closedAt);
    assert.equal(expired.request.state,'AVAILABLE');
    assert.equal(expired.request.closedAt,null);

    const second = await repo.acceptRequest({ requestId:ids.request, reviverId:ids.reviverB, now:new Date('2026-08-26T10:04:00Z') });
    assert.equal(second.accepted,true);
    assert.notEqual(second.transaction.id,first.transaction.id);
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM transactions WHERE request_id=$1', [ids.request]);
    assert.equal(count.rows[0].count,2);
  });
});

test('verification hold never rewrites contractual deadlines', async () => {
  await withDisposableDatabase('reviverelay_stage3_hold', async pool => {
    const ids = await seed(pool);
    const repo = createTransactionRepository(pool);
    const service = createTransactionService(pool);
    const accepted = await repo.acceptRequest({ requestId:ids.request, reviverId:ids.reviverA, now:new Date('2026-08-26T10:00:00Z') });
    const before = await pool.query('SELECT payment_deadline,revive_deadline,refund_deadline FROM transactions WHERE id=$1', [accepted.transaction.id]);
    await service.setVerificationHold({ transactionId:accepted.transaction.id, reason:'TORN_INVALID_KEY', metadata:{ role:'reviver' }, now:new Date('2026-08-26T10:01:00Z') });
    const held = await pool.query('SELECT payment_deadline,revive_deadline,refund_deadline,verification_hold_reason,verification_hold_metadata FROM transactions WHERE id=$1', [accepted.transaction.id]);
    assert.equal(held.rows[0].verification_hold_reason,'TORN_INVALID_KEY');
    assert.deepEqual(held.rows[0].verification_hold_metadata,{role:'reviver'});
    assert.deepEqual(held.rows[0].payment_deadline,before.rows[0].payment_deadline);
    assert.equal(held.rows[0].revive_deadline,before.rows[0].revive_deadline);
    assert.equal(held.rows[0].refund_deadline,before.rows[0].refund_deadline);
    await service.clearVerificationHold({ transactionId:accepted.transaction.id, now:new Date('2026-08-26T10:01:30Z') });
    const cleared = await pool.query('SELECT verification_hold_reason,verification_hold_started_at FROM transactions WHERE id=$1', [accepted.transaction.id]);
    assert.equal(cleared.rows[0].verification_hold_reason,null);
    assert.equal(cleared.rows[0].verification_hold_started_at,null);
  });
});

test('cancelling a repeated request locks the current open reservation rather than an old closed one', async () => {
  await withDisposableDatabase('reviverelay_stage3_cancel_current', async pool => {
    const ids = await seed(pool);
    const txRepo = createTransactionRepository(pool);
    const service = createTransactionService(pool);
    const requestRepo = createRequestRepository(pool);
    const first = await txRepo.acceptRequest({ requestId:ids.request, reviverId:ids.reviverA, now:new Date('2026-08-26T10:00:00Z') });
    await service.transitionTransaction({ transactionId:first.transaction.id, event:'deadline', actor:{type:'system'}, now:new Date('2026-08-26T10:03:00Z') });
    await service.transitionTransaction({ transactionId:first.transaction.id, event:'payment_expired', actor:{type:'system'}, now:new Date('2026-08-26T10:03:30Z') });
    const second = await txRepo.acceptRequest({ requestId:ids.request, reviverId:ids.reviverB, now:new Date('2026-08-26T10:04:00Z') });
    const result = await requestRepo.cancelRequest({ requestId:ids.request, requesterId:ids.requester, now:new Date('2026-08-26T10:04:30Z') });
    assert.equal(result.cancelled,true);
    const rows = await pool.query('SELECT id,state,closed_at FROM transactions WHERE request_id=$1 ORDER BY accepted_at', [ids.request]);
    assert.equal(rows.rows[0].state,'PAYMENT_EXPIRED');
    assert.equal(rows.rows[1].id,second.transaction.id);
    assert.equal(rows.rows[1].state,'CANCELLED_BY_REQUESTER');
    assert.ok(rows.rows[1].closed_at);
  });
});


test("retry request persists authoritative response deadline and accepted retry starts fresh five-minute SLA", async () => {
  await withDisposableDatabase("reviverelay_retry_window", async pool => {
    const ids=await seed(pool);
    const repo=createTransactionRepository(pool);
    const service=createTransactionService(pool);
    const accepted=await repo.acceptRequest({requestId:ids.request,reviverId:ids.reviverA,now:new Date("2026-08-26T10:00:00Z")});
    await pool.query("INSERT INTO payments(transaction_id,method,expected_amount,verified_amount,evidence_timestamp,verified_at) VALUES($1,$2,$3,$4,$5,$6)",[accepted.transaction.id,"xanax",1,1,new Date("2026-08-26T10:02:00Z"),new Date("2026-08-26T10:03:00Z")]);
    await service.transitionTransaction({transactionId:accepted.transaction.id,event:"payment_verified",details:{paymentVerifiedAt:new Date("2026-08-26T10:03:00Z"),reviveDeadline:new Date("2026-08-26T10:08:00Z")},now:new Date("2026-08-26T10:03:00Z")});
    await service.transitionTransaction({transactionId:accepted.transaction.id,event:"revive_failed",now:new Date("2026-08-26T10:04:00Z")});
    const retryDeadline=new Date("2026-08-26T10:06:00Z");
    const offered=await service.transitionTransaction({transactionId:accepted.transaction.id,event:"retry_requested",details:{retryResponseDeadline:retryDeadline},now:new Date("2026-08-26T10:04:00Z")});
    assert.equal(offered.transaction.state,"RETRY_OFFERED");
    assert.equal(offered.transaction.retryResponseDeadline.toISOString(),retryDeadline.toISOString());
    const revivedUntil=new Date("2026-08-26T10:10:00Z");
    const retried=await service.transitionTransaction({transactionId:accepted.transaction.id,event:"retry_accepted",details:{reviveDeadline:revivedUntil},now:new Date("2026-08-26T10:05:00Z")});
    assert.equal(retried.transaction.state,"WAITING_FOR_REVIVE");
    assert.equal(retried.transaction.reviveDeadline.toISOString(),revivedUntil.toISOString());
    assert.equal(retried.transaction.retryResponseDeadline,null);
  });
});


test('participant transaction view hides internal user UUIDs while exposing Torn identities', async () => {
  await withDisposableDatabase('reviverelay_transaction_public_view', async pool => {
    const ids=await seed(pool);
    const repo=createTransactionRepository(pool);
    const accepted=await repo.acceptRequest({requestId:ids.request,reviverId:ids.reviverA,now:new Date('2026-08-26T10:00:00Z')});
    const view=await repo.getTransactionForUser({transactionId:accepted.transaction.id,userId:ids.requester});
    assert.equal(view.participantRole,'requester');
    assert.equal(view.requester.tornId,710001);
    assert.equal(view.reviver.tornId,710002);
    assert.equal(Object.hasOwn(view,'requesterId'),false);
    assert.equal(Object.hasOwn(view,'reviverId'),false);
  });
});
