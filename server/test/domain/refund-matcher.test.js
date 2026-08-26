const test = require("node:test");
const assert = require("node:assert/strict");
const { matchRefundEvidence } = require("../../src/domain/refund-matcher");

const requiredAt = new Date("2026-08-26T10:10:00Z");
const deadline = new Date("2026-08-26T10:20:00Z");

function input(overrides={}) {
  return {
    method:"xanax", requiredAmount:3, requesterTornId:111,
    refundRequiredAt:requiredAt, refundDeadline:deadline,
    logs:[], ...overrides
  };
}

test("split on-time Xanax refunds satisfy the actual verified amount", () => {
  const out = matchRefundEvidence(input({logs:[
    {id:"a",recipientId:111,kind:"xanax",amount:1,at:new Date("2026-08-26T10:12:00Z")},
    {id:"b",recipientId:111,kind:"xanax",amount:2,at:new Date("2026-08-26T10:15:00Z")}
  ]}));
  assert.equal(out.status,"verified");
  assert.equal(out.verifiedAmount,3);
  assert.equal(out.evidence.length,2);
});

test("over-refund records actual amount rather than truncating to required amount", () => {
  const out = matchRefundEvidence(input({requiredAmount:4,logs:[
    {id:"a",recipientId:111,kind:"xanax",amount:5,at:new Date("2026-08-26T10:12:00Z")}
  ]}));
  assert.equal(out.status,"verified");
  assert.equal(out.verifiedAmount,5);
});

test("wrong party, wrong method, pre-obligation and duplicate evidence are ignored", () => {
  const out = matchRefundEvidence(input({logs:[
    {id:"wrong-party",recipientId:999,kind:"xanax",amount:3,at:new Date("2026-08-26T10:11:00Z")},
    {id:"wrong-method",recipientId:111,kind:"cash",amount:500000,at:new Date("2026-08-26T10:11:00Z")},
    {id:"old",recipientId:111,kind:"xanax",amount:3,at:new Date("2026-08-26T10:09:59Z")},
    {id:"partial",recipientId:111,kind:"xanax",amount:1,at:new Date("2026-08-26T10:12:00Z")},
    {id:"partial",recipientId:111,kind:"xanax",amount:2,at:new Date("2026-08-26T10:13:00Z")}
  ]}));
  assert.equal(out.status,"not_found");
  assert.equal(out.verifiedAmount,1);
  assert.equal(out.evidence.length,1);
});

test("on-time evidence remains valid even if fetched after the deadline", () => {
  const out = matchRefundEvidence(input({method:"cash",requiredAmount:750000,logs:[
    {id:"cash",recipientId:111,kind:"cash",amount:750000,at:new Date("2026-08-26T10:19:59Z")}
  ]}));
  assert.equal(out.status,"verified");
});

test("post-deadline transfer does not satisfy the refund contract", () => {
  const out = matchRefundEvidence(input({logs:[
    {id:"late",recipientId:111,kind:"xanax",amount:3,at:new Date("2026-08-26T10:20:01Z")}
  ]}));
  assert.equal(out.status,"not_found");
  assert.equal(out.verifiedAmount,0);
});
