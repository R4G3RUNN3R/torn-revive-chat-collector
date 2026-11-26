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
    reset() { api.resets += 1; },
    async getState() {
      api.calls += 1;
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next() : next;
    }
  };
  return api;
}

function makeEngine({ clock, api, session = { signedIn: true, tornId: 1001 }, storage = memoryStorage(), window = createFakeWindow(), document = createFakeDocument(), tabId = 'tab', headerSelectors = ['#rr-none'], onRender = null }) {
  const holder = { session };
  const engine = createLiteEngine({ api, window, document, storage, clock, tabId, headerSelectors, getSession: () => holder.session, onRender });
  return { engine, document, window, storage, holder };
}

const pillText = engine => engine.viewModel() && engine.viewModel().text;
const authError = () => new DirectApiClientError('AUTH_REQUIRED', { status: 401, retryable: false });

test('signed out: never polls, never paints the cache, shows "Set up revives" and holds no timer', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage({ [SNAPSHOT_KEY]: { stateVersion: '0123456789abcdef', fetchedAt: clock.now() - 1000, data: snapshot({ revivers: { online: 9 } }) } });
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, storage, session: { signedIn: false, tornId: null } });
  engine.start();
  await clock.advance(120000);
  assert.equal(api.calls, 0);
  assert.equal(pillText(engine), 'Set up revives');
  assert.equal(engine.viewModel().offline, false);
  assert.equal(clock.pending(), 0);
  engine.stop();
});

test('AUTH_REQUIRED shows "Sign in again" (not Offline), clears the cache and stops polling without back-off', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }, authError()]);
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  assert.ok(storage.values[SNAPSHOT_KEY]);
  await clock.advance(60000);
  assert.equal(api.calls, 2);
  assert.equal(pillText(engine), 'Sign in again');
  assert.equal(engine.viewModel().offline, false);
  assert.equal(storage.values[SNAPSHOT_KEY], null);
  assert.equal(api.resets, 1);
  assert.equal(clock.pending(), 0);
  await clock.advance(600000);
  assert.equal(api.calls, 2);
  engine.stop();
});

test('resetSession after re-authentication polls again at once with a clean client', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([authError(), { notModified: false, snapshot: snapshot({ revivers: { online: 5 } }) }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Sign in again');
  engine.resetSession();
  await clock.advance(0);
  assert.equal(api.calls, 2);
  assert.equal(api.resets, 2);
  assert.equal(pillText(engine), 'Revive me · 5 online');
  engine.stop();
});

test('resetSession on sign-out forgets the cached snapshot and goes quiet', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine, holder } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  holder.session = { signedIn: false, tornId: null };
  engine.resetSession();
  assert.equal(storage.values[SNAPSHOT_KEY], null);
  assert.equal(pillText(engine), 'Set up revives');
  await clock.advance(120000);
  assert.equal(api.calls, 1);
  engine.stop();
});

test('a cached snapshot of another Torn user is discarded at boot and never painted', async () => {
  const clock = createFakeTimers();
  const other = snapshot({ me: { tornId: 2002, name: 'Someone', roles: ['requester'], verification: null } });
  const storage = memoryStorage({ [SNAPSHOT_KEY]: { stateVersion: '0123456789abcdef', fetchedAt: clock.now() - 1000, data: other } });
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  assert.equal(pillText(engine), 'ReviveRelay');
  assert.equal(storage.values[SNAPSHOT_KEY], null);
  await clock.advance(0);
  assert.equal(api.calls, 1);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  engine.stop();
});

test('a follower ignores broadcasts carrying another Torn user\'s snapshot', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const tab = (tabId, api, session) => {
    const window = createFakeWindow({ BroadcastChannel, locks });
    window.AbortController = function AbortController() { return createAbortController(); };
    return makeEngine({ clock, api, window, tabId, session });
  };
  const leaderApi = fakeApi([{ notModified: false, snapshot: snapshot({ me: { tornId: 2002, name: 'Old', roles: ['requester'], verification: null } }) }]);
  const followerApi = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const a = tab('a', leaderApi, { signedIn: true, tornId: 2002 });
  const b = tab('b', followerApi, { signedIn: true, tornId: 1001 });
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), true);
  assert.equal(pillText(b.engine), 'ReviveRelay');
  assert.equal(b.engine.viewModel().syncing, true);
  a.engine.stop();
  b.engine.stop();
});

