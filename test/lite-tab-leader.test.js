const test = require('node:test');
const assert = require('node:assert/strict');
const { createTabLeader, DEFAULTS, LOCK_NAME } = require('../src/lite/tab-leader');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createChannelHub, createLockManager, createAbortController } = require('./helpers/fake-tabs');

function makeTab({ id, clock, hub = null, locks = null, hidden = false }) {
  const page = { hidden };
  const changes = [];
  const snapshots = [];
  const channels = [];
  const leader = createTabLeader({
    tabId: id,
    locks,
    createChannel: hub ? name => { const channel = hub.createChannel(name); channels.push(channel); return channel; } : null,
    createAbortController,
    isHidden: () => page.hidden,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onChange: value => changes.push(value),
    onSnapshot: payload => snapshots.push(payload)
  });
  return {
    leader,
    page,
    changes,
    snapshots,
    setHidden(value) {
      page.hidden = value;
      leader.onVisibilityChange();
    },
    crash() {
      // The tab disappears without resigning: its channels die, nothing more is sent.
      channels.forEach(channel => channel.close());
    }
  };
}

const ELECT = DEFAULTS.electionMs + 200; // election delay plus the maximum id stagger
const leaders = tabs => tabs.filter(tab => tab.leader.isLeader()).map(tab => tab.leader.tabId());

test('handoff budget: crash detection plus election stays within 5 s', () => {
  assert.ok(DEFAULTS.leaderTimeoutMs + DEFAULTS.electionMs <= 5000);
  assert.equal(LOCK_NAME, 'rr-leader');
});

test('no BroadcastChannel (TornPDA single WebView): always leader, broadcast is a no-op', async () => {
  const clock = createFakeTimers();
  const tab = makeTab({ id: 'pda', clock });
  tab.leader.start();
  assert.equal(tab.leader.mode(), 'solo');
  assert.equal(tab.leader.isLeader(), true);
  assert.deepEqual(tab.changes, [true]);
  tab.setHidden(true);
  assert.equal(tab.leader.isLeader(), true);
  assert.equal(tab.leader.broadcast({ x: 1 }), false);
  assert.equal(clock.pending(), 0);
});

test('a channel factory that throws falls back to solo leadership', () => {
  const clock = createFakeTimers();
  const leader = createTabLeader({ tabId: 'x', createChannel: () => { throw new Error('nope'); }, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  leader.start();
  assert.equal(leader.mode(), 'solo');
  assert.equal(leader.isLeader(), true);
});

test('Web Locks: exactly one of three visible tabs leads; followers receive rr-state', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  const tabs = ['a', 'b', 'c'].map(id => makeTab({ id, clock, hub, locks }));
  tabs.forEach(tab => tab.leader.start());
  await clock.flush();
  assert.equal(tabs[0].leader.mode(), 'locks');
  assert.deepEqual(leaders(tabs), ['a']);
  assert.equal(tabs[0].leader.broadcast({ stateVersion: '1' }), true);
  assert.equal(tabs[1].leader.broadcast({ stateVersion: 'x' }), false);
  await clock.flush();
  assert.deepEqual(tabs[1].snapshots, [{ stateVersion: '1' }]);
  assert.deepEqual(tabs[2].snapshots, [{ stateVersion: '1' }]);
  assert.deepEqual(tabs[0].snapshots, []);
  assert.equal(clock.pending(), 0);
});

test('Web Locks: a hidden leader hands off to a visible tab', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  const a = makeTab({ id: 'a', clock, hub, locks });
  const b = makeTab({ id: 'b', clock, hub, locks });
  a.leader.start();
  await clock.flush();
  b.leader.start();
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['a']);
  a.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['b']);
  assert.deepEqual(a.changes, [true, false]);
});

test('Web Locks: with every tab hidden the leader keeps the lock and hidden followers withdraw', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  const a = makeTab({ id: 'a', clock, hub, locks });
  const b = makeTab({ id: 'b', clock, hub, locks });
  a.leader.start();
  b.leader.start();
  await clock.flush();
  b.setHidden(true);
  await clock.flush();
  assert.equal(locks.queued(LOCK_NAME), 0);
  a.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['a']);
  b.setHidden(false);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['b']);
});

