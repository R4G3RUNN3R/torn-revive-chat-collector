const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SNAPSHOT_KEY,
  STALE_AFTER_MS,
  DISCARD_AFTER_MS,
  createSnapshotCache
} = require('../src/lite/snapshot-cache');

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    get: (key, fallback) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback),
    set: (key, value) => { values[key] = value; }
  };
}

const T0 = Date.parse('2026-11-25T12:00:00.000Z');
const snap = version => ({ stateVersion: version, nextPollMs: 60000, me: { tornId: 1 }, activeTransactions: [] });

test('key and ages match the spec', () => {
  assert.equal(SNAPSHOT_KEY, 'reviverelay_state_snapshot_v1');
  assert.equal(STALE_AFTER_MS, 600000);
  assert.equal(DISCARD_AFTER_MS, 86400000);
});

test('write then read round-trips the snapshot with its fetchedAt', () => {
  const storage = memoryStorage();
  let now = T0;
  const cache = createSnapshotCache({ storage, now: () => now });
  assert.equal(cache.read(), null);
  assert.equal(cache.write(snap('aaaaaaaaaaaaaaaa'), T0), true);
  assert.deepEqual(storage.values[SNAPSHOT_KEY], { stateVersion: 'aaaaaaaaaaaaaaaa', fetchedAt: T0, data: snap('aaaaaaaaaaaaaaaa') });
  now = T0 + 1000;
  const entry = cache.read();
  assert.equal(entry.stateVersion, 'aaaaaaaaaaaaaaaa');
  assert.equal(entry.fetchedAt, T0);
  assert.equal(entry.stale, false);
  assert.deepEqual(entry.snapshot, snap('aaaaaaaaaaaaaaaa'));
});

test('stale after 10 minutes, discarded after 24 hours', () => {
  const storage = memoryStorage();
  let now = T0;
  const cache = createSnapshotCache({ storage, now: () => now });
  cache.write(snap('aaaaaaaaaaaaaaaa'), T0);
  now = T0 + STALE_AFTER_MS;
  assert.equal(cache.read().stale, false);
  now = T0 + STALE_AFTER_MS + 1;
  assert.equal(cache.read().stale, true);
  now = T0 + DISCARD_AFTER_MS + 1;
  assert.equal(cache.read(), null);
  assert.equal(storage.values[SNAPSHOT_KEY], null);
});

test('never replaces a snapshot with an older fetchedAt', () => {
  const storage = memoryStorage();
  const cache = createSnapshotCache({ storage, now: () => T0 });
  assert.equal(cache.write(snap('bbbbbbbbbbbbbbbb'), T0), true);
  assert.equal(cache.write(snap('aaaaaaaaaaaaaaaa'), T0 - 1), false);
  assert.equal(cache.read().stateVersion, 'bbbbbbbbbbbbbbbb');
  assert.equal(cache.write(snap('cccccccccccccccc'), T0), true);
  assert.equal(cache.read().stateVersion, 'cccccccccccccccc');
});

test('corrupt or foreign values read as empty and are overwritten', () => {
  for (const bad of ['text', 42, [], { fetchedAt: 'x', data: {} }, { fetchedAt: T0, data: null }]) {
    const storage = memoryStorage({ [SNAPSHOT_KEY]: bad });
    const cache = createSnapshotCache({ storage, now: () => T0 });
    assert.equal(cache.read(), null);
    assert.equal(cache.write(snap('aaaaaaaaaaaaaaaa'), T0), true);
  }
});

test('storage failures never throw', () => {
  const storage = { get: () => { throw new Error('boom'); }, set: () => { throw new Error('boom'); } };
  const cache = createSnapshotCache({ storage, now: () => T0 });
  assert.equal(cache.read(), null);
  assert.equal(cache.write(snap('aaaaaaaaaaaaaaaa'), T0), false);
  assert.doesNotThrow(() => cache.clear());
});

test('rejects invalid input', () => {
  assert.throws(() => createSnapshotCache({}), /storage/);
  const cache = createSnapshotCache({ storage: memoryStorage(), now: () => T0 });
  assert.equal(cache.write(null, T0), false);
  assert.equal(cache.write(snap('aaaaaaaaaaaaaaaa'), Number.NaN), false);
});
