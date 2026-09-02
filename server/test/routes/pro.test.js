const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

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

function makeApp(entitlementRepository) {
  return buildApp({
    config:{ API_KEY_ENCRYPTION_KEY:'aa'.repeat(32), SESSION_TOKEN_PEPPER:'pro-test-pepper' },
    tornClient:{ async getKeyInfo(){ throw new Error('not used'); } },
    identityRepository:{ async bindIdentity(){ throw new Error('not used'); } },
    sessionRepository:sessionRepository(),
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
  assert.doesNotMatch(response.body,/everPaid|revokeReason|invoice|payment/i);
});


function makeBillingApp({ enabled=true, invoiceRepository } = {}) {
  return buildApp({
    config:{
      API_KEY_ENCRYPTION_KEY:'cc'.repeat(32),
      SESSION_TOKEN_PEPPER:'billing-test-pepper',
      PAID_TIER_ENABLED:enabled,
      PRO_RECEIVER_TORN_ID:999999
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

test('Pro invoice creation is unavailable while paid tier is disabled', async t => {
  const app=makeBillingApp({enabled:false,invoiceRepository:{
    async createInvoice(){throw new Error('must not be called');},
    async getInvoiceForUser(){return null;}
  }});
  t.after(()=>app.close());
  const response=await app.inject({method:'POST',url:'/v1/pro/invoices',headers:AUTH,payload:{planId:'monthly',currency:'cash'}});
  assert.equal(response.statusCode,503);
  assert.equal(response.json().error,'PAID_TIER_DISABLED');
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
  assert.deepEqual(created.json().paymentTarget,{tornId:999999});
  assert.equal(created.json().invoice.expectedAmount,10000000);
  assert.doesNotMatch(created.body,/api.?key|secret|ciphertext/i);

  const fetched=await app.inject({method:'GET',url:`/v1/pro/invoices/${invoice.id}`,headers:AUTH});
  assert.equal(fetched.statusCode,200);
  assert.equal(fetched.json().invoice.id,invoice.id);
  assert.deepEqual(fetched.json().paymentTarget,{tornId:999999});
});
