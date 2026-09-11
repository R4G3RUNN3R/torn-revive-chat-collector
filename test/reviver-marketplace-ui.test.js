const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('reviver marketplace supports registration queue and accept', () => {
  assert.match(source, /Register as reviver/i);
  assert.match(source, /registerReviver\(/);
  assert.match(source, /getReviverQueue\(/);
  assert.match(source, /acceptRequest\(/);
});

test('reviver queue and Accept require active Pro, reviver role and server-validated capability', () => {
  assert.match(source, /isProActive\(\)/);
  assert.match(source, /hasRole\(['"]reviver['"]\)/);
  assert.match(source, /hasCredentialCapability\(['"]reviver['"]\)/);
  assert.match(source, /rr-reviver-queue/);
});

test('client exposes only named transaction actions and never submits arbitrary state', () => {
  assert.match(source, /checkPayment\(/);
  assert.match(source, /requestRetry\(/);
  assert.match(source, /respondRetry\(/);
  assert.match(source, /requestRefund\(/);
  assert.match(source, /checkRefund\(/);
  assert.doesNotMatch(source, /state\.api\.[A-Za-z]+\([^\n]*\{[^\n]*state\s*:/);
});


test('session identity merges server roles so reviver registration becomes visible to the UI', () => {
  assert.match(source, /roles:\s*Array\.isArray\(me\?\.roles\)/);
});


test('Reviver tab uses only server-certified direct requests and has no chat candidate feed', () => {
  assert.match(source, /Certified revive queue/i);
  assert.match(source, /CERTIFIED REQUEST/);
  assert.match(source, /request\?\.certified === true/);
  assert.doesNotMatch(source, /Shared public chat requests|fetchRecentPublicCandidates|\/v1\/candidates|rr-public-candidate-feed/i);
});

test('reviver queue provides payment filtering, per-currency minimums, grouping, sorting and explicit refresh', () => {
  for (const token of [
    'rr-queue-payment-filter',
    'rr-queue-min-cash',
    'rr-queue-min-xanax',
    'rr-queue-sort',
    'rr-queue-group',
    'rr-refresh-queue'
  ]) assert.match(source, new RegExp(token));
  assert.match(source, /function queueViewRequests\(/);
  assert.match(source, /function groupQueueRequests\(/);
  assert.match(source, /refreshReviverQueue\(\)/);
});

test('queue view helper filters each currency independently and sorts deterministically', () => {
  const start = source.indexOf('function queueViewRequests(requests)');
  const end = source.indexOf('function groupQueueRequests(requests)', start);
  const body = start >= 0 && end > start ? source.slice(start, end) : '';
  assert.ok(body.length > 0, 'queueViewRequests helper is required');

  const state = {
    queuePaymentFilter: 'all',
    queueMinCash: 700000,
    queueMinXanax: 2,
    queueSort: 'newest'
  };
  const queueViewRequests = new Function('state', `${body}; return queueViewRequests;`)(state);
  const requests = [
    { id:'cash-low', paymentMethod:'cash', offerAmount:500000, createdAt:'2026-09-11T10:00:00Z' },
    { id:'cash-high', paymentMethod:'cash', offerAmount:900000, createdAt:'2026-09-11T09:00:00Z' },
    { id:'xan-low', paymentMethod:'xanax', offerAmount:1, createdAt:'2026-09-11T12:00:00Z' },
    { id:'xan-high', paymentMethod:'xanax', offerAmount:3, createdAt:'2026-09-11T11:00:00Z' }
  ];
  assert.deepEqual(queueViewRequests(requests).map(item => item.id), ['xan-high','cash-high']);

  state.queuePaymentFilter = 'cash';
  state.queueSort = 'offer-desc';
  state.queueMinCash = 0;
  assert.deepEqual(queueViewRequests(requests).map(item => item.id), ['cash-high','cash-low']);

  state.queueSort = 'offer-asc';
  assert.deepEqual(queueViewRequests(requests).map(item => item.id), ['cash-low','cash-high']);
});

test('queue grouping separates cash and Xanax without losing requests', () => {
  const start = source.indexOf('function groupQueueRequests(requests)');
  const end = source.indexOf('function renderCertifiedRequest(request)', start);
  const body = start >= 0 && end > start ? source.slice(start, end) : '';
  assert.ok(body.length > 0, 'groupQueueRequests helper is required');
  const state = { queueGroup: 'payment' };
  const groupQueueRequests = new Function('state', `${body}; return groupQueueRequests;`)(state);
  const grouped = groupQueueRequests([
    { id:'c1', paymentMethod:'cash' },
    { id:'x1', paymentMethod:'xanax' },
    { id:'c2', paymentMethod:'cash' }
  ]);
  assert.deepEqual(grouped.map(group => [group.key, group.requests.map(item => item.id)]), [
    ['cash',['c1','c2']],
    ['xanax',['x1']]
  ]);
});


test('queue controls are not destroyed by the one-second transaction clock', () => {
  const start = source.indexOf('clockTimer = setInterval(() => {');
  const end = source.indexOf('}, 1000);', start);
  const clock = start >= 0 && end > start ? source.slice(start, end) : '';
  assert.ok(clock.length > 0);
  assert.match(clock, /state\.activeTransaction/);
  assert.doesNotMatch(clock, /state\.reviverQueue\.length/);
});
