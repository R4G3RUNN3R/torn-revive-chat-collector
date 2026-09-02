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
