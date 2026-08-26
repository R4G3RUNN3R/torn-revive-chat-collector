const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentVerifyHandler } = require('../../src/worker/payment-verify');

function context(overrides={}) {
  return {
    transactionId:'txn', requesterUserId:'requester-user', reviverUserId:'reviver-user',
    requesterTornId:111, reviverTornId:222, method:'xanax', offerAmount:3,
    state:'WAITING_FOR_PAYMENT', acceptedAt:new Date('2026-08-26T10:00:00Z'),
    paymentDeadline:new Date('2026-08-26T10:03:00Z'), paymentReconcileUntil:null,
    verificationHoldReason:null, ...overrides
  };
}

function setup({ now='2026-08-26T10:01:00Z', ctx=context(), evidence=[], evidenceError=null }={}) {
  const transitions=[]; const payments=[]; const holds=[]; const clears=[]; const jobs=[];
  const paymentRepository={
    async getVerificationContext(){ return ctx; },
    async recordVerifiedPayment(input){ payments.push(input); return {id:'payment'}; }
  };
  const transactionService={
    async transitionTransaction(input){
      transitions.push(input);
      const next = input.event === 'deadline' ? 'PAYMENT_RECONCILING'
        : input.event === 'payment_verified' ? 'WAITING_FOR_REVIVE'
        : input.event === 'late_payment' ? 'REFUND_REQUIRED'
        : input.event === 'payment_expired' ? 'PAYMENT_EXPIRED' : ctx.state;
      return { transitioned:true, transaction:{...ctx,state:next,paymentReconcileUntil:input.details && input.details.reconcileUntil || ctx.paymentReconcileUntil} };
    },
    async setVerificationHold(input){ holds.push(input); },
    async clearVerificationHold(input){ clears.push(input); }
  };
  const evidenceService={ async getIncomingPaymentEvidence(){ if(evidenceError) throw evidenceError; return evidence; } };
  const jobRepository={ async enqueueUniqueJob(input){ jobs.push(input); return {id:'job-next'}; } };
  const handler=createPaymentVerifyHandler({ paymentRepository,transactionService,evidenceService,jobRepository,clock:()=>new Date(now) });
  return {handler,transitions,payments,holds,clears,jobs};
}

test('verified payment records evidence and starts five-minute revive SLA at server verification time', async () => {
  const s=setup({evidence:[
    {id:'a',senderId:111,kind:'xanax',amount:1,at:new Date('2026-08-26T10:00:30Z')},
    {id:'b',senderId:111,kind:'xanax',amount:2,at:new Date('2026-08-26T10:00:40Z')}
  ]});
  const result=await s.handler({id:'job',entityId:'txn'});
  assert.equal(result.status,'complete');
  assert.equal(s.payments.length,1);
  assert.equal(s.transitions.at(-1).event,'payment_verified');
  assert.equal(s.transitions.at(-1).details.paymentVerifiedAt.toISOString(),'2026-08-26T10:01:00.000Z');
  assert.equal(s.transitions.at(-1).details.reviveDeadline.toISOString(),'2026-08-26T10:06:00.000Z');
  assert.equal(s.jobs.length,1);
  assert.equal(s.jobs[0].type,'revive.verify');
  assert.equal(s.jobs[0].dedupeKey,'revive.verify:txn');
});

test('missing payment before deadline reschedules normally without transition', async () => {
  const s=setup({now:'2026-08-26T10:01:00Z'});
  const result=await s.handler({id:'job',entityId:'txn'});
  assert.equal(result.status,'reschedule');
  assert.equal(result.runAt.toISOString(),'2026-08-26T10:01:15.000Z');
  assert.deepEqual(s.transitions,[]);
});

test('deadline enters reconciliation, then expires only after grace window', async () => {
  const s=setup({now:'2026-08-26T10:03:00Z'});
  const first=await s.handler({id:'job',entityId:'txn'});
  assert.equal(s.transitions[0].event,'deadline');
  assert.equal(s.transitions[0].details.reconcileUntil.toISOString(),'2026-08-26T10:03:30.000Z');
  assert.equal(first.status,'reschedule');

  const expired=setup({now:'2026-08-26T10:03:31Z',ctx:context({state:'PAYMENT_RECONCILING',paymentReconcileUntil:new Date('2026-08-26T10:03:30Z')})});
  const second=await expired.handler({id:'job',entityId:'txn'});
  assert.equal(second.status,'complete');
  assert.equal(expired.transitions.at(-1).event,'payment_expired');
});

test('late payment is recorded and enters refund-required path', async () => {
  const s=setup({
    now:'2026-08-26T10:03:10Z',
    ctx:context({state:'PAYMENT_RECONCILING',paymentReconcileUntil:new Date('2026-08-26T10:03:30Z')}),
    evidence:[
      {id:'a',senderId:111,kind:'xanax',amount:1,at:new Date('2026-08-26T10:02:00Z')},
      {id:'b',senderId:111,kind:'xanax',amount:2,at:new Date('2026-08-26T10:03:05Z')}
    ]
  });
  const result=await s.handler({id:'job',entityId:'txn'});
  assert.equal(result.status,'complete');
  assert.equal(s.payments[0].verifiedAmount,3);
  assert.equal(s.transitions.at(-1).event,'late_payment');
});

test('credential or Torn availability problems create a verification hold and reschedule without misconduct', async () => {
  const error=Object.assign(new Error('invalid'),{code:'VERIFICATION_CREDENTIAL_INVALID'});
  const s=setup({evidenceError:error});
  const result=await s.handler({id:'job',entityId:'txn'});
  assert.equal(result.status,'reschedule');
  assert.equal(s.holds[0].reason,'VERIFICATION_CREDENTIAL_INVALID');
  assert.equal(s.transitions.length,0);
});
