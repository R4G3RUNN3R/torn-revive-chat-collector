const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');
const { TornApiError } = require('../../src/torn/client');

const AUTH = { authorization:'Bearer pro-user-token' };

function sessionRepository() {
  return {
    async findByTokenHash() {
      return {
        sessionId:'session-pro', userId:'user-pro', tornId:777001, name:'Pro Tester',
        expiresAt:null, revokedAt:null, reviverStanding:null, activeBan:false
      };
    }
  };
}

function makeApp(entitlementRepository, {
  credentialStatus={id:'cred-pro',usable:true,capabilities:{requester:false,reviver:true}},
  decryptedCredential={plaintextKey:'pro-reviver-key'},
  perksJob=['+ Ability to revive'],
  perksError=null
} = {}) {
  return buildApp({
    config:{ API_KEY_ENCRYPTION_KEY:'aa'.repeat(32), SESSION_TOKEN_PEPPER:'pro-test-pepper' },
    tornClient:{
      async getKeyInfo(){ throw new Error('not used'); },
      async getUserPerks(apiKey){
        assert.equal(apiKey,'pro-reviver-key');
        if (perksError) throw perksError;
        return {job:perksJob};
      }
    },
    identityRepository:{ async bindIdentity(){ throw new Error('not used'); } },
    sessionRepository:sessionRepository(),
    verificationCredentialRepository:{
      async getStatus(){return credentialStatus;},
      async getDecryptedActiveForUser(){return decryptedCredential;},
      async markUnusable(){},
      async bind(){throw new Error('not used');},
      async revoke(){return false;}
    },
    logMetadataResolver:{async get(){return {categories:{}};}},
    entitlementRepository
  });
}

test('verified free user can read Pro status and explicitly start one seven-day trial', async t => {
  const calls=[];
  const repo={
    async getStatus(userId) {
      calls.push(['status',userId]);
      return { state:'NONE', trialEligible:true, trialStartedAt:null, validUntil:null };
    },
    async startTrial({userId}) {
      calls.push(['trial',userId]);
      return {
        state:'TRIAL', trialEligible:false,
        trialStartedAt:new Date('2026-09-02T12:00:00Z'),
        validUntil:new Date('2026-09-09T12:00:00Z')
      };
    }
  };
  const app=makeApp(repo);
  t.after(()=>app.close());

  const status=await app.inject({method:'GET',url:'/v1/pro/status',headers:AUTH});
  assert.equal(status.statusCode,200);
  assert.deepEqual(status.json().pro,{state:'NONE',trialEligible:true,trialStartedAt:null,validUntil:null});

  const trial=await app.inject({method:'POST',url:'/v1/pro/trial',headers:AUTH});
  assert.equal(trial.statusCode,200);
  assert.deepEqual(trial.json().pro,{
    state:'TRIAL',trialEligible:false,
    trialStartedAt:'2026-09-02T12:00:00.000Z',
    validUntil:'2026-09-09T12:00:00.000Z'
  });
  assert.deepEqual(calls,[['status','user-pro'],['trial','user-pro']]);
});

test('trial start requires a usable reviver-capable verification credential', async t => {
  let trialCalls=0;
  const repo={
    async getStatus(){return {state:'NONE',trialEligible:true,trialStartedAt:null,validUntil:null};},
    async startTrial(){trialCalls += 1; throw new Error('must not be called');}
  };

  const missing=makeApp(repo,{credentialStatus:null,decryptedCredential:null});
  t.after(()=>missing.close());
  const missingResponse=await missing.inject({method:'POST',url:'/v1/pro/trial',headers:AUTH});
  assert.equal(missingResponse.statusCode,409,missingResponse.body);
  assert.equal(missingResponse.json().error,'VERIFICATION_CREDENTIAL_REQUIRED');

  const insufficient=makeApp(repo,{
    credentialStatus:{id:'cred-pro',usable:true,capabilities:{requester:true,reviver:false}}
  });
  t.after(()=>insufficient.close());
  const insufficientResponse=await insufficient.inject({method:'POST',url:'/v1/pro/trial',headers:AUTH});
  assert.equal(insufficientResponse.statusCode,409,insufficientResponse.body);
  assert.equal(insufficientResponse.json().error,'VERIFICATION_CREDENTIAL_INSUFFICIENT');
  assert.equal(trialCalls,0);
});

