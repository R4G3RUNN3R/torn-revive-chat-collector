const test = require('node:test');
const assert = require('node:assert/strict');
const { SEEN_KEY, SETTINGS_KEY, createNotifier } = require('../src/lite/notify');

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return { values, get: (key, fallback) => (key in values ? values[key] : fallback), set: (key, value) => { values[key] = value; } };
}

function setup({ settings = null, hour = 12, shown = true, hidden = false } = {}) {
  const storage = memoryStorage(settings ? { [SETTINGS_KEY]: settings } : {});
  const shownList = [];
  const chimes = [];
  const document = { hidden, title: 'Torn' };
  const at = new Date(2026, 10, 26, hour, 0, 0).getTime();
  let now = at;
  const notifier = createNotifier({
    storage,
    notify: options => { shownList.push(options); return shown; },
    window: { focus() {} },
    document,
    now: () => now,
    chime: () => chimes.push(1)
  });
  return { storage, shownList, chimes, document, notifier, advance: ms => { now += ms; } };
}

const tx = (id, participantRole, state) => ({ id, participantRole, state });

test('each transaction event fires once, with sound only for action and outcome events', () => {
  const { notifier, shownList, chimes } = setup();
  const snapshot = { activeTransactions: [tx('t1', 'requester', 'WAITING_FOR_PAYMENT'), tx('t2', 'reviver', 'WAITING_FOR_REVIVE')], recentlyClosed: [tx('t0', 'requester', 'COMPLETED')] };
  assert.equal(notifier.onSnapshot(snapshot), 3);
  assert.equal(notifier.onSnapshot(snapshot), 0, 'deduped by event id');
  assert.deepEqual(shownList.map(entry => entry.text), ['A reviver accepted: time to pay', 'Payment received: revive now', 'You were revived']);
  assert.equal(chimes.length, 3);
  notifier.onSnapshot({ activeTransactions: [tx('t1', 'requester', 'WAITING_FOR_REVIVE')] });
  assert.equal(shownList.at(-1).text, 'Payment verified');
  assert.equal(chimes.length, 3, 'payment verified is silent');
});

test('the dedupe store is shared GM storage, so a second notifier (another tab) stays quiet', () => {
  const first = setup();
  const snapshot = { activeTransactions: [tx('t1', 'reviver', 'REFUND_REQUIRED')] };
  first.notifier.onSnapshot(snapshot);
  const second = createNotifier({ storage: first.storage, notify: () => assert.fail('duplicate notification'), chime: () => assert.fail('duplicate sound') });
  assert.equal(second.onSnapshot(snapshot), 0);
  assert.equal(first.storage.values[SEEN_KEY].ids.length, 1);
});

test('new queue requests are opt-in, silent and at most one a minute', () => {
  const off = setup();
  off.notifier.onSnapshot({ queue: { count: 1 } });
  off.notifier.onSnapshot({ queue: { count: 3 } });
  assert.equal(off.shownList.length, 0, 'off by default');
  const on = setup({ settings: { types: { newRequest: true } } });
  on.notifier.onSnapshot({ queue: { count: 1 } });
  assert.equal(on.shownList.length, 0, 'the first count is a baseline');
  on.notifier.onSnapshot({ queue: { count: 2 } });
  on.advance(30000);
  on.notifier.onSnapshot({ queue: { count: 3 } });
  assert.equal(on.shownList.length, 1, 'rate limited');
  on.advance(60000);
  on.notifier.onSnapshot({ queue: { count: 4 } });
  assert.equal(on.shownList.length, 2);
  assert.equal(on.chimes.length, 0);
});

test('master switch, per-type toggles, sound toggle and quiet hours', () => {
  const disabled = setup({ settings: { enabled: false } });
  disabled.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] });
  assert.equal(disabled.shownList.length, 0);
  const typeOff = setup({ settings: { types: { accepted: false } } });
  typeOff.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] });
  assert.equal(typeOff.shownList.length, 0);
  const silent = setup({ settings: { sound: false } });
  silent.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] });
  assert.equal(silent.shownList.length, 1);
  assert.equal(silent.chimes.length, 0);
  const night = setup({ settings: { quietFrom: 22, quietTo: 7 }, hour: 23 });
  night.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] });
  assert.equal(night.shownList.length, 0);
  assert.equal(night.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] }), 0, 'still marked seen');
  const day = setup({ settings: { quietFrom: 22, quietTo: 7 }, hour: 12 });
  day.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] });
  assert.equal(day.shownList.length, 1);
});

test('a failing notification API still marks the event seen and plays the chime', () => {
  const storage = memoryStorage();
  const chimes = [];
  const notifier = createNotifier({ storage, notify: () => { throw new Error('denied'); }, chime: () => chimes.push(1) });
  assert.equal(notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'COMPLETED')] }), 1);
  assert.equal(notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'COMPLETED')] }), 0);
  assert.equal(chimes.length, 1);
});

test('the dedupe store is written only when it changes, not on every poll', () => {
  const writes = [];
  const values = {};
  const storage = { get: (key, fallback) => (key in values ? values[key] : fallback), set: (key, value) => { writes.push(key); values[key] = value; } };
  const notifier = createNotifier({ storage, notify: () => true, chime: () => {} });
  const snapshot = { activeTransactions: [tx('a', 'requester', 'WAITING_FOR_REVIVE')], queue: { count: 2 } };
  notifier.onSnapshot(snapshot);
  notifier.onSnapshot(snapshot);
  notifier.onSnapshot(snapshot);
  assert.equal(writes.length, 1);
});

test('notifyOnce delivers a system message once per id', () => {
  const { notifier, shownList } = setup();
  assert.equal(notifier.notifyOnce('update:1.0.2', 'ReviveRelay 1.0.2 is available.'), true);
  assert.equal(notifier.notifyOnce('update:1.0.2', 'ReviveRelay 1.0.2 is available.'), false);
  assert.equal(shownList.length, 1);
});

test('a queue notification carries only the count, never request details', () => {
  const { notifier, shownList } = setup({ settings: { types: { newRequest: true } } });
  notifier.onSnapshot({ queue: { count: 1 } });
  notifier.onSnapshot({ queue: { count: 2 }, activeTransactions: [] });
  assert.deepEqual(shownList.map(entry => entry.text), ['New revive request (2 in queue)']);
  assert.equal(notifier.onSnapshot({ queue: null }), 0, 'no queue access, no queue notification');
});
