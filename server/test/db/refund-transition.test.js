const test = require("node:test");
const assert = require("node:assert/strict");
const { withDisposableDatabase } = require("../../test-support/database");
const { createTransactionRepository } = require("../../src/db/transactions");
const { createTransactionService } = require("../../src/domain/transaction-service");

test("entering REFUND_REQUIRED atomically creates exact refund obligation and one refund verification job", async () => {
  await withDisposableDatabase("reviverelay_refund_transition", async pool => {
    const requester=(await pool.query("INSERT INTO users(torn_id,current_name) VALUES($1,$2) RETURNING id",[830001,"requester"])).rows[0].id;
    const reviver=(await pool.query("INSERT INTO users(torn_id,current_name) VALUES($1,$2) RETURNING id",[830002,"reviver"])).rows[0].id;
    await pool.query("INSERT INTO revivers(user_id,standing) VALUES($1,$2)",[reviver,"active"]);
    const request=(await pool.query("INSERT INTO revive_requests(requester_id,payment_method,offer_amount,state) VALUES($1,$2,$3,$4) RETURNING id",[requester,"xanax",3,"AVAILABLE"])).rows[0].id;
    const accepted=await createTransactionRepository(pool).acceptRequest({requestId:request,reviverId:reviver,now:new Date("2026-08-26T10:00:00Z")});
    await pool.query("INSERT INTO payments(transaction_id,method,expected_amount,verified_amount,evidence_timestamp,verified_at) VALUES($1,$2,$3,$4,$5,$6)",[accepted.transaction.id,"xanax",3,4,new Date("2026-08-26T10:02:00Z"),new Date("2026-08-26T10:03:00Z")]);
    const service=createTransactionService(pool);
    await service.transitionTransaction({transactionId:accepted.transaction.id,event:"payment_verified",details:{paymentVerifiedAt:new Date("2026-08-26T10:03:00Z"),reviveDeadline:new Date("2026-08-26T10:08:00Z")},now:new Date("2026-08-26T10:03:00Z")});
    const transition=await service.transitionTransaction({transactionId:accepted.transaction.id,event:"third_party_revive",now:new Date("2026-08-26T10:04:00Z")});
    assert.equal(transition.transaction.state,"REFUND_REQUIRED");
    const refund=await pool.query("SELECT method,required_amount,required_at,deadline FROM refunds WHERE transaction_id=$1",[accepted.transaction.id]);
    assert.equal(refund.rowCount,1);
    assert.equal(refund.rows[0].method,"xanax");
    assert.equal(Number(refund.rows[0].required_amount),4);
    assert.equal(refund.rows[0].deadline.toISOString(),"2026-08-26T10:14:00.000Z");
    const jobs=await pool.query("SELECT type,dedupe_key FROM jobs WHERE entity_id=$1 AND completed_at IS NULL AND type=$2",[accepted.transaction.id,"refund.verify"]);
    assert.deepEqual(jobs.rows,[{type:"refund.verify",dedupe_key:`refund.verify:${accepted.transaction.id}`}]);
  });
});


test("mismatched pre-existing refund obligation fails closed instead of silently accepting a different contract", async () => {
  await withDisposableDatabase("reviverelay_refund_conflict", async pool => {
    const requester=(await pool.query("INSERT INTO users(torn_id,current_name) VALUES($1,$2) RETURNING id",[831001,"requester"])).rows[0].id;
    const reviver=(await pool.query("INSERT INTO users(torn_id,current_name) VALUES($1,$2) RETURNING id",[831002,"reviver"])).rows[0].id;
    await pool.query("INSERT INTO revivers(user_id,standing) VALUES($1,$2)",[reviver,"active"]);
    const request=(await pool.query("INSERT INTO revive_requests(requester_id,payment_method,offer_amount,state) VALUES($1,$2,$3,$4) RETURNING id",[requester,"xanax",3,"AVAILABLE"])).rows[0].id;
    const accepted=await createTransactionRepository(pool).acceptRequest({requestId:request,reviverId:reviver,now:new Date("2026-08-26T10:00:00Z")});
    await pool.query("INSERT INTO payments(transaction_id,method,expected_amount,verified_amount,evidence_timestamp,verified_at) VALUES($1,$2,$3,$4,$5,$6)",[accepted.transaction.id,"xanax",3,4,new Date("2026-08-26T10:02:00Z"),new Date("2026-08-26T10:03:00Z")]);
    const service=createTransactionService(pool);
    await service.transitionTransaction({transactionId:accepted.transaction.id,event:"payment_verified",details:{paymentVerifiedAt:new Date("2026-08-26T10:03:00Z"),reviveDeadline:new Date("2026-08-26T10:08:00Z")},now:new Date("2026-08-26T10:03:00Z")});
    await pool.query("INSERT INTO refunds(transaction_id,method,required_amount,required_at,deadline) VALUES($1,$2,$3,$4,$5)",[accepted.transaction.id,"xanax",3,new Date("2026-08-26T10:04:00Z"),new Date("2026-08-26T10:14:00Z")]);
    await assert.rejects(
      service.transitionTransaction({transactionId:accepted.transaction.id,event:"third_party_revive",now:new Date("2026-08-26T10:04:00Z")}),
      /refund obligation does not match/i
    );
    const row=await pool.query("SELECT state FROM transactions WHERE id=$1",[accepted.transaction.id]);
    assert.equal(row.rows[0].state,"WAITING_FOR_REVIVE");
  });
});
