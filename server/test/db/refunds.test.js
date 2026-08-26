const test = require("node:test");
const assert = require("node:assert/strict");
const { withDisposableDatabase } = require("../../test-support/database");
const { createRefundRepository } = require("../../src/db/refunds");

async function seedRefund(pool) {
  const requester=(await pool.query("INSERT INTO users(torn_id,current_name) VALUES($1,$2) RETURNING id",[820001,"requester"])).rows[0].id;
  const reviver=(await pool.query("INSERT INTO users(torn_id,current_name) VALUES($1,$2) RETURNING id",[820002,"reviver"])).rows[0].id;
  const request=(await pool.query("INSERT INTO revive_requests(requester_id,payment_method,offer_amount,state) VALUES($1,$2,$3,$4) RETURNING id",[requester,"xanax",3,"REFUND_REQUIRED"])).rows[0].id;
  const tx=(await pool.query("INSERT INTO transactions(request_id,requester_id,reviver_id,state,accepted_at,payment_deadline,payment_verified_at,refund_required_at,refund_deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",[request,requester,reviver,"REFUND_REQUIRED",new Date("2026-08-26T10:00:00Z"),new Date("2026-08-26T10:03:00Z"),new Date("2026-08-26T10:04:00Z"),new Date("2026-08-26T10:10:00Z"),new Date("2026-08-26T10:20:00Z")])).rows[0].id;
  await pool.query("INSERT INTO payments(transaction_id,method,expected_amount,verified_amount,evidence_timestamp,verified_at) VALUES($1,$2,$3,$4,$5,$6)",[tx,"xanax",3,4,new Date("2026-08-26T10:02:00Z"),new Date("2026-08-26T10:04:00Z")]);
  const refund=(await pool.query("INSERT INTO refunds(transaction_id,method,required_amount,required_at,deadline) VALUES($1,$2,$3,$4,$5) RETURNING id",[tx,"xanax",4,new Date("2026-08-26T10:10:00Z"),new Date("2026-08-26T10:20:00Z")])).rows[0].id;
  return {requester,reviver,tx,refund};
}

test("refund context uses actual verified payment value and Torn identities", async () => {
  await withDisposableDatabase("reviverelay_refund_context", async pool => {
    const ids=await seedRefund(pool);
    const repo=createRefundRepository(pool);
    const ctx=await repo.getVerificationContext(ids.tx);
    assert.equal(ctx.requiredAmount,4);
    assert.equal(ctx.method,"xanax");
    assert.equal(ctx.requesterTornId,820001);
    assert.equal(ctx.reviverTornId,820002);
    assert.equal(ctx.state,"REFUND_REQUIRED");
  });
});

test("refund evidence is idempotent, split-aware and only marks verified when total covers required amount", async () => {
  await withDisposableDatabase("reviverelay_refund_evidence", async pool => {
    const ids=await seedRefund(pool);
    const repo=createRefundRepository(pool);
    let result=await repo.recordRefundEvidence({transactionId:ids.tx,evidence:[
      {id:"r1",recipientId:820001,kind:"xanax",amount:1,at:new Date("2026-08-26T10:12:00Z")}
    ],verifiedAt:null});
    assert.equal(result.verifiedAmount,1);
    assert.equal(result.verifiedAt,null);
    result=await repo.recordRefundEvidence({transactionId:ids.tx,evidence:[
      {id:"r1",recipientId:820001,kind:"xanax",amount:1,at:new Date("2026-08-26T10:12:00Z")},
      {id:"r2",recipientId:820001,kind:"xanax",amount:3,at:new Date("2026-08-26T10:15:00Z")}
    ],verifiedAt:new Date("2026-08-26T10:21:00Z")});
    assert.equal(result.verifiedAmount,4);
    assert.equal(result.verifiedAt.toISOString(),"2026-08-26T10:21:00.000Z");
    const count=await pool.query("SELECT COUNT(*)::int AS count FROM refund_evidence WHERE refund_id=$1",[ids.refund]);
    assert.equal(count.rows[0].count,2);
  });
});
