const test=require('node:test');
const assert=require('node:assert/strict');
const {
  XANAX_ITEM_ID,
  validateProReceiverCredential,
  normalizeProPaymentLogs,
  createProBillingEvidenceService
}=require('../../src/torn/pro-billing-evidence');

const metadata={categories:{10:'Money incoming',12:'Items incoming',13:'Money outgoing'}};

function receiverKey(overrides={}) {
  return {
    tornId:700001,
    name:'ReviveRelay Receiver',
    selections:{
      user:['basic','log'],
      torn:['logcategories'],
      key:['info'],
      company:[],faction:[],market:[],property:[],racing:[],forum:[]
    },
    access:{
      faction:false,
      company:false,
      log:{custom_permissions:true,available:[10,12].map(category_id=>({category_id,log_ids:[]}))}
    },
    ...overrides
  };
}

test('receiver credential accepts only designated owner with narrow incoming log access',()=>{
  const result=validateProReceiverCredential({keyInfo:receiverKey(),ownerTornId:700001,logMetadata:metadata});
  assert.deepEqual(result,{ownerTornId:700001,moneyIncoming:true,itemIncoming:true});
});

test('receiver credential rejects owner mismatch, private namespaces and broad selections',()=>{
  assert.throws(()=>validateProReceiverCredential({keyInfo:receiverKey(),ownerTornId:1,logMetadata:metadata}),/owner mismatch/i);

  const faction=receiverKey({selections:{...receiverKey().selections,faction:['basic']}});
  assert.throws(()=>validateProReceiverCredential({keyInfo:faction,ownerTornId:700001,logMetadata:metadata}),/unapproved namespace.*faction/i);

  const profile=receiverKey({selections:{...receiverKey().selections,user:['basic','log','profile']}});
  assert.throws(()=>validateProReceiverCredential({keyInfo:profile,ownerTornId:700001,logMetadata:metadata}),/unapproved user selection.*profile/i);

  const outgoing=receiverKey({access:{...receiverKey().access,log:{custom_permissions:true,available:[10,12,13].map(category_id=>({category_id,log_ids:[]}))}}});
  assert.throws(()=>validateProReceiverCredential({keyInfo:outgoing,ownerTornId:700001,logMetadata:metadata}),/unapproved log category.*Money outgoing/i);

  const unrestricted=receiverKey({access:{...receiverKey().access,log:{custom_permissions:false,available:[]}}});
  assert.throws(()=>validateProReceiverCredential({keyInfo:unrestricted,ownerTornId:700001,logMetadata:metadata}),/restricted custom log permissions/i);
});

test('receiver credential requires both incoming money and item categories',()=>{
  const missingItems=receiverKey({access:{...receiverKey().access,log:{custom_permissions:true,available:[{category_id:10,log_ids:[]}]}}});
  assert.throws(()=>validateProReceiverCredential({keyInfo:missingItems,ownerTornId:700001,logMetadata:metadata}),/Items incoming/i);
});

test('normalizes only canonical incoming Cash and Xanax evidence',()=>{
  assert.equal(XANAX_ITEM_ID,206);
  const cash=normalizeProPaymentLogs([
    {id:'cash-1',timestamp:1788091260,data:{sender:123,money:10000000}},
    {id:'cash-2',timestamp:1788091261,data:{sender:0,money:10000000}},
    {id:'cash-3',timestamp:1788091262,data:{sender:123,money:0}},
    {id:'',timestamp:1788091263,data:{sender:123,money:10000000}}
  ],{currency:'cash'});
  assert.deepEqual(cash,[{
    tornLogId:'cash-1',senderTornId:123,currency:'cash',amount:10000000,at:new Date(1788091260000)
  }]);

  const xanax=normalizeProPaymentLogs([
    {id:'item-1',timestamp:1788091320,data:{sender:123,items:{'206':10,'1':99}}},
    {id:'item-2',timestamp:1788091321,data:{sender:123,items:{'1':10}}},
    {id:'item-3',timestamp:1788091322,data:{sender:123,items:[{id:206,quantity:5},{id:206,quantity:5}]}}
  ],{currency:'xanax'});
  assert.deepEqual(xanax,[
    {tornLogId:'item-1',senderTornId:123,currency:'xanax',amount:10,at:new Date(1788091320000)},
    {tornLogId:'item-3',senderTornId:123,currency:'xanax',amount:10,at:new Date(1788091322000)}
  ]);
  assert.throws(()=>normalizeProPaymentLogs([],{currency:'points'}),/unsupported Pro payment currency/i);
});

test('billing evidence service validates receiver and fetches only requested incoming category',async()=>{
  const calls=[];
  const service=createProBillingEvidenceService({
    receiverApiKey:'receiver-secret',
    receiverTornId:700001,
    tornClient:{
      async getKeyInfo(key){assert.equal(key,'receiver-secret');return receiverKey();},
      async getUserLogs(key,input){calls.push([key,input]);return [{id:'cash-1',timestamp:1788091260,data:{sender:123,money:10000000}}];}
    },
    logMetadataResolver:{async get(key){assert.equal(key,'receiver-secret');return metadata;}}
  });
  assert.deepEqual(await service.validateCredential(),{ownerTornId:700001,moneyIncoming:true,itemIncoming:true});
  const rows=await service.getIncomingEvidence({currency:'cash',from:new Date(1788091200000),to:new Date(1788091800000)});
  assert.deepEqual(calls,[['receiver-secret',{categoryId:10,from:1788091200,to:1788091800,limit:100}]]);
  assert.equal(rows[0].tornLogId,'cash-1');
});
