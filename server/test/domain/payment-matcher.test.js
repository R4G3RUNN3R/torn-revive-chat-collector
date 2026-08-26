const test = require('node:test');
const assert = require('node:assert/strict');
const { matchPaymentEvidence } = require('../../src/domain/payment-matcher');

const acceptedAt = new Date('2026-08-26T10:00:00Z');
const paymentDeadline = new Date('2026-08-26T10:03:00Z');

function base(overrides = {}) {
  return {
    method: 'xanax', offerAmount: 3, requesterTornId: 111,
    acceptedAt, paymentDeadline, logs: [], ...overrides
  };
}

test('aggregates split on-time Xanax transfers from the requester', () => {
  const result = matchPaymentEvidence(base({ logs: [
    { id:'a', senderId:111, kind:'xanax', amount:1, at:'2026-08-26T10:01:00Z' },
    { id:'b', senderId:111, kind:'xanax', amount:2, at:'2026-08-26T10:02:00Z' }
  ] }));
  assert.equal(result.status,'verified');
  assert.equal(result.verifiedAmount,3);
  assert.deepEqual(result.evidence.map(row => row.id), ['a','b']);
});

test('records actual on-time overpayment value', () => {
  const result = matchPaymentEvidence(base({ offerAmount:2, logs:[
    { id:'a', senderId:111, kind:'xanax', amount:2, at:'2026-08-26T10:01:00Z' },
    { id:'b', senderId:111, kind:'xanax', amount:1, at:'2026-08-26T10:02:00Z' }
  ] }));
  assert.equal(result.status,'verified');
  assert.equal(result.verifiedAmount,3);
});

test('ignores wrong sender, wrong method, pre-accept evidence and duplicate log IDs', () => {
  const result = matchPaymentEvidence(base({ offerAmount:2, logs:[
    { id:'same', senderId:111, kind:'xanax', amount:1, at:'2026-08-26T10:01:00Z' },
    { id:'same', senderId:111, kind:'xanax', amount:1, at:'2026-08-26T10:01:00Z' },
    { id:'wrong-sender', senderId:222, kind:'xanax', amount:10, at:'2026-08-26T10:01:00Z' },
    { id:'wrong-kind', senderId:111, kind:'cash', amount:500000, at:'2026-08-26T10:01:00Z' },
    { id:'old', senderId:111, kind:'xanax', amount:10, at:'2026-08-26T09:59:59Z' }
  ] }));
  assert.equal(result.status,'not_found');
  assert.equal(result.verifiedAmount,1);
});

test('classifies payment completed after the deadline as late and includes partial on-time value', () => {
  const result = matchPaymentEvidence(base({ logs:[
    { id:'a', senderId:111, kind:'xanax', amount:1, at:'2026-08-26T10:02:00Z' },
    { id:'b', senderId:111, kind:'xanax', amount:2, at:'2026-08-26T10:03:05Z' }
  ] }));
  assert.equal(result.status,'late');
  assert.equal(result.verifiedAmount,3);
  assert.deepEqual(result.evidence.map(row => row.id), ['a','b']);
});

test('Cash uses exact sender/method and safe whole-number evidence', () => {
  const result = matchPaymentEvidence(base({
    method:'cash', offerAmount:500000,
    logs:[{ id:'cash', senderId:111, kind:'cash', amount:750000, at:'2026-08-26T10:01:00Z' }]
  }));
  assert.equal(result.status,'verified');
  assert.equal(result.verifiedAmount,750000);
});

test('rejects unsafe or malformed contract numbers', () => {
  assert.throws(() => matchPaymentEvidence(base({ offerAmount:Number.MAX_SAFE_INTEGER + 1 })), /safe whole number/i);
  assert.throws(() => matchPaymentEvidence(base({ requesterTornId:'not-a-player' })), /requester/i);
});
