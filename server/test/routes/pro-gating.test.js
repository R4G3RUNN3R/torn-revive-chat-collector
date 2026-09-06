const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

const REQUEST_ID='55555555-5555-4555-8555-555555555555';
const AUTH={authorization:'Bearer reviver-token'};

function makeApp({ state, reviverStanding='active', credentialStatus={id:'cred',usable:true,capabilities:{reviver:true,requester:false}} }) {
  return buildApp({
    config:{API_KEY_ENCRYPTION_KEY:'bb'.repeat(32),SESSION_TOKEN_PEPPER:'gate-pepper'},
    tornClient:{
      async getKeyInfo(){throw new Error('not used');},
      async getUserPerks(){return {job:['+ Ability to revive']};}
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

for (const state of ['NONE','EXPIRED']) {
  test(`${state} entitlement cannot read queue, accept, or register as reviver`, async t => {
    const app=makeApp({state,reviverStanding:null,credentialStatus:null});
    t.after(()=>app.close());
    const queue=await app.inject({method:'GET',url:'/v1/reviver/queue',headers:AUTH});
    const accept=await app.inject({method:'POST',url:`/v1/requests/${REQUEST_ID}/accept`,headers:AUTH});
    const register=await app.inject({method:'POST',url:'/v1/reviver/register',headers:AUTH});
    for (const response of [queue,accept,register]) {
      assert.equal(response.statusCode,403);
      assert.equal(response.json().error,'REVIVER_PRO_REQUIRED');
    }
  });
}

for (const state of ['TRIAL','ACTIVE']) {
  test(`${state} entitlement reaches existing reviver and credential authorization`, async t => {
    const app=makeApp({state});
    t.after(()=>app.close());
    const queue=await app.inject({method:'GET',url:'/v1/reviver/queue',headers:AUTH});
    const accept=await app.inject({method:'POST',url:`/v1/requests/${REQUEST_ID}/accept`,headers:AUTH});
    const register=await app.inject({method:'POST',url:'/v1/reviver/register',headers:AUTH});
    assert.equal(queue.statusCode,200);
    assert.equal(accept.statusCode,200);
    assert.equal(register.statusCode,200);
  });
}

test('active Pro guard runs before reviver standing and transaction credential checks', async t => {
  const app=makeApp({state:'TRIAL',reviverStanding:null,credentialStatus:null});
  t.after(()=>app.close());
  const queue=await app.inject({method:'GET',url:'/v1/reviver/queue',headers:AUTH});
  assert.equal(queue.statusCode,403);
  assert.equal(queue.json().error,'REVIVER_REQUIRED');
  const register=await app.inject({method:'POST',url:'/v1/reviver/register',headers:AUTH});
  assert.equal(register.statusCode,409);
  assert.equal(register.json().error,'VERIFICATION_CREDENTIAL_REQUIRED');
});