test('Web Locks: a tab opened hidden does not queue; stopping the leader promotes the next visible tab', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  const a = makeTab({ id: 'a', clock, hub, locks });
  const hiddenTab = makeTab({ id: 'h', clock, hub, locks, hidden: true });
  const c = makeTab({ id: 'c', clock, hub, locks });
  a.leader.start();
  hiddenTab.leader.start();
  c.leader.start();
  await clock.flush();
  assert.equal(locks.queued(LOCK_NAME), 1);
  a.leader.stop();
  await clock.flush();
  assert.deepEqual(leaders([a, hiddenTab, c]), ['c']);
  assert.equal(hub.openCount(), 4);
});

test('heartbeat election: exactly one leader among three visible tabs started together', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const tabs = ['c', 'a', 'b'].map(id => makeTab({ id, clock, hub }));
  tabs.forEach(tab => tab.leader.start());
  assert.equal(tabs[0].leader.mode(), 'heartbeat');
  await clock.advance(ELECT);
  await clock.advance(DEFAULTS.heartbeatMs * 2);
  assert.equal(leaders(tabs).length, 1);
  const first = leaders(tabs)[0];
  await clock.advance(30000);
  assert.deepEqual(leaders(tabs), [first]);
});

test('heartbeat election: when two leaders meet, the lower tab id wins', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const b = makeTab({ id: 'b', clock, hub });
  b.leader.start();
  await clock.advance(ELECT);
  assert.equal(b.leader.isLeader(), true);
  const rival = hub.createChannel('rr-leader');
  rival.postMessage({ type: 'heartbeat', hidden: false, from: 'z' });
  await clock.flush();
  assert.equal(b.leader.isLeader(), true);
  rival.postMessage({ type: 'heartbeat', hidden: false, from: 'a' });
  await clock.flush();
  assert.equal(b.leader.isLeader(), false);
  rival.close();
});

test('heartbeat election: a late tab follows the existing leader', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const b = makeTab({ id: 'b', clock, hub });
  b.leader.start();
  await clock.advance(ELECT);
  assert.equal(b.leader.isLeader(), true);
  const a = makeTab({ id: 'a', clock, hub });
  a.leader.start();
  await clock.advance(ELECT + 10);
  assert.deepEqual(leaders([a, b]), ['b']);
});

test('heartbeat election: hiding the leader hands off to a visible tab', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub });
  a.leader.start();
  await clock.advance(ELECT);
  b.leader.start();
  await clock.advance(ELECT + 10);
  assert.deepEqual(leaders([a, b]), ['a']);
  a.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['b']);
  assert.equal(a.changes.at(-1), false);
});

test('heartbeat election: closing the leader re-elects within 5 s; a crashed leader is replaced within 5 s', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub });
  const c = makeTab({ id: 'c', clock, hub });
  a.leader.start();
  await clock.advance(ELECT);
  b.leader.start();
  c.leader.start();
  await clock.advance(ELECT + 10);
  a.leader.stop();
  await clock.advance(5000);
  assert.deepEqual(leaders([b, c]), ['b']);

  b.crash();
  await clock.advance(5000);
  assert.deepEqual(leaders([c]), ['c']);
});

test('heartbeat election: hidden tabs hold zero timers', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub });
  a.leader.start();
  b.leader.start();
  await clock.advance(ELECT + 10);
  a.setHidden(true);
  b.setHidden(true);
  await clock.flush();
  assert.equal(clock.pending(), 0);
  await clock.advance(60000);
  assert.equal(clock.pending(), 0);
  assert.equal(leaders([a, b]).length, 1);
});

test('heartbeat election: a tab becoming visible claims from a hidden leader', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub, hidden: true });
  a.leader.start();
  await clock.advance(ELECT);
  b.leader.start();
  a.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['a']);
  b.setHidden(false);
  await clock.advance(ELECT + 10);
  assert.deepEqual(leaders([a, b]), ['b']);
});

test('start and stop are idempotent and stop closes channels and timers', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  a.leader.start();
  a.leader.start();
  assert.equal(hub.openCount(), 2);
  await clock.advance(ELECT);
  a.leader.stop();
  a.leader.stop();
  assert.equal(hub.openCount(), 0);
  assert.equal(clock.pending(), 0);
  assert.equal(a.leader.isLeader(), false);
  a.leader.start();
  assert.equal(hub.openCount(), 2);
  a.leader.stop();
});