test('serverTime sets the snapshot clock skew so "Revived" fades on server time', async () => {
  const clock = createFakeTimers();
  const serverNow = clock.now() - 10000;
  const closedAt = new Date(serverNow - 1000).toISOString();
  const revived = { id: 'tx-1', state: 'COMPLETED', participantRole: 'requester', closedAt, updatedAt: closedAt };
  const api = fakeApi([{ notModified: false, snapshot: snapshot({ serverTime: new Date(serverNow).toISOString(), recentlyClosed: [revived] }) }]);
  const storage = memoryStorage();
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  assert.equal(storage.values[SNAPSHOT_KEY].data.clockSkewMs, -10000);
  assert.equal(pillText(engine), 'Revived');
  await clock.advance(4000);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  engine.stop();
});

test('onRender reports every render, and listener errors never break the engine', async () => {
  const clock = createFakeTimers();
  const seen = [];
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({
    clock,
    api,
    onRender: event => {
      seen.push([event.view.text, event.freshness, event.snapshot ? event.snapshot.stateVersion : null]);
      throw new Error('listener bug');
    }
  });
  engine.start();
  await clock.advance(0);
  assert.deepEqual(seen, [['ReviveRelay', 'syncing', null], ['Revive me · 2 online', 'live', '0123456789abcdef']]);
  engine.stop();
});

test('relayout moves the pill into Torn\'s header once it renders and re-reads the theme', async () => {
  const clock = createFakeTimers();
  const document = createFakeDocument();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, document, headerSelectors: ['#rr-test-header'] });
  engine.start();
  const host = document.getElementById(HOST_ID);
  assert.equal(host.getAttribute('data-rr-placement'), 'launcher');
  const slot = document.createElement('div');
  slot.setAttribute('id', 'rr-test-header');
  slot.rect.width = 300;
  document.body.appendChild(slot);
  document.body.classList.add('dark-mode');
  engine.relayout();
  assert.equal(host.parentNode, slot);
  assert.equal(host.getAttribute('data-rr-placement'), 'header');
  assert.equal(host.getAttribute('data-theme'), 'dark');
  engine.stop();
  engine.relayout();
});

// ---- cross-tab session gaps -------------------------------------------------

