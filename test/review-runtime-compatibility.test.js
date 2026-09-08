const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {validateReviewRuntime}=require('../src/direct-api-client');

const merchant={tornId:3877028,name:'R4G3RUNN3R'};
const plans=[];

function reviewRuntime(overrides={}) {
  return {
    serverVersion:'0.6.1',
    minimumClientVersion:'0.6.1',
    releaseChannel:'review',
    subscription:{mode:'review',paymentsEnabled:true,merchant,plans},
    ...overrides
  };
}

test('missing runtime metadata fails closed',()=>{
  assert.deepEqual(validateReviewRuntime(null,{clientVersion:'0.6.1',releaseChannel:'review'}),{
    compatible:false,
    reason:'RUNTIME_MISSING',
    subscription:null
  });
});

test('review client rejects stable or malformed backend contracts',()=>{
  const stable=validateReviewRuntime(reviewRuntime({releaseChannel:'stable',subscription:{mode:'free',paymentsEnabled:false,merchant:null,plans}}),{
    clientVersion:'0.6.1',releaseChannel:'review'
  });
  assert.equal(stable.compatible,false);
  assert.equal(stable.reason,'RUNTIME_CHANNEL_MISMATCH');

  const malformed=validateReviewRuntime(reviewRuntime({minimumClientVersion:'0.6'}),{
    clientVersion:'0.6.1',releaseChannel:'review'
  });
  assert.equal(malformed.compatible,false);
  assert.equal(malformed.reason,'RUNTIME_VERSION_INVALID');
});

test('review runtime accepts compatible review contract and server-owned subscription state',()=>{
  const result=validateReviewRuntime(reviewRuntime(),{clientVersion:'0.6.1',releaseChannel:'review'});
  assert.equal(result.compatible,true);
  assert.equal(result.reason,null);
  assert.deepEqual(result.subscription,{mode:'review',paymentsEnabled:true,merchant,plans});
});

test('client below server minimum is incompatible',()=>{
  const result=validateReviewRuntime(reviewRuntime({minimumClientVersion:'0.6.2'}),{
    clientVersion:'0.6.1',releaseChannel:'review'
  });
  assert.equal(result.compatible,false);
  assert.equal(result.reason,'CLIENT_TOO_OLD');
});

test('userscript review build has no missing-subscription free fallback and targets review API base',()=>{
  const source=fs.readFileSync('torn-revive-chat-collector.user.js','utf8');
  assert.doesNotMatch(source,/state\.subscription\?\.mode\s*\|\|\s*['"]free['"]/);
  assert.match(source,/const API_BASE = 'https:\/\/reviverelay\.voidsmithindustries\.com\/review'/);
  assert.match(source,/runtimeCompatibility/);
});
