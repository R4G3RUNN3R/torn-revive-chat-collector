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
