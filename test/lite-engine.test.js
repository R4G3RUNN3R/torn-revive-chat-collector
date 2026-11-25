const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiteEngine } = require('../src/lite/engine');
const { HOST_ID } = require('../src/lite/pill-view');
const { SNAPSHOT_KEY } = require('../src/lite/snapshot-cache');
const { DirectApiClientError } = require('../src/direct-api-client');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createFakeDocument, createFakeWindow } = require('./helpers/fake-dom');
const { createChannelHub, createLockManager, createAbortController } = require('./helpers/fake-tabs');

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    get: (key, fallback) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback),
    set: (key, value) => { values[key] = value; }
  };
}

function snapshot(overrides = {}) {
  return {
    stateVersion: '0123456789abcdef',
    nextPollMs: 60000,
    me: { tornId: 1001, name: 'Patient', roles: ['requester'], verification: { usable: true, requester: true, reviver: false } },
    pro: { state: 'NONE' },
    activeRequest: null,
    activeTransactions: [],
    revivers: { online: 2 },
    queue: null,
    ...overrides
  };
}

function fakeApi(responses) {
  const api = {
    calls: 0,
    async getState() {
      api.calls += 1;
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (next instanceof Error) throw next;
      return next;
    }
  };
  return api;
}

function makeEngine({ clock, api, storage = memoryStorage(), window = createFakeWindow(), document = createFakeDocument(), tabId = 'tab', platform = null }) {
  const engine = createLiteEngine({ platform, api, window, document, storage, clock, tabId, headerSelectors: ['#rr-none'] });
  return { engine, document, window, storage };
}

const pillText = engine => engine.viewModel() && engine.viewModel().text;

test('boot paints the cached snapshot as syncing before the network answers, then confirms it', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage({ [SNAPSHOT_KEY]: { stateVersion: '0123456789abcdef', fetchedAt: clock.now() - 60000, data: snapshot({ revivers: { online: 7 } }) } });
  const api = fakeApi([{ notModified: false, snapshot: snapshot({ revivers: { online: 4 } }) }]);
  const { engine, document } = makeEngine({ clock, api, storage });
  engine.start();
  assert.equal(pillText(engine), 'Revive me · 7 online');
  assert.equal(engine.viewModel().syncing, true);
  assert.ok(document.getElementById(HOST_ID));
  assert.equal(api.calls, 0);
  await clock.advance(0);
  assert.equal(api.calls, 1);
  assert.equal(pillText(engine), 'Revive me · 4 online');
  assert.equal(engine.viewModel().syncing, false);
  assert.equal(storage.values[SNAPSHOT_KEY].data.revivers.online, 4);
  assert.equal(storage.values[SNAPSHOT_KEY].fetchedAt, clock.now());
  engine.stop();
});

test('without BroadcastChannel the tab is always leader and polls on the server cadence with one timer', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  assert.equal(engine.isLeader(), true);
  await clock.advance(0);
  assert.equal(clock.pending(), 1);
  assert.equal(clock.nextDelay(), 60000);
  await clock.advance(60000);
  assert.equal(api.calls, 2);
  engine.stop();
});

test('an active request polls every 5 s and ticks the timer every second (still one timer)', async () => {
  const createdAt = new Date(Date.parse('2026-11-25T12:00:00.000Z') - 10000).toISOString();
  const active = snapshot({ nextPollMs: 5000, activeRequest: { id: 'r1', state: 'AVAILABLE', createdAt, transactionId: null } });
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: active }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Waiting · 0:10');
  assert.equal(clock.pending(), 1);
  await clock.advance(1000);
  assert.equal(pillText(engine), 'Waiting · 0:11');
  await clock.advance(4000);
  assert.equal(api.calls, 2);
  await clock.advance(60000);
  assert.equal(api.calls, 14);
  assert.equal(clock.pending(), 1);
  engine.stop();
});

test('304 keeps the snapshot, confirms it live and refreshes the cache time', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }, { notModified: true, stateVersion: '0123456789abcdef' }]);
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  await clock.advance(60000);
  assert.equal(api.calls, 2);
  assert.equal(engine.viewModel().syncing, false);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  assert.equal(storage.values[SNAPSHOT_KEY].fetchedAt, clock.now());
  engine.stop();
});

test('transport failure shows "Offline · retrying" and backs off 5 → 10 s, then recovers', async () => {
  const clock = createFakeTimers();
  const down = new DirectApiClientError('NETWORK_ERROR', { retryable: true });
  const api = fakeApi([down, down, { notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, window: createFakeWindow() });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Offline · retrying');
  assert.equal(engine.viewModel().tone, 'neutral');
  const firstBackoff = clock.nextDelay();
  assert.ok(firstBackoff >= 4000 && firstBackoff <= 6000, `backoff ${firstBackoff}`);
  await clock.advance(firstBackoff);
  const secondBackoff = clock.nextDelay();
  assert.ok(secondBackoff >= 8000 && secondBackoff <= 12000, `backoff ${secondBackoff}`);
  await clock.advance(secondBackoff);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  assert.equal(clock.nextDelay(), 60000);
  engine.stop();
});

test('a hidden tab makes no requests and holds no timers; becoming visible polls at once', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const document = createFakeDocument();
  document.visibilityState = 'hidden';
  const { engine } = makeEngine({ clock, api, document });
  engine.start();
  await clock.advance(10 * 60000);
  assert.equal(api.calls, 0);
  assert.equal(clock.pending(), 0);
  document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(api.calls, 1);
  document.setVisibility('hidden');
  assert.equal(clock.pending(), 0);
  await clock.advance(10 * 60000);
  assert.equal(api.calls, 1);
  engine.stop();
});

