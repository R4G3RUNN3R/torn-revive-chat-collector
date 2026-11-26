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
  // Only the first cycle polls: later restarts find a cache younger than the 60 s cadence.
  assert.equal(api.calls, 1);
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Scripted api: each entry is a result, an Error, or a deferred (hangs until resolved).
function scriptedApi(script) {
  const api = {
    calls: 0,
    resets: 0,
    getState() {
      api.calls += 1;
      const next = script.length > 1 ? script.shift() : script[0];
      if (next && next.promise) return next.promise;
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
    reset() { api.resets += 1; }
  };
  return api;
}

function lockTabs({ clock, specs, sharedStorage = null }) {
  const hub = createChannelHub();
  const locks = createLockManager();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const tabs = specs.map(({ tabId, api }) => {
    const window = createFakeWindow({ BroadcastChannel, locks });
    window.AbortController = function AbortController() { return createAbortController(); };
    return { api, ...makeEngine({ clock, api, storage: sharedStorage || memoryStorage(), window, tabId }) };
  });
  return { hub, tabs };
}

test('an old leader\'s response landing after hand-off never overwrites the newer leader\'s state', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const hang = deferred();
  const apiA = scriptedApi([hang]);
  const apiB = scriptedApi([{ notModified: false, snapshot: snapshot({ stateVersion: 'bbbbbbbbbbbbbbbb', revivers: { online: 9 } }) }]);
  const { tabs: [a, b] } = lockTabs({ clock, sharedStorage: storage, specs: [{ tabId: 'a', api: apiA }, { tabId: 'b', api: apiB }] });
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), true);
  assert.equal(apiA.calls, 1);

  a.document.setVisibility('hidden');
  await clock.advance(1000);
  assert.equal(b.engine.isLeader(), true);
  assert.equal(a.engine.isLeader(), false);
  assert.equal(apiB.calls, 1);
  const newerFetchedAt = storage.values[SNAPSHOT_KEY].fetchedAt;
  assert.equal(pillText(a.engine), 'Revive me · 9 online');

  await clock.advance(1000);
  hang.resolve({ notModified: false, snapshot: snapshot({ revivers: { online: 2 } }) });
  await clock.flush();
  assert.equal(storage.values[SNAPSHOT_KEY].data.revivers.online, 9);
  assert.equal(storage.values[SNAPSHOT_KEY].fetchedAt, newerFetchedAt);
  assert.equal(pillText(b.engine), 'Revive me · 9 online');
  assert.equal(pillText(a.engine), 'Revive me · 9 online');
  a.engine.stop();
  b.engine.stop();
});

test('returning from a long hide shows the last snapshot as syncing until the next poll succeeds', async () => {
  const createdAt = new Date(Date.parse('2026-11-25T12:00:00.000Z') - 10000).toISOString();
  const active = snapshot({ nextPollMs: 5000, activeRequest: { id: 'r1', state: 'AVAILABLE', createdAt, transactionId: null } });
  const clock = createFakeTimers();
  const hang = deferred();
  const api = scriptedApi([{ notModified: false, snapshot: active }, hang]);
  const document = createFakeDocument();
  const { engine } = makeEngine({ clock, api, document });
  engine.start();
  await clock.advance(0);
  assert.equal(engine.viewModel().syncing, false);
  document.setVisibility('hidden');
  await clock.advance(3 * 60 * 60000);
  assert.equal(api.calls, 1);
  document.setVisibility('visible');
  assert.equal(engine.viewModel().syncing, true);
  await clock.advance(0);
  assert.equal(api.calls, 2);
  assert.equal(engine.viewModel().syncing, true);
  assert.ok(!['success', 'attention'].includes(engine.viewModel().tone));
  hang.resolve({ notModified: false, snapshot: active });
  await clock.flush();
  assert.equal(engine.viewModel().syncing, false);
  engine.stop();
});

