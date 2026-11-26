const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiteEngine } = require('../src/lite/engine');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createFakeDocument, createFakeWindow } = require('./helpers/fake-dom');
const { createChannelHub, createLockManager, createAbortController } = require('./helpers/fake-tabs');

function memoryStorage() {
  const values = {};
  return { values, get: (key, fallback) => (key in values ? values[key] : fallback), set: (key, value) => { values[key] = value; } };
}

function snapshot(overrides = {}) {
  return {
    stateVersion: '0123456789abcdef',
    nextPollMs: 60000,
    me: { tornId: 1001, name: 'Patient', roles: ['requester'], verification: { usable: true, requester: true, reviver: false } },
    pro: { state: 'NONE' },
    activeRequest: null,
    activeTransactions: [],
    recentlyClosed: [],
    revivers: { online: 2 },
    queue: null,
    ...overrides
  };
}

function fakeApi(responses) {
  const api = {
    calls: 0,
    resets: 0,
    badgeClears: 0,
    reset() { api.resets += 1; },
    clearBadges() { api.badgeClears += 1; },
    async getState() {
      api.calls += 1;
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (next instanceof Error) throw next;
      return next;
    }
  };
  return api;
}

function tabs(count, clock, responsesFor) {
  const hub = createChannelHub();
  const locks = createLockManager();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const storage = memoryStorage();
  return Array.from({ length: count }, (_, index) => {
    const api = fakeApi(responsesFor(index));
    const window = createFakeWindow({ BroadcastChannel, locks });
    window.AbortController = function AbortController() { return createAbortController(); };
    const document = createFakeDocument();
    const live = [];
    const engine = createLiteEngine({ api, window, document, storage, clock, tabId: `t${index}`, headerSelectors: ['#rr-none'], onLiveSnapshot: snap => live.push(snap) });
    return { api, engine, document, live };
  });
}

test('onLiveSnapshot runs only in the leader of three tabs, only for live data, including after a hand-off', async () => {
  const clock = createFakeTimers();
  const [a, b, c] = tabs(3, clock, () => [{ notModified: false, snapshot: snapshot() }, new Error('down')]);
  a.engine.start();
  b.engine.start();
  c.engine.start();
  await clock.advance(0);
  assert.equal(a.live.length, 1);
  assert.equal(b.live.length + c.live.length, 0, 'followers render broadcasts but never notify');
  await clock.advance(60000);
  assert.equal(a.live.length, 1, 'an offline result is not live');
  a.document.setVisibility('hidden');
  await clock.advance(0);
  assert.equal(b.engine.isLeader(), true);
  await clock.advance(60000);
  assert.equal(b.live.length, 1);
  assert.equal(a.live.length + c.live.length, 1);
  a.engine.stop();
  b.engine.stop();
  c.engine.stop();
});

test('M1: a hand-off after a failed poll polls at once instead of waiting a cadence', async () => {
  const clock = createFakeTimers();
  const [a, b] = tabs(2, clock, index => (index === 0 ? [{ notModified: false, snapshot: snapshot() }, new Error('down')] : [{ notModified: false, snapshot: snapshot() }]));
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  a.engine.refresh();
  await clock.advance(0);
  assert.equal(b.engine.viewModel().offline, true, 'the follower shows the leader\'s failure');
  a.document.setVisibility('hidden');
  await clock.advance(0);
  assert.equal(b.api.calls, 1, 'non-live inherited data never defers the first poll');
  a.engine.stop();
  b.engine.stop();
});

test('M3: a hidden follower does not record first sight of an outcome', async () => {
  const clock = createFakeTimers();
  const closedAt = new Date(clock.now()).toISOString();
  const done = snapshot({ recentlyClosed: [{ id: 'tx1', participantRole: 'requester', state: 'COMPLETED', closedAt }] });
  const [a, b] = tabs(2, clock, () => [{ notModified: false, snapshot: done }]);
  b.document.visibilityState = 'hidden';
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  await clock.advance(4000);
  b.document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(b.engine.viewModel().label, 'Revived', 'seen 4 s after the leader, but first displayed only now');
  await clock.advance(4000);
  assert.equal(b.engine.viewModel().label, 'Revived');
  a.engine.stop();
  b.engine.stop();
});

test('a session reset clears the badge LRU; a 304 resync keeps it', async () => {
  const clock = createFakeTimers();
  const [a] = tabs(1, clock, () => [{ notModified: false, snapshot: snapshot() }, { notModified: true, stateVersion: 'ffffffffffffffff' }]);
  a.engine.start();
  await clock.advance(0);
  await clock.advance(60000);
  assert.equal(a.api.resets, 1);
  assert.equal(a.api.badgeClears, 0);
  a.engine.resetSession();
  assert.equal(a.api.badgeClears, 1);
  a.engine.stop();
});
