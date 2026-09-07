const test=require('node:test');
const assert=require('node:assert/strict');
const {loadConfig}=require('../src/config');

const BASE={
  NODE_ENV:'test',
  DATABASE_URL:'postgres://reviverelay:test@localhost/reviverelay_test',
  API_KEY_ENCRYPTION_KEY:'d'.repeat(64),
  SESSION_TOKEN_PEPPER:'pepper'
};

test('subscription mode defaults to free without merchant credentials or legacy paid-tier boolean',()=>{
  const config=loadConfig(BASE);
  assert.equal(config.SUBSCRIPTION_MODE,'free');
  assert.equal(Object.hasOwn(config,'PAID_TIER_ENABLED'),false);
  assert.equal(config.PRO_RECEIVER_TORN_ID,undefined);
  assert.equal(config.PRO_RECEIVER_API_KEY,undefined);
});

test('subscription mode accepts only free review or live',()=>{
  for (const mode of ['free','review','live']) {
    const extra=mode==='free' ? {} : {PRO_RECEIVER_TORN_ID:'3877028',PRO_RECEIVER_API_KEY:'restricted-key'};
    assert.equal(loadConfig({...BASE,SUBSCRIPTION_MODE:mode,...extra}).SUBSCRIPTION_MODE,mode);
  }
  assert.throws(()=>loadConfig({...BASE,SUBSCRIPTION_MODE:'disabled'}),/SUBSCRIPTION_MODE|Invalid enum|Invalid option/i);
  assert.throws(()=>loadConfig({...BASE,SUBSCRIPTION_MODE:'paid'}),/SUBSCRIPTION_MODE|Invalid enum|Invalid option/i);
});

test('review and live require both receiving Torn ID and restricted merchant API credential',()=>{
  for (const mode of ['review','live']) {
    assert.throws(()=>loadConfig({...BASE,SUBSCRIPTION_MODE:mode}),/PRO_RECEIVER/);
    assert.throws(()=>loadConfig({...BASE,SUBSCRIPTION_MODE:mode,PRO_RECEIVER_TORN_ID:'3877028'}),/PRO_RECEIVER_API_KEY/);
    assert.throws(()=>loadConfig({...BASE,SUBSCRIPTION_MODE:mode,PRO_RECEIVER_API_KEY:'restricted-key'}),/PRO_RECEIVER_TORN_ID/);
  }
});

test('review and live accept complete receiving-account configuration',()=>{
  for (const mode of ['review','live']) {
    const config=loadConfig({
      ...BASE,
      SUBSCRIPTION_MODE:mode,
      PRO_RECEIVER_TORN_ID:'3877028',
      PRO_RECEIVER_API_KEY:'restricted-key'
    });
    assert.equal(config.SUBSCRIPTION_MODE,mode);
    assert.equal(config.PRO_RECEIVER_TORN_ID,3877028);
    assert.equal(config.PRO_RECEIVER_API_KEY,'restricted-key');
  }
});
