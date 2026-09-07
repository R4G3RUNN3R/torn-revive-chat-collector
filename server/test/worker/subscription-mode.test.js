const test=require('node:test');
const assert=require('node:assert/strict');
const {configureSubscriptionScan}=require('../../src/worker');

function dependencies(mode,{receiverTornId=3877028}={}) {
  const calls={factory:0,validate:0,handler:0,enqueue:0};
  const handler=async()=>({status:'reschedule',runAt:new Date()});
  return {
    calls,
    handler,
    input:{
      config:{
        SUBSCRIPTION_MODE:mode,
        PRO_RECEIVER_TORN_ID:receiverTornId,
        PRO_RECEIVER_API_KEY:'restricted-merchant-key'
      },
      tornClient:{},
      logMetadataResolver:{},
      proInvoiceRepository:{},
      jobRepository:{
        async enqueueUniqueJob(input){
          calls.enqueue += 1;
          assert.equal(input.type,'subscription.scan');
          assert.equal(input.dedupeKey,'subscription.scan:reviver-pro');
          assert.deepEqual(input.payload,{});
        }
      },
      evidenceFactory(options){
        calls.factory += 1;
        assert.equal(options.receiverTornId,3877028);
        assert.equal(options.receiverApiKey,'restricted-merchant-key');
        return {
          async validateCredential(){calls.validate += 1;}
        };
      },
      handlerFactory(options){
        calls.handler += 1;
        assert.ok(options.evidenceService);
        return handler;
      }
    }
  };
}

test('free mode never constructs or validates merchant billing evidence and never enqueues a subscription scan',async()=>{
  const d=dependencies('free');
  const result=await configureSubscriptionScan(d.input);
  assert.equal(result,null);
  assert.deepEqual(d.calls,{factory:0,validate:0,handler:0,enqueue:0});
});

for (const mode of ['review','live']) {
  test(`${mode} mode validates the restricted canonical merchant credential before enabling subscription scans`,async()=>{
    const d=dependencies(mode);
    const result=await configureSubscriptionScan(d.input);
    assert.equal(result,d.handler);
    assert.deepEqual(d.calls,{factory:1,validate:1,handler:1,enqueue:1});
  });
}

test('review/live reject a non-canonical merchant identity before evidence initialization',async()=>{
  const d=dependencies('review',{receiverTornId:999999});
  await assert.rejects(()=>configureSubscriptionScan(d.input),/3877028|canonical merchant/i);
  assert.deepEqual(d.calls,{factory:0,validate:0,handler:0,enqueue:0});
});
