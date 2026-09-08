const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {
  runSubscriptionLoop,
  configureReviewSubscriptionHandler
}=require('../src/review-subscription-worker');

test('review subscription loop sleeps until handler reschedule time and stops cleanly',async()=>{
  const signal={stop:false};
  const sleeps=[];
  const handled=[];
  await runSubscriptionLoop({
    handler:async()=>{
      handled.push('scan');
      return {status:'reschedule',runAt:new Date('2026-09-07T12:01:00Z')};
    },
    sleep:async ms=>{sleeps.push(ms);signal.stop=true;},
    signal,
    clock:()=>new Date('2026-09-07T12:00:00Z'),
    logger:{error(){}}
  });
  assert.deepEqual(handled,['scan']);
  assert.deepEqual(sleeps,[60000]);
});

test('review subscription handler validates canonical merchant credential once without a jobs repository',async()=>{
  let validations=0;
  let handlerFactoryCalls=0;
  const handler=async()=>({status:'reschedule',runAt:new Date('2026-09-07T12:01:00Z')});
  const configured=await configureReviewSubscriptionHandler({
    config:{SUBSCRIPTION_MODE:'review',PRO_RECEIVER_TORN_ID:3877028,PRO_RECEIVER_API_KEY:'restricted-test-key'},
    tornClient:{},
    logMetadataResolver:{},
    invoiceRepository:{},
    evidenceFactory:()=>({
      async validateCredential(){validations+=1;},
      async getIncomingEvidence(){return [];}
    }),
    handlerFactory:({invoiceRepository,evidenceService})=>{
      handlerFactoryCalls+=1;
      assert.ok(invoiceRepository);
      assert.ok(evidenceService);
      return handler;
    }
  });
  assert.equal(configured,handler);
  assert.equal(validations,1);
  assert.equal(handlerFactoryCalls,1);
});

test('review subscription setup rejects non-review mode and non-canonical merchant',async()=>{
  const common={
    tornClient:{},logMetadataResolver:{},invoiceRepository:{},
    evidenceFactory:()=>({async validateCredential(){}}),
    handlerFactory:()=>async()=>({status:'complete'})
  };
  await assert.rejects(()=>configureReviewSubscriptionHandler({
    ...common,config:{SUBSCRIPTION_MODE:'free',PRO_RECEIVER_TORN_ID:3877028,PRO_RECEIVER_API_KEY:'x'}
  }),/review mode/i);
  await assert.rejects(()=>configureReviewSubscriptionHandler({
    ...common,config:{SUBSCRIPTION_MODE:'review',PRO_RECEIVER_TORN_ID:123,PRO_RECEIVER_API_KEY:'x'}
  }),/canonical merchant/i);
});

test('review subscription worker has no dependency on the shared generic jobs queue',()=>{
  const source=fs.readFileSync('server/src/review-subscription-worker.js','utf8');
  assert.doesNotMatch(source,/createJobRepository|enqueueUniqueJob|claimDueJobs|\.\/db\/jobs/);
});
