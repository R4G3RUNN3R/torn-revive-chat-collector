const test=require('node:test');
const assert=require('node:assert/strict');
const {withDisposableDatabase}=require('../../test-support/database');
const {buildApp}=require('../../src/app');
const {createIdentityRepository}=require('../../src/db/users');
const {createProEntitlementRepository}=require('../../src/db/pro-entitlements');

async function insertUser(pool,tornId,name) {
  const result=await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id',[tornId,name]);
  return result.rows[0].id;
}

function makeApp(pool,options={}) {
  const adminToken=Object.prototype.hasOwnProperty.call(options,'adminToken') ? options.adminToken : 'test-admin-token';
  const operatorTornId=Object.prototype.hasOwnProperty.call(options,'operatorTornId') ? options.operatorTornId : 3877028;
  return buildApp({
    config:{
      API_KEY_ENCRYPTION_KEY:'ee'.repeat(32),
      SESSION_TOKEN_PEPPER:'admin-test-pepper',
      ADMIN_API_TOKEN:adminToken,
      OPERATOR_TORN_ID:operatorTornId
    },
    tornClient:{async getKeyInfo(){throw new Error('not used');}},
    identityRepository:createIdentityRepository(pool),
    entitlementRepository:createProEntitlementRepository(pool)
  });
}

const ADMIN={'x-reviverelay-admin-token':'test-admin-token'};

test('admin routes are absent without ADMIN_API_TOKEN',async()=>{
  await withDisposableDatabase('admin_absent',async pool=>{
    const app=makeApp(pool,{adminToken:undefined});
    try {
      const response=await app.inject({method:'GET',url:'/v1/admin/pro/users/123'});
      assert.equal(response.statusCode,404);
    } finally { await app.close(); }
  });
});

test('admin route rejects missing/wrong token and accepts exact configured token without echoing it',async()=>{
  await withDisposableDatabase('admin_auth',async pool=>{
    await insertUser(pool,123,'Admin Target');
    const app=makeApp(pool);
    try {
      assert.equal((await app.inject({method:'GET',url:'/v1/admin/pro/users/123'})).statusCode,401);
      assert.equal((await app.inject({method:'GET',url:'/v1/admin/pro/users/123',headers:{'x-reviverelay-admin-token':'wrong'}})).statusCode,401);
      const ok=await app.inject({method:'GET',url:'/v1/admin/pro/users/123',headers:ADMIN});
      assert.equal(ok.statusCode,200);
      assert.deepEqual(ok.json().user,{tornId:123,name:'Admin Target'});
      assert.equal(ok.json().pro.state,'NONE');
      assert.doesNotMatch(ok.body,/test-admin-token/);
    } finally { await app.close(); }
  });
});

test('unknown Torn identity returns 404 without creating entitlement state',async()=>{
  await withDisposableDatabase('admin_unknown',async pool=>{
    const app=makeApp(pool);
    try {
      const response=await app.inject({method:'GET',url:'/v1/admin/pro/users/999999',headers:ADMIN});
      assert.equal(response.statusCode,404);
      assert.equal(response.json().error,'USER_NOT_FOUND');
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM pro_entitlements')).rows[0].count,0);
    } finally { await app.close(); }
  });
});

test('bounded manual grant activates Pro and writes non-secret audit details',async()=>{
  await withDisposableDatabase('admin_grant',async pool=>{
    const userId=await insertUser(pool,124,'Grant Target');
    const app=makeApp(pool);
    try {
      const response=await app.inject({
        method:'POST',url:'/v1/admin/pro/grant',headers:ADMIN,
        payload:{tornId:124,months:2,reason:'verified support correction'}
      });
      assert.equal(response.statusCode,200);
      assert.equal(response.json().pro.state,'ACTIVE');
      assert.equal(response.json().pro.trialEligible,false);
      const audit=await pool.query(`SELECT action,details FROM audit_events WHERE entity_id=$1 AND action='pro.manual_grant'`,[userId]);
      assert.equal(audit.rowCount,1);
      assert.equal(audit.rows[0].details.operatorTornId,3877028);
      assert.equal(audit.rows[0].details.reason,'verified support correction');
      assert.equal(audit.rows[0].details.previousState,'NONE');
      assert.equal(audit.rows[0].details.newState,'ACTIVE');
      assert.equal(JSON.stringify(audit.rows[0].details).includes('test-admin-token'),false);
    } finally { await app.close(); }
  });
});

test('manual revoke expires Pro and records previous/new state',async()=>{
  await withDisposableDatabase('admin_revoke',async pool=>{
    const userId=await insertUser(pool,125,'Revoke Target');
    const repo=createProEntitlementRepository(pool);
    await repo.grantManual({userId,months:1,reason:'initial manual entitlement',operatorTornId:3877028,now:new Date('2026-09-01T12:00:00Z')});
    const app=makeApp(pool);
    try {
      const response=await app.inject({method:'POST',url:'/v1/admin/pro/revoke',headers:ADMIN,payload:{tornId:125,reason:'verified revocation'}});
      assert.equal(response.statusCode,200);
      assert.equal(response.json().pro.state,'EXPIRED');
      const audit=await pool.query(`SELECT details FROM audit_events WHERE entity_id=$1 AND action='pro.revoked' ORDER BY created_at DESC LIMIT 1`,[userId]);
      assert.equal(audit.rowCount,1);
      assert.equal(audit.rows[0].details.operatorTornId,3877028);
      assert.equal(audit.rows[0].details.reason,'verified revocation');
      assert.equal(audit.rows[0].details.previousState,'ACTIVE');
      assert.equal(audit.rows[0].details.newState,'EXPIRED');
    } finally { await app.close(); }
  });
});

test('correction is bounded to 24 months and strict schemas reject extra fields',async()=>{
  await withDisposableDatabase('admin_correct',async pool=>{
    await insertUser(pool,126,'Correction Target');
    const app=makeApp(pool);
    try {
      const tooFar=await app.inject({
        method:'POST',url:'/v1/admin/pro/correct',headers:ADMIN,
        payload:{tornId:126,validUntil:'2100-01-01T00:00:00.000Z',reason:'far too generous'}
      });
      assert.equal(tooFar.statusCode,422);
      assert.equal(tooFar.json().error,'VALID_UNTIL_TOO_FAR');

      const injected=await app.inject({
        method:'POST',url:'/v1/admin/pro/grant',headers:ADMIN,
        payload:{tornId:126,months:1,reason:'valid reason',adminToken:'smuggled'}
      });
      assert.equal(injected.statusCode,422);
      assert.equal(injected.json().error,'INVALID_ADMIN_REQUEST');
    } finally { await app.close(); }
  });
});