test('start/stop are idempotent: no duplicated hosts, listeners or timers across cycles', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine, document, window } = makeEngine({ clock, api });
  for (let cycle = 0; cycle < 5; cycle += 1) {
    engine.start();
    engine.start();
    await clock.advance(0);
    assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
    assert.equal(document.listenerCount('visibilitychange'), 1);
    assert.equal(window.listenerCount('resize'), 1);
    assert.equal(clock.pending(), 1);
    engine.stop();
    engine.stop();
    assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 0);
    assert.equal(document.listenerCount('visibilitychange'), 0);
    assert.equal(window.listenerCount('resize'), 0);
    assert.equal(clock.pending(), 0);
  }
  assert.equal(api.calls, 5);
  assert.equal(engine.isStarted(), false);
});

test('a response arriving after stop is ignored', async () => {
  const clock = createFakeTimers();
  let resolve;
  const api = { calls: 0, getState: () => { api.calls += 1; return new Promise(r => { resolve = r; }); } };
  const storage = memoryStorage();
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  engine.stop();
  resolve({ notModified: false, snapshot: snapshot() });
  await clock.flush();
  assert.equal(storage.values[SNAPSHOT_KEY], undefined);
  assert.equal(clock.pending(), 0);
});

test('TornPDA runtime ignores BroadcastChannel and leads alone', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, window: createFakeWindow({ BroadcastChannel }), platform: { runtime: { isTornPda: true } } });
  engine.start();
  assert.equal(engine.isLeader(), true);
  assert.equal(hub.openCount(), 0);
  engine.stop();
});

test('three tabs: exactly one polls, the others render its broadcast; hiding the leader hands off', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const storage = memoryStorage();
  const tabs = ['a', 'b', 'c'].map(tabId => {
    const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
    const window = createFakeWindow({ BroadcastChannel, locks });
    window.AbortController = function AbortController() { return createAbortController(); };
    return { api, ...makeEngine({ clock, api, storage, window, tabId }) };
  });
  tabs.forEach(tab => tab.engine.start());
  await clock.advance(0);
  await clock.advance(60000);
  assert.deepEqual(tabs.map(tab => tab.engine.isLeader()), [true, false, false]);
  assert.deepEqual(tabs.map(tab => tab.api.calls), [2, 0, 0]);
  for (const tab of tabs) {
    assert.equal(pillText(tab.engine), 'Revive me · 2 online');
    assert.equal(tab.engine.viewModel().syncing, false);
  }

  tabs[0].document.setVisibility('hidden');
  await clock.advance(0);
  assert.deepEqual(tabs.map(tab => tab.engine.isLeader()), [false, true, false]);
  assert.equal(tabs[1].api.calls, 1);
  await clock.advance(60000);
  assert.deepEqual(tabs.map(tab => tab.api.calls), [2, 2, 0]);
  tabs.forEach(tab => tab.engine.stop());
  assert.equal(hub.openCount(), 0);
});

test('setSheetOpen speeds a reviver poll to 5 s and enables the 1 s tick', async () => {
  const clock = createFakeTimers();
  const reviver = snapshot({ nextPollMs: 20000, me: { tornId: 2, name: 'Medic', roles: ['reviver'], verification: { usable: true, requester: false, reviver: true } }, queue: { count: 3 } });
  const api = fakeApi([{ notModified: false, snapshot: reviver }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Queue · 3');
  assert.equal(clock.nextDelay(), 20000);
  engine.setSheetOpen(true);
  assert.equal(clock.nextDelay(), 1000);
  await clock.advance(5000);
  assert.equal(api.calls, 2);
  engine.setSheetOpen(false);
  assert.equal(clock.nextDelay(), 20000);
  engine.stop();
});

test('constructor validation', () => {
  assert.throws(() => createLiteEngine({ document: createFakeDocument(), storage: memoryStorage() }), /api.getState/);
  assert.throws(() => createLiteEngine({ api: fakeApi([]), storage: memoryStorage() }), /document/);
});

test('a lone hidden leader never polls, even on refresh or in a shared-channel profile', async () => {
  for (const mode of ['solo', 'locks', 'heartbeat']) {
    const clock = createFakeTimers();
    const hub = createChannelHub();
    function BroadcastChannel(name) { return hub.createChannel(name); }
    const options = mode === 'solo' ? {} : mode === 'locks' ? { BroadcastChannel, locks: createLockManager() } : { BroadcastChannel };
    const window = createFakeWindow(options);
    window.AbortController = function AbortController() { return createAbortController(); };
    const document = createFakeDocument();
    document.visibilityState = 'hidden';
    const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
    const { engine } = makeEngine({ clock, api, window, document });
    engine.start();
    engine.refresh();
    await clock.advance(10 * 60000);
    assert.equal(api.calls, 0, `${mode}: hidden tab polled`);
    assert.equal(clock.pending(), 0, `${mode}: hidden tab holds a timer`);
    engine.stop();
  }
});