test('trial start requires current Torn permanent revive ability', async t => {
  let trialCalls=0;
  const app=makeApp({
    async getStatus(){return {state:'NONE',trialEligible:true,trialStartedAt:null,validUntil:null};},
    async startTrial(){trialCalls += 1; throw new Error('must not be called');}
  },{perksJob:['+ 10% Crime success']});
  t.after(()=>app.close());

  const response=await app.inject({method:'POST',url:'/v1/pro/trial',headers:AUTH});
  assert.equal(response.statusCode,403,response.body);
  assert.equal(response.json().error,'REVIVE_ABILITY_NOT_UNLOCKED');
  assert.equal(trialCalls,0);
});

test('trial start reports when the verification key cannot read Torn perks', async t => {
  let trialCalls=0;
  const app=makeApp({
    async getStatus(){return {state:'NONE',trialEligible:true,trialStartedAt:null,validUntil:null};},
    async startTrial(){trialCalls += 1; throw new Error('must not be called');}
  },{
    perksError:new TornApiError('TORN_UNAVAILABLE','not enough access',{status:200,tornStatus:16})
  });
  t.after(()=>app.close());

  const response=await app.inject({method:'POST',url:'/v1/pro/trial',headers:AUTH});
  assert.equal(response.statusCode,409,response.body);
  assert.equal(response.json().error,'REVIVE_ABILITY_PERMISSION_REQUIRED');
  assert.equal(trialCalls,0);
});

test('paid-before user cannot start a saved trial later', async t => {
  const app=makeApp({
    async getStatus(){ return {state:'EXPIRED',trialEligible:false,trialStartedAt:null,validUntil:null}; },
    async startTrial(){ throw new Error('TRIAL_NOT_ELIGIBLE'); }
  });
  t.after(()=>app.close());
  const response=await app.inject({method:'POST',url:'/v1/pro/trial',headers:AUTH});
  assert.equal(response.statusCode,409);
  assert.equal(response.json().error,'TRIAL_NOT_ELIGIBLE');
});

test('Pro plan catalog exposes only the approved launch plans and server prices', async t => {
  const app=makeApp({
    async getStatus(){ return {state:'NONE',trialEligible:true,trialStartedAt:null,validUntil:null}; },
    async startTrial(){ throw new Error('not used'); }
  });
  t.after(()=>app.close());
  const response=await app.inject({method:'GET',url:'/v1/pro/plans',headers:AUTH});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.json(),{plans:[
    {id:'monthly',label:'Monthly',months:1,xanax:10,cash:10000000},
    {id:'six_months',label:'6 Months',months:6,xanax:55,cash:55000000},
    {id:'yearly',label:'Yearly',months:12,xanax:100,cash:100000000}
  ]});
});

test('/v1/me projects only public Pro entitlement state', async t => {
  const app=makeApp({
    async getStatus(userId) {
      assert.equal(userId,'user-pro');
      return {
        state:'ACTIVE',trialEligible:false,
        trialStartedAt:new Date('2026-08-20T10:00:00Z'),
        validUntil:new Date('2027-09-09T12:00:00Z')
      };
    },
    async startTrial(){ throw new Error('not used'); }
  });
  t.after(()=>app.close());
  const response=await app.inject({method:'GET',url:'/v1/me',headers:AUTH});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.json().pro,{
    state:'ACTIVE',trialEligible:false,
    trialStartedAt:'2026-08-20T10:00:00.000Z',
    validUntil:'2027-09-09T12:00:00.000Z'
  });
  assert.doesNotMatch(response.body,/everPaid|revokeReason|matchedTornLogId|ciphertext|authTag|PRO_RECEIVER_API_KEY/i);
});


function makeBillingApp({ mode='review', invoiceRepository } = {}) {
  return buildApp({
    config:{
      API_KEY_ENCRYPTION_KEY:'cc'.repeat(32),
      SESSION_TOKEN_PEPPER:'billing-test-pepper',
      SUBSCRIPTION_MODE:mode,
      PRO_RECEIVER_TORN_ID:3877028,
      REVIVERELAY_SERVER_VERSION:'0.6.1',
      REVIVERELAY_MINIMUM_CLIENT_VERSION:'0.6.1',
      REVIVERELAY_RELEASE_CHANNEL:mode==='review'?'review':'stable'
    },
    tornClient:{async getKeyInfo(){throw new Error('not used');}},
    identityRepository:{async bindIdentity(){throw new Error('not used');}},
    sessionRepository:sessionRepository(),
    entitlementRepository:{
      async getStatus(){return {state:'NONE',trialEligible:true,trialStartedAt:null,validUntil:null};},
      async startTrial(){throw new Error('not used');}
    },
    proInvoiceRepository:invoiceRepository
  });
}

