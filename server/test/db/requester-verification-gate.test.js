const test=require('node:test');
const assert=require('node:assert/strict');
const {withDisposableDatabase}=require('../../test-support/database');
const {acceptRequest,listAvailableRequests}=require('../../src/db/transactions');

async function seed(pool){
  const requester=(await pool.query("INSERT INTO users (torn_id,current_name) VALUES (810001,'Requester') RETURNING id")).rows[0];
  const reviver=(await pool.query("INSERT INTO users (torn_id,current_name) VALUES (810002,'Reviver') RETURNING id")).rows[0];
  await pool.query("INSERT INTO revivers (user_id,standing) VALUES ($1,'active')",[reviver.id]);
  const request=(await pool.query("INSERT INTO revive_requests (requester_id,payment_method,offer_amount,state) VALUES ($1,'cash',500000,'AVAILABLE') RETURNING id",[requester.id])).rows[0];
  return{requesterId:requester.id,reviverId:reviver.id,requestId:request.id};
}

async function bindRequesterEvidence(pool,userId,{requester=true,revoked=false,unusable=false}={}){
  await pool.query(`
    INSERT INTO api_credentials (
      user_id,ciphertext,iv,auth_tag,access_scope,purpose,capability,last_validated_at,revoked_at,unusable_at
    ) VALUES ($1,'cipher','iv','tag','{}'::jsonb,'transaction_verification',$2::jsonb,now(),$3,$4)
  `,[userId,JSON.stringify({requester,reviver:false}),revoked?new Date():null,unusable?new Date():null]);
}

test('Accept cannot start payment window until requester has usable requester evidence capability',async()=>{
  await withDisposableDatabase('requester_verification_gate',async pool=>{
    const ids=await seed(pool);
    const now=new Date('2026-09-07T13:00:00Z');

    const blocked=await acceptRequest(pool,{requestId:ids.requestId,reviverId:ids.reviverId,now});
    assert.deepEqual(blocked,{accepted:false,reason:'REQUESTER_VERIFICATION_REQUIRED'});
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM transactions WHERE request_id=$1',[ids.requestId])).rows[0].count,0);
    assert.equal((await pool.query('SELECT state FROM revive_requests WHERE id=$1',[ids.requestId])).rows[0].state,'AVAILABLE');

    await bindRequesterEvidence(pool,ids.requesterId);
    const accepted=await acceptRequest(pool,{requestId:ids.requestId,reviverId:ids.reviverId,now});
    assert.equal(accepted.accepted,true);
    assert.equal(accepted.transaction.state,'WAITING_FOR_PAYMENT');
  });
});

test('revoked, unusable, or non-requester credentials do not satisfy the Accept gate',async()=>{
  for(const variant of [
    {requester:false},
    {requester:true,revoked:true},
    {requester:true,unusable:true}
  ]){
    await withDisposableDatabase('requester_verification_invalid',async pool=>{
      const ids=await seed(pool);
      await bindRequesterEvidence(pool,ids.requesterId,variant);
      const result=await acceptRequest(pool,{requestId:ids.requestId,reviverId:ids.reviverId,now:new Date('2026-09-07T13:00:00Z')});
      assert.deepEqual(result,{accepted:false,reason:'REQUESTER_VERIFICATION_REQUIRED'});
    });
  }
});


test('reviver queue hides requests until requester verification is ready',async()=>{
  await withDisposableDatabase('requester_verification_queue',async pool=>{
    const ids=await seed(pool);
    assert.equal((await listAvailableRequests(pool)).some(row=>row.id===ids.requestId),false);
    await bindRequesterEvidence(pool,ids.requesterId);
    const ready=await listAvailableRequests(pool);
    assert.equal(ready.some(row=>row.id===ids.requestId),true);
  });
});
