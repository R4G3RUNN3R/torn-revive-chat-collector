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
  await clock.advance(DEFAULTS.electionMs);
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
  await clock.advance(DEFAULTS.electionMs);
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
  await clock.advance(DEFAULTS.electionMs);
  assert.equal(b.leader.isLeader(), true);
  const a = makeTab({ id: 'a', clock, hub });
  a.leader.start();
  await clock.advance(DEFAULTS.electionMs + 10);
  assert.deepEqual(leaders([a, b]), ['b']);
});

test('heartbeat election: hiding the leader hands off to a visible tab', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub });
  a.leader.start();
  await clock.advance(DEFAULTS.electionMs);
  b.leader.start();
  await clock.advance(DEFAULTS.electionMs + 10);
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
  await clock.advance(DEFAULTS.electionMs);
  b.leader.start();
  c.leader.start();
  await clock.advance(DEFAULTS.electionMs + 10);
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
  await clock.advance(DEFAULTS.electionMs + 10);
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
  await clock.advance(DEFAULTS.electionMs);
  b.leader.start();
  a.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['a']);
  b.setHidden(false);
  await clock.advance(DEFAULTS.electionMs + 10);
  assert.deepEqual(leaders([a, b]), ['b']);
});

test('start and stop are idempotent and stop closes channels and timers', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  a.leader.start();
  a.leader.start();
  assert.equal(hub.openCount(), 2);
  await clock.advance(DEFAULTS.electionMs);
  a.leader.stop();
  a.leader.stop();
  assert.equal(hub.openCount(), 0);
  assert.equal(clock.pending(), 0);
  assert.equal(a.leader.isLeader(), false);
  a.leader.start();
  assert.equal(hub.openCount(), 2);
  a.leader.stop();
});
