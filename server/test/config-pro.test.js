const test=require('node:test');
const assert=require('node:assert/strict');
const {loadConfig}=require('../src/config');

const BASE={
  NODE_ENV:'test',
  DATABASE_URL:'postgres://reviverelay:test@localhost/reviverelay_test',
  API_KEY_ENCRYPTION_KEY:'d'.repeat(64),
  SESSION_TOKEN_PEPPER:'pepper'
};

test('paid tier disabled does not require receiving-account credentials',()=>{
  const config=loadConfig({...BASE,PAID_TIER_ENABLED:'false'});
  assert.equal(config.PAID_TIER_ENABLED,false);
  assert.equal(config.PRO_RECEIVER_TORN_ID,undefined);
  assert.equal(config.PRO_RECEIVER_API_KEY,undefined);
});

test('paid tier requires both receiving Torn ID and API key',()=>{
  assert.throws(()=>loadConfig({...BASE,PAID_TIER_ENABLED:'true'}),/PRO_RECEIVER/);
  assert.throws(()=>loadConfig({...BASE,PAID_TIER_ENABLED:'true',PRO_RECEIVER_TORN_ID:'123456'}),/PRO_RECEIVER_API_KEY/);
  assert.throws(()=>loadConfig({...BASE,PAID_TIER_ENABLED:'true',PRO_RECEIVER_API_KEY:'restricted-key'}),/PRO_RECEIVER_TORN_ID/);
});

test('paid tier accepts a complete receiving-account configuration',()=>{
  const config=loadConfig({
    ...BASE,
    PAID_TIER_ENABLED:'true',
    PRO_RECEIVER_TORN_ID:'123456',
    PRO_RECEIVER_API_KEY:'restricted-key'
  });
  assert.equal(config.PAID_TIER_ENABLED,true);
  assert.equal(config.PRO_RECEIVER_TORN_ID,123456);
  assert.equal(config.PRO_RECEIVER_API_KEY,'restricted-key');
});
