const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

const REQUEST_ID='55555555-5555-4555-8555-555555555555';
const AUTH={authorization:'Bearer reviver-token'};

function makeApp({
  state,
  subscriptionMode='review',
  reviverStanding='active',
  credentialStatus={id:'cred',usable:true,capabilities:{reviver:true,requester:false}},
  perksJob=['+ Ability to revive']
}) {
  return buildApp({
    config:{
      API_KEY_ENCRYPTION_KEY:'bb'.repeat(32),
      SESSION_TOKEN_PEPPER:'gate-pepper',
      SUBSCRIPTION_MODE:subscriptionMode,
      PRO_RECEIVER_TORN_ID:3877028
    },
    tornClient:{
      async getKeyInfo(){throw new Error('not used');},
      async getUserPerks(){return {job:perksJob};}
    },
    identityRepository:{async bindIdentity(){}},
    sessionRepository:{
      async findByTokenHash(){
        return {
          sessionId:'s',userId:'reviver-user',tornId:888001,name:'Gate Tester',
          expiresAt:null,revokedAt:null,reviverStanding,activeBan:false
        };
      }
    },
    entitlementRepository:{
      async getStatus(){return {state,trialEligible:false,trialStartedAt:null,validUntil:null};},
      async startTrial(){throw new Error('not used');}
    },
    verificationCredentialRepository:{
      async getStatus(){return credentialStatus;},
      async getDecryptedActiveForUser(){return credentialStatus ? {plaintextKey:'verification-key',status:credentialStatus} : null;},
      async markUnusable(){},
      async bind(){throw new Error('not used');},
      async revoke(){return false;}
    },
    logMetadataResolver:{async get(){return {categories:{}};}},
    reviverRepository:{async register(){return {registered:true,reviver:{userId:'reviver-user',standing:'active'}};}},
    transactionRepository:{
      async listAvailableRequests(){return [{id:REQUEST_ID,state:'AVAILABLE',origin:'reviverelay_direct',certified:true}];},
      async acceptRequest(input){return {accepted:true,transaction:{id:'tx-1',requestId:input.requestId,state:'WAITING_FOR_PAYMENT'}};}
    }
  });
}

for (const subscriptionMode of ['review','live']) {
  for (const state of ['NONE','EXPIRED','REVOKED']) {
    test(`${subscriptionMode} mode blocks ${state} entitlement from reviver surfaces`, async t => {
      const app=makeApp({state,subscriptionMode});
      t.after(()=>app.close());
      const queue=await app.inject({method:'GET',url:'/v1/reviver/queue',headers:AUTH});
      const accept=await app.inject({method:'POST',url:`/v1/requests/${REQUEST_ID}/accept`,headers:AUTH});
      const register=await app.inject({method:'POST',url:'/v1/reviver/register',headers:AUTH});
      for (const response of [queue,accept,register]) {
        assert.equal(response.statusCode,403,response.body);
        assert.equal(response.json().error,'REVIVER_PRO_REQUIRED');
      }
    });
  }
}

for (const subscriptionMode of ['review','live']) {
  for (const state of ['TRIAL','ACTIVE']) {
    test(`${subscriptionMode} mode allows ${state} entitlement to reach reviver authorization`, async t => {
      const app=makeApp({state,subscriptionMode});
      t.after(()=>app.close());
      assert.equal((await app.inject({method:'GET',url:'/v1/reviver/queue',headers:AUTH})).statusCode,200);
      assert.equal((await app.inject({method:'POST',url:`/v1/requests/${REQUEST_ID}/accept`,headers:AUTH})).statusCode,200);
      assert.equal((await app.inject({method:'POST',url:'/v1/reviver/register',headers:AUTH})).statusCode,200);
    });
  }
}

test('free mode waives only Pro entitlement and allows an otherwise eligible reviver', async t => {
  const app=makeApp({state:'NONE',subscriptionMode:'free'});
  t.after(()=>app.close());
  assert.equal((await app.inject({method:'GET',url:'/v1/reviver/queue',headers:AUTH})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:`/v1/requests/${REQUEST_ID}/accept`,headers:AUTH})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/v1/reviver/register',headers:AUTH})).statusCode,200);
});

test('free mode still requires reviver role for queue and verification credential for registration', async t => {
  const app=makeApp({state:'NONE',subscriptionMode:'free',reviverStanding:null,credentialStatus:null});
  t.after(()=>app.close());
  const queue=await app.inject({method:'GET',url:'/v1/reviver/queue',headers:AUTH});
  assert.equal(queue.statusCode,403);
  assert.equal(queue.json().error,'REVIVER_REQUIRED');
  const register=await app.inject({method:'POST',url:'/v1/reviver/register',headers:AUTH});
  assert.equal(register.statusCode,409);
  assert.equal(register.json().error,'VERIFICATION_CREDENTIAL_REQUIRED');
});

test('free mode still blocks a grandfathered reviver without current Torn revive ability', async t => {
  const app=makeApp({state:'NONE',subscriptionMode:'free',perksJob:['+ 10% Crime success']});
  t.after(()=>app.close());
  for (const response of [
    await app.inject({method:'GET',url:'/v1/reviver/queue',headers:AUTH}),
    await app.inject({method:'POST',url:`/v1/requests/${REQUEST_ID}/accept`,headers:AUTH}),
    await app.inject({method:'POST',url:'/v1/reviver/register',headers:AUTH})
  ]) {
    assert.equal(response.statusCode,403,response.body);
    assert.equal(response.json().error,'REVIVE_ABILITY_NOT_UNLOCKED');
  }
});