function tabSet({ heartbeat = false } = {}) {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = heartbeat ? null : createLockManager();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const tab = (tabId, api, session = { signedIn: true, tornId: 1001 }, storage = memoryStorage()) => {
    const window = createFakeWindow({ BroadcastChannel, locks });
    window.AbortController = function AbortController() { return createAbortController(); };
    const renders = [];
    const made = makeEngine({ clock, api, window, tabId, session, storage, onRender: event => renders.push(event) });
    return { ...made, renders, lastRender: () => renders[renders.length - 1] };
  };
  return { clock, hub, tab, firstPollMs: heartbeat ? 1000 : 0 };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

for (const heartbeat of [false, true]) {
  const mode = heartbeat ? 'heartbeat' : 'Web Locks';

  test(`${mode}: a signed-out tab that started first never leads, so a signed-in tab polls promptly`, async () => {
    const { clock, tab, firstPollMs } = tabSet({ heartbeat });
    const aApi = fakeApi([{ notModified: false, snapshot: snapshot() }]);
    const bApi = fakeApi([{ notModified: false, snapshot: snapshot() }]);
    const a = tab('a', aApi, { signedIn: false, tornId: null });
    a.engine.start();
    await clock.advance(firstPollMs);
    assert.equal(a.engine.isLeader(), false);
    const b = tab('b', bApi);
    b.engine.start();
    await clock.advance(firstPollMs);
    assert.equal(b.engine.isLeader(), true);
    assert.equal(bApi.calls, 1);
    assert.equal(pillText(b.engine), 'Revive me · 2 online');
    assert.equal(aApi.calls, 0);
    assert.equal(pillText(a.engine), 'Set up revives');
    a.engine.stop();
    b.engine.stop();
  });

  test(`${mode}: a leader that gets 401 gives up leadership and another valid tab takes over`, async () => {
    const { clock, tab, firstPollMs } = tabSet({ heartbeat });
    const aApi = fakeApi([authError()]);
    const bApi = fakeApi([{ notModified: false, snapshot: snapshot({ me: { tornId: 2002, name: 'Other', roles: ['requester'], verification: { usable: true, requester: true, reviver: false } } }) }]);
    const a = tab('a', aApi, { signedIn: true, tornId: 1001 });
    a.engine.start();
    await clock.advance(firstPollMs);
    assert.equal(aApi.calls, 1);
    assert.equal(pillText(a.engine), 'Sign in again');
    assert.equal(a.engine.isLeader(), false);
    const b = tab('b', bApi, { signedIn: true, tornId: 2002 });
    b.engine.start();
    await clock.advance(firstPollMs);
    assert.equal(b.engine.isLeader(), true);
    assert.equal(bApi.calls, 1);
    assert.equal(pillText(b.engine), 'Revive me · 2 online');
    await clock.advance(120000);
    assert.equal(aApi.calls, 1);
    a.engine.stop();
    b.engine.stop();
  });

  test(`${mode}: a follower that re-authenticated is not told "Sign in again" by the old leader's late 401 and takes over`, async () => {
    const { clock, tab, firstPollMs } = tabSet({ heartbeat });
    const inFlight = deferred();
    const aApi = fakeApi([() => inFlight.promise]);
    const bApi = fakeApi([{ notModified: false, snapshot: snapshot({ revivers: { online: 7 } }) }]);
    const a = tab('a', aApi);
    const b = tab('b', bApi);
    a.engine.start();
    await clock.advance(firstPollMs);
    b.engine.start();
    await clock.advance(firstPollMs);
    assert.equal(a.engine.isLeader(), true);
    assert.equal(aApi.calls, 1);
    await clock.advance(1000);
    b.engine.resetSession();
    await clock.advance(0);
    inFlight.reject(authError());
    await clock.advance(firstPollMs);
    assert.ok(a.renders.some(event => event.freshness === 'expired'));
    assert.ok(!b.renders.some(event => event.freshness === 'expired'));
    assert.equal(b.engine.isLeader(), true);
    assert.equal(bApi.calls, 1);
    assert.equal(pillText(b.engine), 'Revive me · 7 online');
    // B's live state shows A (same user) that the session works again: A follows, never polls again.
    assert.equal(pillText(a.engine), 'Revive me · 7 online');
    assert.equal(aApi.calls, 1);
    a.engine.stop();
    b.engine.stop();
  });
}

test('a follower of the same user shows "Sign in again" with no snapshot when the leader gets 401, and never polls with the dead session', async () => {
  const { clock, hub, tab } = tabSet();
  const aApi = fakeApi([{ notModified: false, snapshot: snapshot() }, authError()]);
  const bApi = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const a = tab('a', aApi);
  const b = tab('b', bApi);
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(pillText(b.engine), 'Revive me · 2 online');
  await clock.advance(60000);
  assert.equal(pillText(a.engine), 'Sign in again');
  assert.equal(pillText(b.engine), 'Sign in again');
  assert.equal(b.lastRender().snapshot, null);
  assert.equal(b.lastRender().freshness, 'expired');
  assert.equal(b.engine.isLeader(), false);
  const states = hub.log.filter(entry => entry.data.type === 'state');
  assert.ok(states.length >= 2);
  for (const entry of states) assert.equal(entry.data.payload.tornId, 1001);
  // A later hand-off must not reach the follower: it knows the session is dead.
  a.engine.stop();
  await clock.advance(120000);
  assert.equal(bApi.calls, 0);
  assert.equal(b.engine.isLeader(), false);
  assert.equal(pillText(b.engine), 'Sign in again');
  b.engine.stop();
});

test('a follower of another Torn user ignores an expired broadcast', async () => {
  const { clock, tab } = tabSet();
  const aApi = fakeApi([authError()]);
  const bApi = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const a = tab('a', aApi, { signedIn: true, tornId: 2002 });
  const b = tab('b', bApi, { signedIn: true, tornId: 1001 });
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(pillText(a.engine), 'Sign in again');
  assert.equal(pillText(b.engine), 'Revive me · 2 online');
  assert.equal(b.engine.isLeader(), true);
  a.engine.stop();
  b.engine.stop();
});

test('a signed-out tab re-reads the session when it becomes visible and starts once signed in', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine, holder, document } = makeEngine({ clock, api, session: { signedIn: false, tornId: null } });
  engine.start();
  await clock.advance(60000);
  assert.equal(api.calls, 0);
  holder.session = { signedIn: true, tornId: 1001 };
  await clock.advance(60000);
  assert.equal(api.calls, 0);
  document.setVisibility('hidden');
  document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(api.resets, 1);
  assert.equal(api.calls, 1);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  engine.stop();
});