test('a 304 for a version other than the shown snapshot is not trusted: reset, syncing, quick re-poll', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const V1 = '1111111111111111';
  const V2 = '2222222222222222';
  const apiA = scriptedApi([
    { notModified: false, snapshot: snapshot({ stateVersion: V1, revivers: { online: 1 } }) },
    { notModified: true, stateVersion: V1 },
    { notModified: false, snapshot: snapshot({ stateVersion: V2, revivers: { online: 2 } }) }
  ]);
  const apiB = scriptedApi([{ notModified: false, snapshot: snapshot({ stateVersion: V2, revivers: { online: 2 } }) }]);
  const { tabs: [a, b] } = lockTabs({ clock, sharedStorage: storage, specs: [{ tabId: 'a', api: apiA }, { tabId: 'b', api: apiB }] });
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(apiA.calls, 1);
  assert.equal(pillText(a.engine), 'Revive me · 1 online');

  a.document.setVisibility('hidden');
  await clock.advance(0);
  assert.equal(b.engine.isLeader(), true);
  assert.equal(pillText(a.engine), 'Revive me · 2 online');
  const bFetchedAt = storage.values[SNAPSHOT_KEY].fetchedAt;

  await clock.advance(1000);
  a.document.setVisibility('visible');
  b.document.setVisibility('hidden');
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), true);
  assert.equal(apiA.calls, 2);
  assert.equal(apiA.resets, 1);
  assert.equal(a.engine.viewModel().syncing, true);
  assert.equal(storage.values[SNAPSHOT_KEY].fetchedAt, bFetchedAt);
  assert.ok(clock.nextDelay() <= 3000, `re-poll in ${clock.nextDelay()}`);
  await clock.advance(3000);
  assert.equal(apiA.calls, 3);
  assert.equal(a.engine.viewModel().syncing, false);
  assert.equal(storage.values[SNAPSHOT_KEY].data.stateVersion, V2);
  a.engine.stop();
  b.engine.stop();
});

test('a poll failure that lands after losing leadership does not render Offline', async () => {
  const clock = createFakeTimers();
  const hang = deferred();
  const apiA = scriptedApi([hang]);
  const apiB = scriptedApi([{ notModified: false, snapshot: snapshot({ revivers: { online: 9 } }) }]);
  const { tabs: [a, b] } = lockTabs({ clock, specs: [{ tabId: 'a', api: apiA }, { tabId: 'b', api: apiB }] });
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  a.document.setVisibility('hidden');
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), false);
  hang.reject(new DirectApiClientError('NETWORK_ERROR', { retryable: true }));
  await clock.flush();
  assert.equal(a.engine.viewModel().offline, false);
  assert.equal(pillText(a.engine), 'Revive me · 9 online');
  a.engine.stop();
  b.engine.stop();
});

test('server nextPollMs is honoured and bounded at engine level', async () => {
  for (const [nextPollMs, expected] of [[30000, 30000], [1000, 3000]]) {
    const clock = createFakeTimers();
    const api = fakeApi([{ notModified: false, snapshot: snapshot({ nextPollMs }) }]);
    const { engine } = makeEngine({ clock, api });
    engine.start();
    await clock.advance(0);
    assert.equal(clock.nextDelay(), expected, `nextPollMs ${nextPollMs}`);
    await clock.advance(expected);
    assert.equal(api.calls, 2, `nextPollMs ${nextPollMs}`);
    engine.stop();
  }
});

test('a follower renders broadcasts but never writes the cache from them', async () => {
  const clock = createFakeTimers();
  const apiA = fakeApi([{ notModified: false, snapshot: snapshot({ revivers: { online: 6 } }) }]);
  const apiB = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { tabs: [a, b] } = lockTabs({ clock, specs: [{ tabId: 'a', api: apiA }, { tabId: 'b', api: apiB }] });
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  await clock.advance(60000);
  assert.equal(a.engine.isLeader(), true);
  assert.equal(apiB.calls, 0);
  assert.equal(pillText(b.engine), 'Revive me · 6 online');
  assert.equal(a.storage.values[SNAPSHOT_KEY].data.revivers.online, 6);
  assert.equal(b.storage.values[SNAPSHOT_KEY], undefined);
  a.engine.stop();
  b.engine.stop();
});

test('start → stop → start: a response from the first session still in flight is ignored', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const hang = deferred();
  const api = scriptedApi([hang, { notModified: false, snapshot: snapshot({ revivers: { online: 5 } }) }]);
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  engine.stop();
  engine.start();
  await clock.advance(0);
  assert.equal(api.calls, 2);
  assert.equal(pillText(engine), 'Revive me · 5 online');
  hang.resolve({ notModified: false, snapshot: snapshot({ revivers: { online: 2 } }) });
  await clock.flush();
  assert.equal(pillText(engine), 'Revive me · 5 online');
  assert.equal(storage.values[SNAPSHOT_KEY].data.revivers.online, 5);
  engine.stop();
});

