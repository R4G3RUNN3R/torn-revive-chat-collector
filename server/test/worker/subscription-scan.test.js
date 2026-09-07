const test=require('node:test');
const assert=require('node:assert/strict');
const {createSubscriptionScanHandler,SCAN_INTERVAL_MS}=require('../../src/worker/subscription-scan');

function invoice(overrides={}) {
  return {
    id:'77777777-7777-4777-8777-777777777777',
    purchaserTornId:123,
    currency:'cash',
    expectedAmount:10000000,
    state:'PENDING',
    createdAt:new Date('2026-09-02T10:00:00Z'),
    expiresAt:new Date('2026-09-03T10:00:00Z'),
    ...overrides
  };
}

function evidence(overrides={}) {
  return {
    tornLogId:'cash-log-1',
    senderTornId:123,
    currency:'cash',
    amount:10000000,
    at:new Date('2026-09-02T10:01:00Z'),
    ...overrides
  };
}

function setup({invoices=[invoice()],cash=[evidence()],xanax=[]}={}) {
  const calls={expired:[],listed:[],fetched:[],marked:[]};
  const invoiceRepository={
    async expireDue(now){calls.expired.push(now);return 0;},
    async listPending(now){calls.listed.push(now);return invoices;},
    async markPaidWithEvidence(input){calls.marked.push(input);return {paid:true,invoice:{...invoices.find(row=>row.id===input.invoiceId),state:'PAID'}};}
  };
  const evidenceService={
    async getIncomingEvidence(input){
      calls.fetched.push(input);
      return input.currency==='cash'?cash:xanax;
    }
  };
  const now=new Date('2026-09-02T10:05:00Z');
  const handler=createSubscriptionScanHandler({invoiceRepository,evidenceService,clock:()=>now});
  return {handler,calls,now};
}

test('matching sender, amount, currency and invoice window pays invoice and reschedules in one minute',async()=>{
  const s=setup();
  const result=await s.handler({type:'subscription.scan',entityId:null});
  assert.equal(s.calls.expired.length,1);
  assert.equal(s.calls.marked.length,1);
  assert.deepEqual(s.calls.marked[0],{
    invoiceId:'77777777-7777-4777-8777-777777777777',
    tornLogId:'cash-log-1',
    senderTornId:123,
    currency:'cash',
    amount:10000000,
    evidenceAt:new Date('2026-09-02T10:01:00Z'),
    paidAt:s.now
  });
  assert.equal(result.status,'reschedule');
  assert.equal(result.runAt.getTime(),s.now.getTime()+SCAN_INTERVAL_MS);
});

test('wrong sender, amount, currency or timestamp never calls paid transition',async()=>{
  const wrong=[
    evidence({tornLogId:'wrong-sender',senderTornId:999}),
    evidence({tornLogId:'wrong-amount',amount:9999999}),
    evidence({tornLogId:'before',at:new Date('2026-09-02T09:59:59Z')}),
    evidence({tornLogId:'after',at:new Date('2026-09-03T10:00:00.001Z')})
  ];
  const s=setup({cash:wrong,xanax:[evidence({tornLogId:'wrong-currency',currency:'xanax'})]});
  await s.handler({type:'subscription.scan'});
  assert.equal(s.calls.marked.length,0);
  assert.deepEqual(s.calls.fetched.map(row=>row.currency),['cash']);
});

test('only currencies represented by pending invoices are fetched',async()=>{
  const s=setup({
    invoices:[
      invoice(),
      invoice({id:'88888888-8888-4888-8888-888888888888',purchaserTornId:456,currency:'xanax',expectedAmount:10})
    ],
    cash:[],xanax:[]
  });
  await s.handler({type:'subscription.scan'});
  assert.deepEqual(s.calls.fetched.map(row=>row.currency).sort(),['cash','xanax']);
  for (const call of s.calls.fetched) {
    assert.equal(call.from.toISOString(),'2026-09-02T10:00:00.000Z');
    assert.equal(call.to.toISOString(),'2026-09-02T10:05:00.000Z');
  }
});

test('expired invoices are processed before pending list and empty queue still reschedules',async()=>{
  const order=[];
  const now=new Date('2026-09-02T10:05:00Z');
  const handler=createSubscriptionScanHandler({
    invoiceRepository:{
      async expireDue(){order.push('expire');return 2;},
      async listPending(){order.push('list');return [];},
      async markPaidWithEvidence(){throw new Error('not used');}
    },
    evidenceService:{async getIncomingEvidence(){throw new Error('not used');}},
    clock:()=>now
  });
  const result=await handler({type:'subscription.scan'});
  assert.deepEqual(order,['expire','list']);
  assert.equal(result.runAt.toISOString(),'2026-09-02T10:06:00.000Z');
});

test('earliest unused evidence wins deterministically for a matching invoice',async()=>{
  const s=setup({cash:[
    evidence({tornLogId:'later',at:new Date('2026-09-02T10:03:00Z')}),
    evidence({tornLogId:'earlier',at:new Date('2026-09-02T10:01:00Z')})
  ]});
  await s.handler({type:'subscription.scan'});
  assert.equal(s.calls.marked[0].tornLogId,'earlier');
});


test('running the scan twice after a successful payment does not process the invoice twice',async()=>{
  const row=invoice();
  let state='PENDING';
  let paidCalls=0;
  const now=new Date('2026-09-02T10:05:00Z');
  const handler=createSubscriptionScanHandler({
    invoiceRepository:{
      async expireDue(){return 0;},
      async listPending(){return state==='PENDING'?[row]:[];},
      async markPaidWithEvidence(){paidCalls+=1;state='PAID';return {paid:true,invoice:{...row,state}};}
    },
    evidenceService:{async getIncomingEvidence(){return [evidence()];}},
    clock:()=>now
  });
  await handler({type:'subscription.scan'});
  await handler({type:'subscription.scan'});
  assert.equal(paidCalls,1);
});