test('a gated tab re-reads the session on a broadcast and follows the leader once signed in', async () => {
  const { clock, tab } = tabSet();
  const aApi = fakeApi([{ notModified: false, snapshot: snapshot({ revivers: { online: 4 } }) }]);
  const bApi = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const a = tab('a', aApi);
  const b = tab('b', bApi, { signedIn: false, tornId: null });
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(pillText(b.engine), 'Set up revives');
  b.holder.session = { signedIn: true, tornId: 1001 };
  await clock.advance(60000);
  assert.equal(aApi.calls, 2);
  assert.equal(bApi.calls, 0);
  assert.equal(bApi.resets, 1);
  assert.equal(b.engine.isLeader(), false);
  assert.equal(pillText(b.engine), 'Revive me · 4 online');
  a.engine.stop();
  b.engine.stop();
});

test('an expired tab recovers when another tab of the same user broadcasts live state', async () => {
  const { clock, tab } = tabSet();
  const aApi = fakeApi([authError()]);
  const a = tab('a', aApi);
  a.engine.start();
  await clock.advance(0);
  assert.equal(pillText(a.engine), 'Sign in again');
  const cApi = fakeApi([{ notModified: false, snapshot: snapshot({ revivers: { online: 3 } }) }]);
  const c = tab('c', cApi);
  c.engine.start();
  await clock.advance(0);
  assert.equal(c.engine.isLeader(), true);
  assert.equal(cApi.calls, 1);
  assert.equal(pillText(a.engine), 'Revive me · 3 online');
  assert.equal(a.engine.isLeader(), false);
  assert.equal(aApi.calls, 1);
  a.engine.stop();
  c.engine.stop();
});

test('a leader without a snapshot still answers a state request with its freshness', async () => {
  const { clock, tab } = tabSet();
  const aApi = fakeApi([new Error('network down')]);
  const a = tab('a', aApi);
  a.engine.start();
  await clock.advance(0);
  assert.equal(a.engine.viewModel().offline, true);
  const b = tab('b', fakeApi([{ notModified: false, snapshot: snapshot() }]));
  b.engine.start();
  await clock.advance(0);
  assert.equal(b.engine.isLeader(), false);
  assert.equal(b.lastRender().freshness, 'offline');
  assert.equal(b.engine.viewModel().offline, true);
  a.engine.stop();
  b.engine.stop();
});

test('stop() from an onRender listener on the first render leaves no running actor', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const document = createFakeDocument();
  const ref = {};
  const { engine } = makeEngine({ clock, api, document, onRender: () => ref.engine.stop() });
  ref.engine = engine;
  engine.start();
  assert.equal(engine.isStarted(), false);
  await clock.advance(120000);
  assert.equal(api.calls, 0);
  assert.equal(clock.pending(), 0);
  assert.equal(document.listenerCount('visibilitychange'), 0);
  assert.equal(document.getElementById(HOST_ID), null);
});

test('resetSession() from an onRender listener on the first render leaves exactly one actor', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const document = createFakeDocument();
  const ref = { done: false };
  const { engine } = makeEngine({
    clock,
    api,
    document,
    onRender: () => {
      if (ref.done) return;
      ref.done = true;
      ref.engine.resetSession();
    }
  });
  ref.engine = engine;
  engine.start();
  await clock.advance(0);
  assert.equal(engine.isStarted(), true);
  assert.equal(api.calls, 1);
  assert.equal(document.listenerCount('visibilitychange'), 1);
  engine.stop();
  await clock.advance(120000);
  assert.equal(api.calls, 1);
  assert.equal(clock.pending(), 0);
  assert.equal(document.listenerCount('visibilitychange'), 0);
});

test('clock skew is measured against the midpoint of request and response', async () => {
  const clock = createFakeTimers();
  const requestStart = clock.now();
  // Responds 4 s after the request: midpoint = start + 2 s; server is 500 ms ahead of it.
  const serverTime = new Date(requestStart + 2000 + 500).toISOString();
  const api = fakeApi([() => new Promise(resolve => clock.setTimeout(() => resolve({ notModified: false, snapshot: snapshot({ serverTime }) }), 4000))]);
  const storage = memoryStorage();
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(4000);
  assert.equal(api.calls, 1);
  assert.equal(storage.values[SNAPSHOT_KEY].data.clockSkewMs, 500);
  engine.stop();
});

// ---- a leader whose session ends or changes ---------------------------------

const snapshotFor = (tornId, overrides = {}) => snapshot({ me: { tornId, name: `User ${tornId}`, roles: ['requester'], verification: { usable: true, requester: true, reviver: false } }, ...overrides });
const setSession = (tabs, value) => tabs.forEach(item => { item.holder.session = value; });

