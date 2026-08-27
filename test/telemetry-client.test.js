const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelemetryClient, sanitizeClientEnvelope } = require('../src/telemetry-client');

function makeClock(start = 1000) {
  let value = start;
  return { now: () => value, advance: ms => { value += ms; } };
}

test('captures sanitized client errors and drains at most 20', async () => {
  const sent = [];
  let saved = [];
  const clock = makeClock();
  const client = createTelemetryClient({
    submit: async batch => sent.push(batch), getStoredQueue: () => saved,
    saveStoredQueue: q => { saved = q; }, version: '0.4.0', buildCommit: 'abc', now: clock.now
  });
  for (let i = 0; i < 25; i += 1) {
    client.captureError(new Error(`boom ${i}`), { operation: `render-${i}`, requestBody: { apiKey: 'SECRET' } });
  }
  await client.drain();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].errors.length, 20);
  assert.equal(saved.length, 5);
  assert.equal(sent[0].errors[0].component, 'client');
  assert.doesNotMatch(JSON.stringify(sent), /SECRET|requestBody/);
});

test('coalesces identical errors locally for 60 seconds', () => {
  let saved = [];
  const clock = makeClock();
  const client = createTelemetryClient({ submit: async()=>{}, getStoredQueue:()=>saved, saveStoredQueue:q=>{saved=q;}, version:'0.4.0', now:clock.now });
  client.captureError(new Error('same 123'), { operation:'render' });
  client.captureError(new Error('same 456'), { operation:'render' });
  assert.equal(saved.length, 1);
  clock.advance(60_001);
  client.captureError(new Error('same 789'), { operation:'render' });
  assert.equal(saved.length, 2);
});

test('queue is bounded to 100 and counts oldest drops', () => {
  let saved = [];
  const client = createTelemetryClient({ submit:async()=>{}, getStoredQueue:()=>saved, saveStoredQueue:q=>{saved=q;}, version:'0.4.0', now:(()=>{let n=0; return()=>++n*61_000;})() });
  for (let i=0;i<105;i+=1) client.captureError(new Error(`unique ${i}`), { operation:`op-${i}` });
  assert.equal(saved.length, 100);
  assert.equal(client.getDroppedCount(), 5);
  assert.match(saved[0].message, /unique 5/);
});

test('submit failure is non-recursive and preserves queued batch', async () => {
  let saved = [];
  let calls = 0;
  const client = createTelemetryClient({ submit:async()=>{calls += 1; throw new Error('transport secret');}, getStoredQueue:()=>saved, saveStoredQueue:q=>{saved=q;}, version:'0.4.0', now:()=>1000 });
  client.captureError(new Error('boom'), { operation:'render' });
  const result = await client.drain();
  assert.equal(result.sent, 0);
  assert.equal(saved.length, 1);
  assert.equal(calls, 1);
});

test('sanitizes before persistence and keeps only safe context', () => {
  const safe = sanitizeClientEnvelope({
    component:'client', version:'0.4.0', severity:'error',
    message:'Authorization: Bearer SECRET apiKey=ABC123 boom',
    stack:'at render (https://example/app.js?token=STACKSECRET:1:2)',
    context:{ operation:'render', route:'/x?token=ROUTESECRET', body:{password:'NO'}, chat:'private' },
    occurredAt:'2026-08-26T12:00:00Z'
  });
  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, /SECRET|ABC123|STACKSECRET|ROUTESECRET|password|private|chat/);
  assert.deepEqual(Object.keys(safe.context).sort(), ['operation','route']);
  assert.ok(safe.message.length <= 1000);
  assert.ok((safe.stack || '').length <= 8000);
});
