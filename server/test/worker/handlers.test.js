const test=require("node:test");
const assert=require("node:assert/strict");
const {buildStageThreeHandlers}=require("../../src/worker");

test("Stage 3 handler registry installs payment, revive and refund verification",async()=>{
 const payment=async()=>({status:"complete"});
 const revive=async()=>({status:"complete"});
 const refund=async()=>({status:"complete"});
 const handlers=buildStageThreeHandlers({paymentVerifyHandler:payment,reviveVerifyHandler:revive,refundVerifyHandler:refund});
 assert.equal(handlers["payment.verify"],payment);
 assert.equal(handlers["revive.verify"],revive);
 assert.equal(handlers["refund.verify"],refund);
 await assert.rejects(()=>handlers["subscription.scan"]({type:"subscription.scan"}),/not implemented in Stage 3 yet/i);
});