test('a leader whose shared session is signed out steps out within one cadence and shows the signed-out view', async () => {
  const { clock, tab } = tabSet();
  const aApi = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const bApi = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const a = tab('a', aApi);
  const b = tab('b', bApi);
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), true);
  assert.equal(pillText(b.engine), 'Revive me · 2 online');
  setSession([a, b], { signedIn: false, tornId: null });
  b.engine.resetSession();
  await clock.advance(60000);
  assert.equal(a.engine.isLeader(), false);
  assert.equal(pillText(a.engine), 'Set up revives');
  assert.notEqual(a.lastRender().freshness, 'live');
  assert.equal(pillText(b.engine), 'Set up revives');
  assert.equal(aApi.calls, 1);
  await clock.advance(120000);
  assert.equal(aApi.calls, 1);
  assert.equal(bApi.calls, 0);
  a.engine.stop();
  b.engine.stop();
});

test('a leader whose session turns signed out with no tab resetting still steps out at its next poll', async () => {
  const { clock, tab } = tabSet();
  const aApi = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const a = tab('a', aApi);
  a.engine.start();
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), true);
  a.holder.session = { signedIn: false, tornId: null };
  await clock.advance(60000);
  assert.equal(a.engine.isLeader(), false);
  assert.equal(pillText(a.engine), 'Set up revives');
  assert.equal(aApi.calls, 1);
  a.engine.stop();
});

test('after a user switch the old leader resets and the new session shows its own state without waiting a cadence', async () => {
  const { clock, tab } = tabSet();
  const aApi = fakeApi([{ notModified: false, snapshot: snapshotFor(1001) }, { notModified: false, snapshot: snapshotFor(2002, { revivers: { online: 8 } }) }]);
  const bApi = fakeApi([{ notModified: false, snapshot: snapshotFor(2002, { revivers: { online: 8 } }) }]);
  const a = tab('a', aApi);
  const b = tab('b', bApi);
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(pillText(b.engine), 'Revive me · 2 online');
  setSession([a, b], { signedIn: true, tornId: 2002 });
  b.engine.resetSession();
  await clock.advance(0);
  // A was told by B's state request (or its next poll) and reset: nothing of user 1001 is served.
  assert.ok(aApi.resets >= 1);
  await clock.advance(1000);
  assert.equal(pillText(b.engine), 'Revive me · 8 online');
  assert.ok(!b.renders.slice(-1).some(event => event.snapshot && event.snapshot.me.tornId === 1001));
  a.engine.stop();
  b.engine.stop();
});

test('a leader tags its broadcast with the snapshot owner, not a session read that changed in flight', async () => {
  const { clock, hub, tab } = tabSet();
  const inFlight = deferred();
  const a = tab('a', fakeApi([() => inFlight.promise]));
  const spy = hub.createChannel('rr-state');
  const tags = [];
  spy.addEventListener('message', event => {
    if (event.data && event.data.type === 'state' && event.data.payload.snapshot) tags.push(event.data.payload.tornId);
  });
  a.engine.start();
  await clock.advance(0);
  a.holder.session = { signedIn: true, tornId: 2002 };
  inFlight.resolve({ notModified: false, snapshot: snapshotFor(1001) });
  await clock.advance(0);
  assert.deepEqual(tags, [1001]);
  a.engine.stop();
});

test('a broadcast-triggered reset keeps a shared cache whose owner already matches the new session', async () => {
  const { clock, tab } = tabSet();
  const storage = memoryStorage();
  const a = tab('a', fakeApi([{ notModified: false, snapshot: snapshotFor(2002) }]), { signedIn: true, tornId: 2002 }, storage);
  const b = tab('b', fakeApi([{ notModified: false, snapshot: snapshotFor(2002) }]), { signedIn: true, tornId: 1001 }, storage);
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), true);
  assert.ok(storage.values[SNAPSHOT_KEY]);
  b.holder.session = { signedIn: true, tornId: 2002 };
  await clock.advance(60000);
  assert.equal(b.engine.isLeader(), false);
  assert.ok(b.engine.isStarted());
  assert.ok(storage.values[SNAPSHOT_KEY]);
  assert.equal(storage.values[SNAPSHOT_KEY].data.me.tornId, 2002);
  assert.equal(pillText(b.engine), 'Revive me · 2 online');
  a.engine.stop();
  b.engine.stop();
});