test('heartbeat election: a dead hidden leader does not strand visible tabs', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub, hidden: true });
  const c = makeTab({ id: 'c', clock, hub, hidden: true });
  a.leader.start();
  await clock.advance(ELECT);
  b.leader.start();
  c.leader.start();
  a.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([a, b, c]), ['a']);
  a.crash();
  b.setHidden(false);
  c.setHidden(false);
  await clock.advance(5000);
  assert.equal(leaders([b, c]).length, 1);
  await clock.advance(30000);
  assert.equal(leaders([b, c]).length, 1);
});

test('heartbeat election: a claim answered by a live hidden leader leaves no stray claim timer', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub, hidden: true });
  a.leader.start();
  await clock.advance(ELECT);
  b.leader.start();
  a.setHidden(true);
  await clock.flush();
  b.setHidden(false);
  await clock.advance(5000);
  assert.deepEqual(leaders([a, b]), ['b']);
  b.setHidden(true);
  await clock.flush();
  a.setHidden(false);
  await clock.advance(5000);
  assert.deepEqual(leaders([a, b]), ['a']);
});

function makeDelayedTab({ id, clock, hub, state }) {
  const tab = makeTab({ id, clock, hub });
  // makeTab collects changes in an array; mirror them into the shared overlap tracker.
  const push = tab.changes.push.bind(tab.changes);
  tab.changes.push = value => {
    push(value);
    if (value) state.leading.add(id); else state.leading.delete(id);
    if (state.leading.size > 1) state.overlaps.push({ at: clock.now(), leading: [...state.leading] });
    return tab.changes.length;
  };
  return tab;
}

for (const delay of [5, 50, 200]) {
  test(`heartbeat election: three tabs starting together never overlap as leaders under ${delay} ms delivery delay`, async () => {
    const clock = createFakeTimers();
    const hub = createChannelHub({ delayMs: delay, setTimeout: clock.setTimeout });
    const state = { leading: new Set(), overlaps: [] };
    const tabs = ['c', 'a', 'b'].map(id => makeDelayedTab({ id, clock, hub, state }));
    tabs.forEach(tab => tab.leader.start());
    await clock.advance(10000);
    assert.deepEqual(state.overlaps, []);
    assert.equal(leaders(tabs).length, 1);
    await clock.advance(30000);
    assert.deepEqual(state.overlaps, []);
    assert.equal(leaders(tabs).length, 1);
  });
}

test('heartbeat election: a leader closing under delayed delivery re-elects one leader within 5 s with no overlap', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub({ delayMs: 300, setTimeout: clock.setTimeout });
  const state = { leading: new Set(), overlaps: [] };
  const tabs = ['a', 'b', 'c', 'd'].map(id => makeDelayedTab({ id, clock, hub, state }));
  tabs[0].leader.start();
  await clock.advance(ELECT + 400);
  tabs.slice(1).forEach(tab => tab.leader.start());
  await clock.advance(5000);
  // Joining under 300 ms latency can briefly show two leaders (the round trip exceeds electionMs);
  // the hand-off below is what this test measures.
  assert.deepEqual(leaders(tabs), ['a']);
  state.overlaps.length = 0;
  tabs[0].leader.stop();
  state.leading.delete('a');
  await clock.advance(5000);
  assert.deepEqual(state.overlaps, []);
  assert.equal(leaders(tabs.slice(1)).length, 1);
});

test('start() with missing timers throws before opening channels and leaves the tab stopped', () => {
  const hub = createChannelHub();
  const leader = createTabLeader({ tabId: 'x', createChannel: hub.createChannel });
  assert.throws(() => leader.start(), /timer/);
  assert.equal(hub.openCount(), 0);
  assert.equal(leader.isLeader(), false);
  assert.throws(() => leader.start(), /timer/);
  assert.equal(hub.openCount(), 0);
  leader.stop();
  assert.equal(hub.openCount(), 0);
});

