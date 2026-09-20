const test=require('node:test');
const assert=require('node:assert/strict');
const {buildApp}=require('../../src/app');
const {hashSessionToken}=require('../../src/security/sessions');

const TOKEN='account-delete-session-token';
const PEPPER='account-delete-pepper';
const AUTH={authorization:`Bearer ${TOKEN}`};

function makeApp() {
  let deleted=false;
  let calls=0;
  const app=buildApp({
    config:{API_KEY_ENCRYPTION_KEY:'cd'.repeat(32),SESSION_TOKEN_PEPPER:PEPPER,SUBSCRIPTION_MODE:'free'},
    tornClient:{async getKeyInfo(){throw new Error('not used');}},
    identityRepository:{async bindIdentity(){throw new Error('not used');}},
    sessionRepository:{
      async findByTokenHash(hash){
        assert.equal(hash,hashSessionToken(TOKEN,PEPPER));
        if (deleted) return null;
        return {
          sessionId:'session-delete',userId:'user-delete',tornId:940002,name:'Delete Route User',
          expiresAt:null,revokedAt:null,reviverStanding:null,activeBan:false
        };
      }
    },
    accountDeletionService:{
      async deleteAccount({userId}) {
        calls += 1;
        assert.equal(userId,'user-delete');
        deleted=true;
        return {deleted:true,retained:['billing_history','payment_reuse_protection','security_audit_history']};
      }
    }
  });
  return {app,getCalls:()=>calls};
}

test('DELETE /v1/account requires authentication and exact explicit confirmation',async()=>{
  {
    const {app,getCalls}=makeApp();
    const unauthenticated=await app.inject({
      method:'DELETE',url:'/v1/account',payload:{confirm:'DELETE REVIVERELAY ACCOUNT'}
    });
    assert.equal(unauthenticated.statusCode,401,unauthenticated.body);
    assert.equal(unauthenticated.json().error,'AUTH_REQUIRED');
    assert.equal(getCalls(),0);
    await app.close();
  }

  for (const payload of [{},{confirm:'DELETE'},{confirm:'delete reviverelay account'},{confirm:'DELETE REVIVERELAY ACCOUNT',extra:true}]) {
    const {app,getCalls}=makeApp();
    const response=await app.inject({method:'DELETE',url:'/v1/account',headers:AUTH,payload});
    assert.equal(response.statusCode,422,response.body);
    assert.equal(response.json().error,'ACCOUNT_DELETE_CONFIRMATION_REQUIRED');
    assert.equal(getCalls(),0);
    await app.close();
  }
});

test('DELETE /v1/account commits safe deletion response and invalidates the old bearer immediately',async t=>{
  const {app,getCalls}=makeApp();
  t.after(()=>app.close());

  const response=await app.inject({
    method:'DELETE',url:'/v1/account',headers:AUTH,
    payload:{confirm:'DELETE REVIVERELAY ACCOUNT'}
  });
  assert.equal(response.statusCode,200,response.body);
  assert.deepEqual(response.json(),{
    deleted:true,
    retained:['billing_history','payment_reuse_protection','security_audit_history']
  });
  assert.equal(getCalls(),1);
  assert.doesNotMatch(response.body,/Delete Route User|session-delete|account-delete-session-token|user-delete/);

  const oldSession=await app.inject({method:'GET',url:'/v1/me',headers:AUTH});
  assert.equal(oldSession.statusCode,401,oldSession.body);
  assert.equal(oldSession.json().error,'AUTH_REQUIRED');
});


test('POST /v1/account/delete supports body-carrying clients such as TornPDA while preserving exact confirmation',async t=>{
  const {app,getCalls}=makeApp();
  t.after(()=>app.close());

  const bad=await app.inject({
    method:'POST',url:'/v1/account/delete',headers:AUTH,payload:{confirm:'DELETE'}
  });
  assert.equal(bad.statusCode,422,bad.body);
  assert.equal(bad.json().error,'ACCOUNT_DELETE_CONFIRMATION_REQUIRED');
  assert.equal(getCalls(),0);

  const response=await app.inject({
    method:'POST',url:'/v1/account/delete',headers:AUTH,
    payload:{confirm:'DELETE REVIVERELAY ACCOUNT'}
  });
  assert.equal(response.statusCode,200,response.body);
  assert.deepEqual(response.json(),{
    deleted:true,
    retained:['billing_history','payment_reuse_protection','security_audit_history']
  });
  assert.equal(getCalls(),1);

  const oldSession=await app.inject({method:'GET',url:'/v1/me',headers:AUTH});
  assert.equal(oldSession.statusCode,401,oldSession.body);
  assert.equal(oldSession.json().error,'AUTH_REQUIRED');
});
