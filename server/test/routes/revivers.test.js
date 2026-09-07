const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');
const { TornApiError } = require('../../src/torn/client');

function makeApp({
  credentialStatus = { id:'c',usable:true,capabilities:{requester:true,reviver:true} },
  registerResult = { registered:true, reviver:{ userId:'u1', standing:'active' } },
  perksJob = ['+ Ability to revive'],
  perksError = null,
  onRegister = null
} = {}) {
  return buildApp({
    config:{ API_KEY_ENCRYPTION_KEY:'88'.repeat(32), SESSION_TOKEN_PEPPER:'pepper' },
    tornClient:{
      async getKeyInfo(){throw new Error('not used');},
      async getUserPerks(key){
        assert.equal(key, 'verification-key');
        if (perksError) throw perksError;
        return { job: perksJob };
      }
    },
    identityRepository:{ async bindIdentity(){} },
    sessionRepository:{ async findByTokenHash(){return { sessionId:'s',userId:'u1',tornId:123,expiresAt:null,revokedAt:null,reviverStanding:null,activeBan:false };} },
    entitlementRepository:{
      async getStatus(){return {state:'ACTIVE',trialEligible:false,trialStartedAt:null,validUntil:new Date('2027-01-01T00:00:00Z')};},
      async startTrial(){throw new Error('not used');}
    },
    verificationCredentialRepository:{
      async getStatus(){return credentialStatus;},
      async getDecryptedActiveForUser(userId){
        assert.equal(userId,'u1');
        return { plaintextKey:'verification-key', status:credentialStatus };
      },
      async markUnusable(){},
      async bind(){throw new Error('not used');},
      async revoke(){return false;}
    },
    logMetadataResolver:{ async get(){ return { categories:{} }; } },
    reviverRepository:{
      async register(input){
        assert.equal(input.userId,'u1');
        if (onRegister) onRegister(input);
        return registerResult;
      }
    }
  });
}

test('eligibility reports eligible only when Torn confirms permanent revive ability', async t => {
  const app = makeApp({ perksJob:['- 10% Education length', '+ Ability to revive'] });
  t.after(()=>app.close());
  const response = await app.inject({method:'GET',url:'/v1/reviver/eligibility',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.json().eligibility,{status:'ELIGIBLE',canRevive:true});
});

test('eligibility reports not unlocked and registration is blocked when revive ability is absent', async t => {
  let registerCalls = 0;
  const app = makeApp({ perksJob:['+ 10% Crime success'], onRegister(){ registerCalls += 1; } });
  t.after(()=>app.close());

  const eligibility = await app.inject({method:'GET',url:'/v1/reviver/eligibility',headers:{authorization:'Bearer token'}});
  assert.equal(eligibility.statusCode,200);
  assert.deepEqual(eligibility.json().eligibility,{status:'NOT_UNLOCKED',canRevive:false});

  const register = await app.inject({method:'POST',url:'/v1/reviver/register',headers:{authorization:'Bearer token'}});
  assert.equal(register.statusCode,403);
  assert.equal(register.json().error,'REVIVE_ABILITY_NOT_UNLOCKED');
  assert.equal(registerCalls,0);
});

test('missing perks permission becomes update-key eligibility state and blocks registration', async t => {
  let registerCalls = 0;
  const app = makeApp({
    perksError:new TornApiError('TORN_UNAVAILABLE','not enough access',{status:200,tornStatus:16}),
    onRegister(){ registerCalls += 1; }
  });
  t.after(()=>app.close());

  const eligibility = await app.inject({method:'GET',url:'/v1/reviver/eligibility',headers:{authorization:'Bearer token'}});
  assert.equal(eligibility.statusCode,200);
  assert.deepEqual(eligibility.json().eligibility,{status:'PERMISSION_REQUIRED',canRevive:null});

  const register = await app.inject({method:'POST',url:'/v1/reviver/register',headers:{authorization:'Bearer token'}});
  assert.equal(register.statusCode,409);
  assert.equal(register.json().error,'REVIVE_ABILITY_PERMISSION_REQUIRED');
  assert.equal(registerCalls,0);
});

test('registers an authenticated player only after live Torn revive-ability confirmation', async t => {
  let registerCalls = 0;
  const app = makeApp({ onRegister(){ registerCalls += 1; } });
  t.after(()=>app.close());
  const response = await app.inject({method:'POST',url:'/v1/reviver/register',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().reviver.standing,'active');
  assert.equal(registerCalls,1);
});

test('registration fails closed when verification credential lacks reviver capability', async t => {
  const app = makeApp({ credentialStatus:{ id:'c',usable:true,capabilities:{requester:true,reviver:false} } });
  t.after(()=>app.close());
  const response = await app.inject({method:'POST',url:'/v1/reviver/register',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,409);
  assert.equal(response.json().error,'VERIFICATION_CREDENTIAL_INSUFFICIENT');
});

test('registration cannot reset a suspended or banned standing', async t => {
  const app = makeApp({
    credentialStatus:{ id:'c',usable:true,capabilities:{reviver:true,requester:false} },
    registerResult:{ registered:false, reason:'REVIVER_NOT_ELIGIBLE', reviver:{userId:'u1',standing:'suspended'} }
  });
  t.after(()=>app.close());
  const response = await app.inject({method:'POST',url:'/v1/reviver/register',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,403);
  assert.equal(response.json().error,'REVIVER_NOT_ELIGIBLE');
});