test('Web Locks: the lock is released after stop() and after a hand-off', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  const a = makeTab({ id: 'a', clock, hub, locks });
  a.leader.start();
  await clock.flush();
  assert.equal(locks.held(LOCK_NAME), true);
  a.leader.stop();
  await clock.flush();
  assert.equal(locks.held(LOCK_NAME), false);
  assert.equal(locks.queued(LOCK_NAME), 0);

  const b = makeTab({ id: 'b', clock, hub, locks });
  const c = makeTab({ id: 'c', clock, hub, locks });
  b.leader.start();
  await clock.flush();
  c.leader.start();
  await clock.flush();
  assert.deepEqual(leaders([b, c]), ['b']);
  b.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([b, c]), ['c']);
  assert.equal(locks.held(LOCK_NAME), true);
  assert.equal(locks.queued(LOCK_NAME), 0);
  c.leader.stop();
  await clock.flush();
  assert.equal(locks.held(LOCK_NAME), false);
  assert.equal(locks.queued(LOCK_NAME), 0);
});

test('solo mode: stop() clears leadership and start() can run again', () => {
  const clock = createFakeTimers();
  const tab = makeTab({ id: 'pda', clock });
  tab.leader.start();
  assert.equal(tab.leader.isLeader(), true);
  tab.leader.stop();
  assert.equal(tab.leader.isLeader(), false);
  tab.leader.start();
  assert.equal(tab.leader.mode(), 'solo');
  assert.equal(tab.leader.isLeader(), true);
  tab.leader.stop();
  assert.equal(tab.leader.isLeader(), false);
  assert.equal(clock.pending(), 0);
});

test('heartbeat election: a visible leader stepping down to a hidden leader claims from it (delayed delivery)', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub({ delayMs: 50, setTimeout: clock.setTimeout });
  const b = makeTab({ id: 'b', clock, hub });
  b.leader.start();
  await clock.advance(ELECT + 100);
  assert.equal(b.leader.isLeader(), true);

  // A lower-id rival announces itself as a hidden leader: b yields, but must not be left unled.
  const rival = hub.createChannel('rr-leader');
  const received = [];
  rival.addEventListener('message', event => received.push(event.data));
  rival.postMessage({ type: 'leader-hidden', from: 'a' });
  await clock.advance(50);
  assert.equal(b.leader.isLeader(), false);
  await clock.advance(50);
  assert.ok(received.some(m => m.type === 'claim' && m.to === 'a' && m.from === 'b'), 'b claims from the hidden leader');

  rival.postMessage({ type: 'resign', to: 'b', from: 'a' });
  await clock.advance(50);
  assert.equal(b.leader.isLeader(), true);
  rival.close();
});

test('heartbeat election: stepping down to a hidden leader that never answers re-elects a visible tab', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub({ delayMs: 50, setTimeout: clock.setTimeout });
  const b = makeTab({ id: 'b', clock, hub });
  b.leader.start();
  await clock.advance(ELECT + 100);
  const rival = hub.createChannel('rr-leader');
  rival.postMessage({ type: 'heartbeat', hidden: true, from: 'a' });
  await clock.advance(50);
  assert.equal(b.leader.isLeader(), false);
  await clock.advance(5000);
  assert.equal(b.leader.isLeader(), true);
  rival.close();
});

test('a joining follower posts a state-request on rr-state and only the leader answers it', async () => {
  for (const mode of ['locks', 'heartbeat']) {
    const clock = createFakeTimers();
    const hub = createChannelHub();
    const locks = mode === 'locks' ? createLockManager() : null;
    const requests = { a: 0, b: 0 };
    const make = id => createTabLeader({
      tabId: id,
      locks,
      createChannel: hub.createChannel,
      createAbortController,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      onStateRequest: () => { requests[id] += 1; }
    });
    const a = make('a');
    a.start();
    await clock.advance(ELECT);
    assert.equal(a.isLeader(), true, mode);
    const b = make('b');
    b.start();
    await clock.advance(ELECT + 10);
    assert.equal(b.isLeader(), false, mode);
    // Every joining tab asks once; a's own request at start found no leader to answer it.
    const posted = hub.log.filter(entry => entry.name === 'rr-state' && entry.data.type === 'state-request');
    assert.deepEqual(posted.map(entry => entry.data), [{ type: 'state-request', from: 'a' }, { type: 'state-request', from: 'b' }], mode);
    assert.deepEqual(requests, { a: 1, b: 0 }, mode);
    a.stop();
    b.stop();
  }
});
