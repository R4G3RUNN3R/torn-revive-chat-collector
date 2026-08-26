const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

function makeApp({ credentialStatus, registerResult }) {
  return buildApp({
    config:{ API_KEY_ENCRYPTION_KEY:'88'.repeat(32), SESSION_TOKEN_PEPPER:'pepper' },
    tornClient:{ async getKeyInfo(){throw new Error('not used');} },
    identityRepository:{ async bindIdentity(){} },
    sessionRepository:{ async findByTokenHash(){return { sessionId:'s',userId:'u1',tornId:123,expiresAt:null,revokedAt:null,reviverStanding:null,activeBan:false };} },
    verificationCredentialRepository:{ async getStatus(){return credentialStatus;}, async bind(){throw new Error('not used');}, async revoke(){return false;} },
    logMetadataResolver:{ async get(){ return { categories:{} }; } },
    reviverRepository:{ async register(input){ assert.equal(input.userId,'u1'); return registerResult; } }
  });
}

test('registers an authenticated player as reviver only with reviver-capable verification access', async t => {
  const app = makeApp({
    credentialStatus:{ id:'c',usable:true,capabilities:{requester:true,reviver:true} },
    registerResult:{ registered:true, reviver:{ userId:'u1', standing:'active' } }
  });
  t.after(()=>app.close());
  const response = await app.inject({method:'POST',url:'/v1/reviver/register',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().reviver.standing,'active');
});

test('registration fails closed when verification credential lacks reviver capability', async t => {
  const app = makeApp({
    credentialStatus:{ id:'c',usable:true,capabilities:{requester:true,reviver:false} },
    registerResult:{ registered:true }
  });
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
