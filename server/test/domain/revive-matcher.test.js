const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyReviveOutcome } = require('../../src/domain/revive-matcher');

const start = new Date('2026-08-26T10:01:00Z');
const deadline = new Date('2026-08-26T10:06:00Z');

function input(overrides={}) {
  return {
    requesterTornId:100,
    assignedReviverTornId:200,
    attemptWindowStart:start,
    reviveDeadline:deadline,
    now:new Date('2026-08-26T10:03:00Z'),
    revives:[],
    hospitalStatus:{ state:'Hospital', until:new Date('2026-08-26T10:20:00Z') },
    hospitalUntilBaseline:new Date('2026-08-26T10:20:00Z'),
    ...overrides
  };
}

test('assigned on-time success wins', () => {
  const out=classifyReviveOutcome(input({revives:[{id:'r1',reviverId:200,targetId:100,success:true,at:new Date('2026-08-26T10:02:00Z')}]}));
  assert.equal(out.kind,'assigned_success');
  assert.equal(out.evidence.id,'r1');
});

test('assigned genuine failed attempt is not no-attempt misconduct', () => {
  const out=classifyReviveOutcome(input({revives:[{id:'r1',reviverId:200,targetId:100,success:false,at:new Date('2026-08-26T10:02:00Z')}]}));
  assert.equal(out.kind,'assigned_failed');
});

test('third-party success makes assigned service impossible and requires refund', () => {
  const out=classifyReviveOutcome(input({revives:[{id:'r2',reviverId:300,targetId:100,success:true,at:new Date('2026-08-26T10:02:30Z')}]}));
  assert.equal(out.kind,'third_party_success');
  assert.equal(out.evidence.reviverId,300);
});

test('genuine assigned failure takes precedence over a later third-party success', () => {
  const out=classifyReviveOutcome(input({revives:[
    {id:'assigned-fail',reviverId:200,targetId:100,success:false,at:new Date('2026-08-26T10:02:00Z')},
    {id:'third-party',reviverId:300,targetId:100,success:true,at:new Date('2026-08-26T10:02:30Z')}
  ]}));
  assert.equal(out.kind,'assigned_failed');
  assert.equal(out.evidence.id,'assigned-fail');
});

test('leaving hospital before the captured natural release timestamp is requester self-exit', () => {
  const out=classifyReviveOutcome(input({
    now:new Date('2026-08-26T10:05:00Z'),
    hospitalStatus:{state:'Okay',until:null},
    hospitalUntilBaseline:new Date('2026-08-26T10:20:00Z')
  }));
  assert.equal(out.kind,'requester_exit');
});

test('leaving at or after captured hospital until is natural expiry', () => {
  const out=classifyReviveOutcome(input({
    now:new Date('2026-08-26T10:20:01Z'),
    hospitalStatus:{state:'Okay',until:null},
    hospitalUntilBaseline:new Date('2026-08-26T10:20:00Z')
  }));
  assert.equal(out.kind,'natural_expiry');
});

test('hospital exit without baseline is ambiguous rather than guessed', () => {
  const out=classifyReviveOutcome(input({hospitalStatus:{state:'Okay',until:null},hospitalUntilBaseline:null}));
  assert.equal(out.kind,'ambiguous');
});

test('no on-time attempt becomes no_attempt only after reconciliation grace', () => {
  assert.equal(classifyReviveOutcome(input({now:new Date('2026-08-26T10:06:20Z')})).kind,'pending');
  assert.equal(classifyReviveOutcome(input({now:new Date('2026-08-26T10:06:31Z')})).kind,'no_attempt');
});

test('late assigned success does not satisfy the five-minute SLA', () => {
  const out=classifyReviveOutcome(input({
    now:new Date('2026-08-26T10:06:31Z'),
    revives:[{id:'late',reviverId:200,targetId:100,success:true,at:new Date('2026-08-26T10:06:05Z')}]
  }));
  assert.equal(out.kind,'no_attempt');
});

test('pre-window and wrong-target revives are ignored', () => {
  const out=classifyReviveOutcome(input({revives:[
    {id:'old',reviverId:200,targetId:100,success:true,at:new Date('2026-08-26T10:00:59Z')},
    {id:'wrong',reviverId:200,targetId:999,success:true,at:new Date('2026-08-26T10:02:00Z')}
  ]}));
  assert.equal(out.kind,'pending');
});
