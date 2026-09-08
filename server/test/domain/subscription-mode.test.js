const test=require('node:test');
const assert=require('node:assert/strict');
const {
  normalizeSubscriptionMode,
  paymentsEnabled,
  subscriptionRequiresEntitlement,
  publicSubscriptionState,
  isCanonicalOwner
}=require('../../src/domain/subscription-mode');
const {hasActivePro,resolvePublicProStatus}=require('../../src/security/pro-access');

const PLANS=[{id:'monthly',label:'Monthly',months:1,xanax:10,cash:10000000}];

test('subscription policy recognizes only free review and live',()=>{
  for (const mode of ['free','review','live']) assert.equal(normalizeSubscriptionMode(mode),mode);
  assert.equal(normalizeSubscriptionMode(undefined),'free');
  assert.throws(()=>normalizeSubscriptionMode('paid'),/subscription mode/i);
});

test('only review and live require entitlement and enable manual subscription payments',()=>{
  assert.equal(subscriptionRequiresEntitlement('free'),false);
  assert.equal(paymentsEnabled('free'),false);
  for (const mode of ['review','live']) {
    assert.equal(subscriptionRequiresEntitlement(mode),true);
    assert.equal(paymentsEnabled(mode),true);
  }
});

test('public subscription state exposes server plans and canonical merchant only when payments are enabled',()=>{
  assert.deepEqual(publicSubscriptionState({mode:'free',receiverTornId:3877028,plans:PLANS}),{
    mode:'free',paymentsEnabled:false,merchant:null,plans:PLANS
  });
  assert.deepEqual(publicSubscriptionState({mode:'review',receiverTornId:3877028,plans:PLANS}),{
    mode:'review',paymentsEnabled:true,merchant:{tornId:3877028,name:'R4G3RUNN3R'},plans:PLANS
  });
});


test('canonical payment recipient is the only server-derived OWNER identity in paid modes',()=>{
  const subscription=publicSubscriptionState({mode:'review',receiverTornId:3877028,plans:PLANS});
  assert.equal(isCanonicalOwner({tornId:3877028,subscription}),true);
  assert.equal(isCanonicalOwner({tornId:3877029,subscription}),false);
  assert.equal(isCanonicalOwner({tornId:3877028,subscription:publicSubscriptionState({mode:'free',receiverTornId:3877028,plans:PLANS})}),false);
});

test('OWNER public status is lifetime and cannot be spoofed by a non-owner entitlement row',()=>{
  const subscription=publicSubscriptionState({mode:'review',receiverTornId:3877028,plans:PLANS});
  assert.deepEqual(resolvePublicProStatus({
    status:{state:'NONE',trialEligible:true,trialStartedAt:null,validUntil:null},
    tornId:3877028,
    subscription
  }),{
    state:'OWNER',trialEligible:false,trialStartedAt:null,validUntil:null
  });
  assert.deepEqual(resolvePublicProStatus({
    status:{state:'OWNER',trialEligible:false,trialStartedAt:null,validUntil:null},
    tornId:3877029,
    subscription
  }),{
    state:'NONE',trialEligible:false,trialStartedAt:null,validUntil:null
  });
  assert.equal(hasActivePro({state:'OWNER'}),true);
});
