const test=require("node:test");
const assert=require("node:assert/strict");
const { createRefundVerifyHandler, REFUND_RECONCILE_GRACE_MS }=require("../../src/worker/refund-verify");

function context(overrides={}) { return {
  transactionId:"txn",state:"REFUND_REQUIRED",verificationHoldReason:null,
  requesterUserId:"requester-user",reviverUserId:"reviver-user",requesterTornId:111,reviverTornId:222,
  method:"xanax",requiredAmount:4,refundRequiredAt:new Date("2026-08-26T10:10:00Z"),refundDeadline:new Date("2026-08-26T10:20:00Z"),verifiedAt:null,...overrides
}; }
function setup({now="2026-08-26T10:12:00Z",ctx=context(),evidence=[],evidenceError=null}={}) {
  const transitions=[];const records=[];const holds=[];const clears=[];
  const refundRepository={async getVerificationContext(){return ctx;},async recordRefundEvidence(input){records.push(input);return {verifiedAmount:input.evidence.reduce((n,r)=>n+r.amount,0),verifiedAt:input.verifiedAt};}};
  const transactionService={async transitionTransaction(input){transitions.push(input);return {transitioned:true,transaction:{...ctx,state:input.event==="refund_verified"?"REFUNDED":input.event==="deadline"?"REFUND_RECONCILING":input.event==="missing_refund"?"REPORTABLE_MISSING_REFUND":ctx.state}};},async setVerificationHold(i){holds.push(i);},async clearVerificationHold(i){clears.push(i);}};
  const evidenceService={async getOutgoingRefundEvidence(){if(evidenceError)throw evidenceError;return evidence;}};
  return {handler:createRefundVerifyHandler({refundRepository,transactionService,evidenceService,clock:()=>new Date(now)}),transitions,records,holds,clears};
}

test("verified split refund records evidence and closes REFUNDED",async()=>{
  const s=setup({evidence:[{id:"r1",recipientId:111,kind:"xanax",amount:1,at:new Date("2026-08-26T10:11:00Z")},{id:"r2",recipientId:111,kind:"xanax",amount:3,at:new Date("2026-08-26T10:12:00Z")} ]});
  const out=await s.handler({entityId:"txn"});assert.equal(out.status,"complete");assert.equal(s.records.length,1);assert.ok(s.records[0].verifiedAt);assert.equal(s.transitions.at(-1).event,"refund_verified");
});

test("partial refund before deadline is preserved and rescheduled without misconduct",async()=>{
  const s=setup({evidence:[{id:"r1",recipientId:111,kind:"xanax",amount:1,at:new Date("2026-08-26T10:11:00Z")}]});
  const out=await s.handler({entityId:"txn"});assert.equal(out.status,"reschedule");assert.equal(s.records[0].verifiedAt,null);assert.equal(s.transitions.length,0);
});

test("deadline enters reconciliation and only becomes reportable after grace",async()=>{
  const first=setup({now:"2026-08-26T10:20:00Z"});const out1=await first.handler({entityId:"txn"});assert.equal(first.transitions[0].event,"deadline");assert.equal(out1.status,"reschedule");
  const before=setup({now:new Date(new Date("2026-08-26T10:20:00Z").getTime()+REFUND_RECONCILE_GRACE_MS-1).toISOString(),ctx:context({state:"REFUND_RECONCILING"})});const out2=await before.handler({entityId:"txn"});assert.equal(out2.status,"reschedule");assert.equal(before.transitions.length,0);
  const after=setup({now:new Date(new Date("2026-08-26T10:20:00Z").getTime()+REFUND_RECONCILE_GRACE_MS+1).toISOString(),ctx:context({state:"REFUND_RECONCILING"})});const out3=await after.handler({entityId:"txn"});assert.equal(out3.status,"complete");assert.equal(after.transitions.at(-1).event,"missing_refund");
});

test("on-time evidence surfaced during reconciliation still verifies",async()=>{
  const s=setup({now:"2026-08-26T10:20:20Z",ctx:context({state:"REFUND_RECONCILING"}),evidence:[{id:"r1",recipientId:111,kind:"xanax",amount:4,at:new Date("2026-08-26T10:19:59Z")}]});
  const out=await s.handler({entityId:"txn"});assert.equal(out.status,"complete");assert.equal(s.transitions.at(-1).event,"refund_verified");
});

test("credential/Torn failure creates verification hold and retry only",async()=>{
  const err=Object.assign(new Error("invalid"),{code:"VERIFICATION_CREDENTIAL_INVALID"});const s=setup({evidenceError:err});const out=await s.handler({entityId:"txn"});assert.equal(out.status,"reschedule");assert.equal(s.holds[0].reason,"VERIFICATION_CREDENTIAL_INVALID");assert.equal(s.transitions.length,0);
});