test('a leader that regains leadership mid-poll polls again promptly, not a full cadence later', async () => {
  const clock = createFakeTimers();
  const hang = deferred();
  const apiA = scriptedApi([hang, { notModified: false, snapshot: snapshot({ revivers: { online: 3 } }) }]);
  const apiB = scriptedApi([{ notModified: false, snapshot: snapshot({ revivers: { online: 9 } }) }]);
  const { tabs: [a, b] } = lockTabs({ clock, specs: [{ tabId: 'a', api: apiA }, { tabId: 'b', api: apiB }] });
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), true);
  assert.equal(apiA.calls, 1);

  a.document.setVisibility('hidden');
  await clock.advance(1000);
  assert.equal(b.engine.isLeader(), true);
  a.document.setVisibility('visible');
  b.document.setVisibility('hidden');
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), true);
  assert.equal(apiA.calls, 1, 'the first poll is still in flight');

  hang.resolve({ notModified: false, snapshot: snapshot({ revivers: { online: 2 } }) });
  await clock.flush();
  await clock.advance(3000);
  assert.equal(apiA.calls, 2);
  assert.equal(pillText(a.engine), 'Revive me · 3 online');
  assert.equal(a.engine.viewModel().syncing, false);
  a.engine.stop();
  b.engine.stop();
});

