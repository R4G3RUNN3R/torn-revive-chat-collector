const test=require('node:test');
const assert=require('node:assert/strict');
const {createProClient}=require('../src/pro-client');

function setup() {
  const calls=[];
  const request=async input=>{ calls.push(input); return {status:200,body:{ok:true,id:'invoice'}}; };
  const client=createProClient({
    baseUrl:'https://reviverelay.voidsmithindustries.com/',
    getToken:()=> 'session-token',
    request,
    clientVersion:'0.5.0',
    releaseChannel:'manual'
  });
  return {client,calls};
}

test('Pro client uses exact authenticated routes and version/channel headers',async()=>{
  const {client,calls}=setup();
  await client.getStatus();
  await client.startTrial();
  await client.getPlans();
  await client.createInvoice({planId:'monthly',currency:'xanax'});
  await client.getInvoice('66666666-6666-4666-8666-666666666666');
  assert.deepEqual(calls.map(c=>[c.method,c.url,c.body]),[
    ['GET','https://reviverelay.voidsmithindustries.com/v1/pro/status',undefined],
    ['POST','https://reviverelay.voidsmithindustries.com/v1/pro/trial',undefined],
    ['GET','https://reviverelay.voidsmithindustries.com/v1/pro/plans',undefined],
    ['POST','https://reviverelay.voidsmithindustries.com/v1/pro/invoices',{planId:'monthly',currency:'xanax'}],
    ['GET','https://reviverelay.voidsmithindustries.com/v1/pro/invoices/66666666-6666-4666-8666-666666666666',undefined]
  ]);
  for(const call of calls){
    assert.equal(call.headers.Authorization,'Bearer session-token');
    assert.equal(call.headers['X-ReviveRelay-Version'],'0.5.0');
    assert.equal(call.headers['X-ReviveRelay-Channel'],'manual');
    assert.equal(call.headers.Accept,'application/json');
  }
  assert.equal(calls[3].headers['Content-Type'],'application/json');
});

test('invoice client accepts only server plan/currency selection, never price, months, identity or entitlement flags',async()=>{
  const {client,calls}=setup();
  for(const payload of [
    {planId:'monthly',currency:'cash',expectedAmount:1},
    {planId:'monthly',currency:'cash',months:12},
    {planId:'monthly',currency:'cash',pro:true},
    {planId:'monthly',currency:'cash',certified:true},
    {planId:'monthly',currency:'cash',tornId:123}
  ]) {
    await assert.rejects(()=>client.createInvoice(payload),/INVALID_INVOICE_SELECTION/);
  }
  assert.equal(calls.length,0);
});

test('missing session fails locally without making request',async()=>{
  const calls=[];
  const client=createProClient({baseUrl:'https://example.test',getToken:()=>'',request:async x=>{calls.push(x);return {status:200,body:{}};},clientVersion:'0.5.0',releaseChannel:'manual'});
  await assert.rejects(()=>client.getStatus(),error=>error && error.code==='AUTH_REQUIRED');
  assert.equal(calls.length,0);
});

test('server errors preserve bounded code/status without exposing request secrets',async()=>{
  const client=createProClient({
    baseUrl:'https://example.test',getToken:()=> 'token',clientVersion:'0.5.0',releaseChannel:'manual',
    request:async()=>({status:503,body:{error:'PAID_TIER_DISABLED'}})
  });
  await assert.rejects(()=>client.createInvoice({planId:'monthly',currency:'cash'}),error=>{
    assert.equal(error.code,'PAID_TIER_DISABLED');
    assert.equal(error.status,503);
    return true;
  });
});
