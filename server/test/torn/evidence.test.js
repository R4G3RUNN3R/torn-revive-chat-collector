const test = require('node:test');
const assert = require('node:assert/strict');
const {
  XANAX_ITEM_ID,
  normalizeIncomingPaymentLogs,
  createTornEvidenceService
} = require('../../src/torn/evidence');

const logMetadata = { categories:{ 10:'Money incoming', 12:'Items incoming' } };

test('normalizes incoming Cash and Xanax log shapes conservatively', () => {
  assert.equal(XANAX_ITEM_ID,206);
  const cash = normalizeIncomingPaymentLogs([
    { id:'m1', timestamp:100, data:{ sender:111, money:500000 } },
    { id:'m2', timestamp:101, data:{ sender:222, money:500000 } },
    { id:'m3', timestamp:102, data:{ sender:111, other_number:999999 } }
  ], { method:'cash', requesterTornId:111 });
  assert.deepEqual(cash, [{ id:'m1',senderId:111,kind:'cash',amount:500000,at:new Date(100000) }]);

  const xanax = normalizeIncomingPaymentLogs([
    { id:'x1', timestamp:200, data:{ sender:111, items:{ '206':2, '1':99 } } },
    { id:'x2', timestamp:201, data:{ sender:111, items:{ '1':10 } } }
  ], { method:'xanax', requesterTornId:111 });
  assert.deepEqual(xanax, [{ id:'x1',senderId:111,kind:'xanax',amount:2,at:new Date(200000) }]);
});

test('evidence service uses current category metadata and narrow target/time query', async () => {
  const calls = [];
  const service = createTornEvidenceService({
    verificationCredentialRepository:{ async getDecryptedActiveForUser(userId){ assert.equal(userId,'reviver-user'); return { plaintextKey:'secret',status:{usable:true} }; } },
    logMetadataResolver:{ async get(key){ assert.equal(key,'secret'); return logMetadata; } },
    tornClient:{ async getUserLogs(key,input){ calls.push([key,input]); return [{id:'m1',timestamp:100,data:{sender:111,money:500000}}]; } }
  });
  const rows = await service.getIncomingPaymentEvidence({
    reviverUserId:'reviver-user', requesterTornId:111, method:'cash',
    from:new Date('1970-01-01T00:01:30Z'), to:new Date('1970-01-01T00:02:00Z')
  });
  assert.deepEqual(calls,[['secret',{categoryId:10,targetTornId:111,from:90,to:120,limit:100}]]);
  assert.equal(rows[0].amount,500000);
});

test('normalizes current Torn revive records into stable internal evidence', () => {
  const { normalizeReviveRecords } = require('../../src/torn/evidence');
  const rows = normalizeReviveRecords([
    { id:'rv1', timestamp:100, reviver:{id:200}, target:{id:100}, result:'Success' },
    { id:'rv2', timestamp:101, reviver:{id:200}, target:{id:100}, result:'Failure' },
    { id:'rv3', timestamp:102, reviver:{id:300}, target:{id:100}, result:'Unknown' }
  ]);
  assert.deepEqual(rows, [
    { id:'rv1', reviverId:200, targetId:100, success:true, at:new Date(100000) },
    { id:'rv2', reviverId:200, targetId:100, success:false, at:new Date(101000) }
  ]);
});

test('revive evidence service combines requester incoming revives, reviver outgoing revives, and requester profile', async () => {
  const calls=[];
  const service=createTornEvidenceService({
    verificationCredentialRepository:{
      async getDecryptedActiveForUser(userId){
        if(userId==='requester-user') return {plaintextKey:'requester-key',status:{usable:true}};
        if(userId==='reviver-user') return {plaintextKey:'reviver-key',status:{usable:true}};
        return null;
      }
    },
    logMetadataResolver:{async get(){return logMetadata;}},
    tornClient:{
      async getUserRevives(key,input){calls.push(['revives',key,input]);return key==='requester-key'
        ? [{id:'rv-third',timestamp:105,reviver:{id:300},target:{id:100},result:'Success'}]
        : [{id:'rv-assigned',timestamp:104,reviver:{id:200},target:{id:100},result:'Failure'}];},
      async getUserProfile(key){calls.push(['profile',key]);return {id:100,status:{state:'Hospital',until:200}};},
      async getUserLogs(){throw new Error('not used');}
    }
  });
  const result=await service.getReviveEvidence({
    requesterUserId:'requester-user',reviverUserId:'reviver-user',requesterTornId:100,reviverTornId:200,
    from:new Date(90000),to:new Date(120000)
  });
  assert.equal(result.revives.length,2);
  assert.deepEqual(result.profile,{status:{state:'Hospital',until:new Date(200000)}});
  assert.deepEqual(calls,[
    ['revives','requester-key',{direction:'incoming',from:90,to:120,limit:100}],
    ['profile','requester-key'],
    ['revives','reviver-key',{direction:'outgoing',from:90,to:120,limit:100}]
  ]);
});


test("normalizes outgoing refund Cash and Xanax logs while honoring explicit recipient when present", () => {
  const { normalizeOutgoingRefundLogs } = require("../../src/torn/evidence");
  const cash=normalizeOutgoingRefundLogs([
    {id:"m1",timestamp:300,data:{recipient:111,money:750000}},
    {id:"m2",timestamp:301,data:{recipient:999,money:750000}},
    {id:"m3",timestamp:302,data:{money:250000}}
  ],{method:"cash",requesterTornId:111});
  assert.deepEqual(cash,[
    {id:"m1",recipientId:111,kind:"cash",amount:750000,at:new Date(300000)},
    {id:"m3",recipientId:111,kind:"cash",amount:250000,at:new Date(302000)}
  ]);
  const xanax=normalizeOutgoingRefundLogs([
    {id:"x1",timestamp:400,data:{recipient:111,items:{"206":3}}}
  ],{method:"xanax",requesterTornId:111});
  assert.equal(xanax[0].amount,3);
});

test("refund evidence service uses outgoing category and target-scoped query", async () => {
  const calls=[];
  const service=createTornEvidenceService({
    verificationCredentialRepository:{async getDecryptedActiveForUser(userId){assert.equal(userId,"reviver-user");return {plaintextKey:"secret",status:{usable:true}};}},
    logMetadataResolver:{async get(){return {categories:{20:"Money outgoing",22:"Items outgoing"}};}},
    tornClient:{async getUserLogs(key,input){calls.push([key,input]);return [{id:"m1",timestamp:600,data:{recipient:111,money:750000}}];}}
  });
  const rows=await service.getOutgoingRefundEvidence({reviverUserId:"reviver-user",requesterTornId:111,method:"cash",from:new Date(500000),to:new Date(700000)});
  assert.deepEqual(calls,[["secret",{categoryId:20,targetTornId:111,from:500,to:700,limit:100}]]);
  assert.equal(rows[0].recipientId,111);
  assert.equal(rows[0].amount,750000);
});