test('refresh() during an in-flight poll is not lost', async () => {
  const clock = createFakeTimers();
  const hang = deferred();
  const api = scriptedApi([hang, { notModified: false, snapshot: snapshot({ revivers: { online: 4 } }) }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  await clock.advance(0);
  assert.equal(api.calls, 1);
  engine.refresh();
  hang.resolve({ notModified: false, snapshot: snapshot() });
  await clock.flush();
  await clock.advance(0);
  assert.equal(api.calls, 2);
  assert.equal(pillText(engine), 'Revive me · 4 online');
  engine.stop();
});

test('a follower showing live data ages to syncing after 2 × cadence without broadcasts, and never polls or writes the cache', async () => {
  const clock = createFakeTimers();
  const hang = deferred();
  const apiA = scriptedApi([{ notModified: false, snapshot: snapshot() }, hang]);
  const apiB = scriptedApi([{ notModified: false, snapshot: snapshot() }]);
  const { tabs: [a, b] } = lockTabs({ clock, specs: [{ tabId: 'a', api: apiA }, { tabId: 'b', api: apiB }] });
  a.engine.start();
  b.engine.start();
  const fetchedAt = clock.now();
  await clock.advance(0);
  assert.equal(b.engine.viewModel().syncing, false);
  await clock.advance(fetchedAt + 120000 - clock.now());
  assert.equal(apiA.calls, 2, 'the leader\'s second poll hangs, so nothing is broadcast');
  assert.equal(b.engine.viewModel().syncing, false);
  await clock.advance(1);
  assert.equal(b.engine.viewModel().syncing, true);
  assert.equal(pillText(b.engine), 'Revive me · 2 online');
  assert.equal(apiB.calls, 0);
  assert.equal(b.storage.values[SNAPSHOT_KEY], undefined);

  hang.resolve({ notModified: false, snapshot: snapshot({ revivers: { online: 5 } }) });
  await clock.flush();
  assert.equal(b.engine.viewModel().syncing, false);
  assert.equal(pillText(b.engine), 'Revive me · 5 online');
  a.engine.stop();
  b.engine.stop();
});

for (const mode of ['locks', 'heartbeat']) {
  test(`${mode}: a new follower receives the leader's current state promptly, without polling`, async () => {
    const clock = createFakeTimers();
    const hub = createChannelHub();
    const locks = mode === 'locks' ? createLockManager() : null;
    function BroadcastChannel(name) { return hub.createChannel(name); }
    const make = (tabId, api) => {
      const window = createFakeWindow(locks ? { BroadcastChannel, locks } : { BroadcastChannel });
      window.AbortController = function AbortController() { return createAbortController(); };
      return { api, ...makeEngine({ clock, api, window, tabId }) };
    };
    const a = make('a', scriptedApi([{ notModified: false, snapshot: snapshot({ revivers: { online: 6 } }) }]));
    a.engine.start();
    await clock.advance(1000);
    assert.equal(a.engine.isLeader(), true);
    assert.equal(a.api.calls, 1);
    await clock.advance(10000);
    const b = make('b', scriptedApi([{ notModified: false, snapshot: snapshot() }]));
    b.engine.start();
    await clock.advance(1000);
    assert.equal(b.engine.isLeader(), false);
    assert.equal(pillText(b.engine), 'Revive me · 6 online');
    assert.equal(b.engine.viewModel().syncing, false);
    assert.equal(b.api.calls, 0);
    assert.equal(b.storage.values[SNAPSHOT_KEY], undefined);
    a.engine.stop();
    b.engine.stop();
  });
}

test('a follower whose 1 s tick is running ages on the tick (active request, 5 s cadence)', async () => {
  const createdAt = new Date(Date.parse('2026-11-25T12:00:00.000Z') - 10000).toISOString();
  const active = snapshot({ nextPollMs: 5000, activeRequest: { id: 'r1', state: 'AVAILABLE', createdAt, transactionId: null } });
  const clock = createFakeTimers();
  const hang = deferred();
  const apiA = scriptedApi([{ notModified: false, snapshot: active }, hang]);
  const apiB = scriptedApi([{ notModified: false, snapshot: active }]);
  const { tabs: [a, b] } = lockTabs({ clock, specs: [{ tabId: 'a', api: apiA }, { tabId: 'b', api: apiB }] });
  a.engine.start();
  b.engine.start();
  const fetchedAt = clock.now();
  await clock.advance(0);
  assert.equal(b.engine.viewModel().syncing, false);
  await clock.advance(fetchedAt + 10000 - clock.now());
  assert.equal(b.engine.viewModel().syncing, false);
  await clock.advance(1000);
  assert.equal(b.engine.viewModel().syncing, true);
  assert.equal(apiB.calls, 0);
  a.engine.stop();
  b.engine.stop();
});

test('boot with a cache younger than the cadence waits until fetchedAt + cadence, showing it as syncing', async () => {
  const clock = createFakeTimers();
  const fetchedAt = clock.now() - 10000;
  const storage = memoryStorage({ [SNAPSHOT_KEY]: { stateVersion: '0123456789abcdef', fetchedAt, data: snapshot({ revivers: { online: 7 } }) } });
  const api = fakeApi([{ notModified: false, snapshot: snapshot({ revivers: { online: 4 } }) }]);
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  assert.equal(api.calls, 0);
  assert.equal(pillText(engine), 'Revive me · 7 online');
  assert.equal(engine.viewModel().syncing, true);
  assert.equal(clock.pending(), 1);
  await clock.advance(fetchedAt + 60000 - clock.now() - 1);
  assert.equal(api.calls, 0);
  await clock.advance(1);
  assert.equal(api.calls, 1);
  assert.equal(pillText(engine), 'Revive me · 4 online');
  assert.equal(engine.viewModel().syncing, false);
  engine.stop();
});

test('boot with a cache older than the cadence polls at once', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage({ [SNAPSHOT_KEY]: { stateVersion: '0123456789abcdef', fetchedAt: clock.now() - 2 * 60000, data: snapshot() } });
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  assert.equal(api.calls, 1);
  engine.stop();
});

test('five page loads within a minute make at most one request at idle', async () => {
  const clock = createFakeTimers();
  const startedAt = clock.now();
  const storage = memoryStorage();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  for (let load = 0; load < 5; load += 1) {
    const { engine } = makeEngine({ clock, api, storage, window: createFakeWindow(), document: createFakeDocument() });
    engine.start();
    await clock.advance(11000);
    engine.stop();
  }
  await clock.advance(startedAt + 60000 - clock.now() - 1);
  assert.equal(api.calls, 1);
});

test('a leader hand-off between running tabs still polls promptly despite a fresh cache', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const apiA = scriptedApi([{ notModified: false, snapshot: snapshot() }]);
  const apiB = scriptedApi([{ notModified: false, snapshot: snapshot() }]);
  const { tabs: [a, b] } = lockTabs({ clock, sharedStorage: storage, specs: [{ tabId: 'a', api: apiA }, { tabId: 'b', api: apiB }] });
  a.engine.start();
  await clock.advance(0);
  assert.equal(apiA.calls, 1);
  await clock.advance(5000);
  b.engine.start();
  await clock.advance(5000);
  assert.equal(apiB.calls, 0);
  a.document.setVisibility('hidden');
  await clock.advance(0);
  assert.equal(b.engine.isLeader(), true);
  assert.equal(apiB.calls, 1);
  a.engine.stop();
  b.engine.stop();
});

