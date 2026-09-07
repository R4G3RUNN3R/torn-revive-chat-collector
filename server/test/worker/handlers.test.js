const test=require("node:test");
const assert=require("node:assert/strict");
const {buildStageThreeHandlers}=require("../../src/worker");

test("Stage 3 handler registry installs payment, revive and refund verification",async()=>{
 const payment=async()=>({status:"complete"});
 const revive=async()=>({status:"complete"});
 const refund=async()=>({status:"complete"});
 const sheets=async()=>({status:"reschedule",runAt:new Date()});
 const retention=async()=>({status:"reschedule",runAt:new Date()});
 const subscription=async()=>({status:"reschedule",runAt:new Date()});
 const handlers=buildStageThreeHandlers({paymentVerifyHandler:payment,reviveVerifyHandler:revive,refundVerifyHandler:refund,sheetsMirrorHandler:sheets,telemetryRetentionHandler:retention,subscriptionScanHandler:subscription});
 assert.equal(handlers["payment.verify"],payment);
 assert.equal(handlers["revive.verify"],revive);
 assert.equal(handlers["refund.verify"],refund);
 assert.equal(handlers["sheets.mirror"],sheets);
 assert.equal(handlers["telemetry.retention"],retention);
 assert.equal(handlers["subscription.scan"],subscription);
});


test('free-mode handler registry safely completes a stale subscription scan without processing billing',async()=>{
 const payment=async()=>({status:'complete'});
 const revive=async()=>({status:'complete'});
 const refund=async()=>({status:'complete'});
 const handlers=buildStageThreeHandlers({paymentVerifyHandler:payment,reviveVerifyHandler:revive,refundVerifyHandler:refund});
 assert.deepEqual(await handlers['subscription.scan']({type:'subscription.scan'}),{status:'complete'});
});