test('Pro invoice creation is unavailable in free subscription mode', async t => {
  const app=makeBillingApp({mode:'free',invoiceRepository:{
    async createInvoice(){throw new Error('must not be called');},
    async getInvoiceForUser(){return null;}
  }});
  t.after(()=>app.close());
  const response=await app.inject({method:'POST',url:'/v1/pro/invoices',headers:AUTH,payload:{planId:'monthly',currency:'cash'}});
  assert.equal(response.statusCode,503);
  assert.equal(response.json().error,'SUBSCRIPTION_PAYMENTS_DISABLED');
});

test('strict invoice route rejects client price or duration injection', async t => {
  const app=makeBillingApp({invoiceRepository:{
    async createInvoice(){throw new Error('must not be called');},
    async getInvoiceForUser(){return null;}
  }});
  t.after(()=>app.close());
  const response=await app.inject({
    method:'POST',url:'/v1/pro/invoices',headers:AUTH,
    payload:{planId:'monthly',currency:'cash',expectedAmount:1,entitlementMonths:120}
  });
  assert.equal(response.statusCode,422);
  assert.equal(response.json().error,'INVALID_INVOICE_REQUEST');
});

test('valid invoice response uses authenticated Torn identity and exposes only safe payment target', async t => {
  let seen=null;
  const invoice={
    id:'66666666-6666-4666-8666-666666666666',
    planId:'monthly',currency:'cash',expectedAmount:10000000,entitlementMonths:1,state:'PENDING',
    createdAt:new Date('2026-09-02T12:00:00Z'),expiresAt:new Date('2026-09-03T12:00:00Z'),paidAt:null
  };
  const app=makeBillingApp({invoiceRepository:{
    async createInvoice(input){seen=input;return invoice;},
    async getInvoiceForUser({invoiceId,userId}){assert.equal(userId,'user-pro');return invoiceId===invoice.id?invoice:null;}
  }});
  t.after(()=>app.close());
  const created=await app.inject({method:'POST',url:'/v1/pro/invoices',headers:AUTH,payload:{planId:'monthly',currency:'cash'}});
  assert.equal(created.statusCode,201);
  assert.equal(seen.userId,'user-pro');
  assert.equal(seen.tornId,777001);
  assert.equal(seen.planId,'monthly');
  assert.equal(seen.currency,'cash');
  assert.equal(Object.hasOwn(seen,'expectedAmount'),false);
  assert.deepEqual(created.json().paymentTarget,{tornId:3877028});
  assert.equal(created.json().invoice.expectedAmount,10000000);
  assert.doesNotMatch(created.body,/api.?key|secret|ciphertext/i);

  const fetched=await app.inject({method:'GET',url:`/v1/pro/invoices/${invoice.id}`,headers:AUTH});
  assert.equal(fetched.statusCode,200);
  assert.equal(fetched.json().invoice.id,invoice.id);
  assert.deepEqual(fetched.json().paymentTarget,{tornId:3877028});
});


test('Pro status exposes canonical subscription capability, merchant and server-owned plans', async t => {
  const app=makeBillingApp({mode:'review'});
  t.after(()=>app.close());
  const response=await app.inject({method:'GET',url:'/v1/pro/status',headers:AUTH});
  assert.equal(response.statusCode,200,response.body);
  const expectedSubscription={
    mode:'review',
    paymentsEnabled:true,
    merchant:{tornId:3877028,name:'R4G3RUNN3R'},
    plans:[
      {id:'monthly',label:'Monthly',months:1,xanax:10,cash:10000000},
      {id:'six_months',label:'6 Months',months:6,xanax:55,cash:55000000},
      {id:'yearly',label:'Yearly',months:12,xanax:100,cash:100000000}
    ]
  };
  assert.deepEqual(response.json().subscription,expectedSubscription);
  assert.deepEqual(response.json().runtime,{
    serverVersion:'0.6.1',
    minimumClientVersion:'0.6.1',
    releaseChannel:'review',
    subscription:expectedSubscription
  });
});

test('free Pro status exposes plans for reference but no merchant or payment capability', async t => {
  const app=makeBillingApp({mode:'free'});
  t.after(()=>app.close());
  const response=await app.inject({method:'GET',url:'/v1/pro/status',headers:AUTH});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.json().subscription.mode,'free');
  assert.equal(response.json().subscription.paymentsEnabled,false);
  assert.equal(response.json().subscription.merchant,null);
  assert.equal(response.json().subscription.plans.length,3);
});