test('a follower\'s refresh() asks the leader to poll, bounded by the minimum poll interval', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const storage = memoryStorage();
  const tabs = ['a', 'b'].map(tabId => {
    const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
    const window = createFakeWindow({ BroadcastChannel, locks });
    window.AbortController = function AbortController() { return createAbortController(); };
    return { api, ...makeEngine({ clock, api, storage, window, tabId }) };
  });
  tabs.forEach(tab => tab.engine.start());
  await clock.advance(0);
  assert.deepEqual(tabs.map(tab => tab.engine.isLeader()), [true, false]);
  assert.equal(tabs[0].api.calls, 1);

  // Straight after a poll: the leader waits out the 3 s minimum, then polls once.
  tabs[1].engine.refresh();
  tabs[1].engine.refresh();
  await clock.advance(0);
  assert.equal(tabs[0].api.calls, 1);
  await clock.advance(3000);
  assert.equal(tabs[0].api.calls, 2);
  assert.equal(tabs[1].api.calls, 0);

  // Later: the request polls at once.
  await clock.advance(10000);
  tabs[1].engine.refresh();
  await clock.advance(0);
  assert.equal(tabs[0].api.calls, 3);

  // A hidden follower posts nothing.
  const before = hub.log.filter(entry => entry.data.type === 'refresh-request').length;
  tabs[1].document.setVisibility('hidden');
  tabs[1].engine.refresh();
  await clock.advance(0);
  assert.equal(hub.log.filter(entry => entry.data.type === 'refresh-request').length, before);
  tabs.forEach(tab => tab.engine.stop());
});

// ---- "Revived" stays 5 s from this tab's first sight (per tab; not broadcast) -----

function revivedSnapshot(clock, closedAgoMs) {
  const closedAt = new Date(clock.now() - closedAgoMs).toISOString();
  return snapshot({ serverTime: new Date(clock.now()).toISOString(), recentlyClosed: [{ id: 'tx-done', state: 'COMPLETED', participantRole: 'requester', closedAt, updatedAt: closedAt }] });
}

test('an outcome first seen 4 s after closure stays "Revived" for 5 s from first sight, then fades', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: revivedSnapshot(clock, 4000) }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Revived');
  await clock.advance(4000);
  assert.equal(pillText(engine), 'Revived');
  await clock.advance(1000);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  assert.equal(api.calls, 1);
  assert.equal(clock.nextDelay(), 55000, 'the 1 s tick stops once faded');
  engine.stop();
});

test('an outcome first seen more than 30 s after closure is never shown', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: revivedSnapshot(clock, 30001) }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  engine.stop();
});

test('leader and follower each show the broadcast outcome 5 s from their own first sight', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const apiA = scriptedApi([{ notModified: false, snapshot: revivedSnapshot(clock, 4000) }]);
  const apiB = scriptedApi([{ notModified: false, snapshot: snapshot() }]);
  const { tabs: [a, b] } = lockTabs({ clock, sharedStorage: storage, specs: [{ tabId: 'a', api: apiA }, { tabId: 'b', api: apiB }] });
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), true);
  assert.deepEqual([pillText(a.engine), pillText(b.engine)], ['Revived', 'Revived']);
  await clock.advance(4000);
  assert.deepEqual([pillText(a.engine), pillText(b.engine)], ['Revived', 'Revived']);
  await clock.advance(1000);
  assert.deepEqual([pillText(a.engine), pillText(b.engine)], ['Revive me · 2 online', 'Revive me · 2 online']);
  assert.equal(apiB.calls, 0);
  a.engine.stop();
  b.engine.stop();
});
