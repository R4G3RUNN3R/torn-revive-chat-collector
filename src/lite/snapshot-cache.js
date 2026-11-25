(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteSnapshotCache = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SNAPSHOT_KEY = 'reviverelay_state_snapshot_v1';
  const STALE_AFTER_MS = 10 * 60 * 1000;
  const DISCARD_AFTER_MS = 24 * 60 * 60 * 1000;

  function validEntry(entry) {
    return Boolean(entry && typeof entry === 'object' && !Array.isArray(entry) &&
      Number.isFinite(entry.fetchedAt) &&
      entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data));
  }

  function createSnapshotCache({ storage, now = () => Date.now(), key = SNAPSHOT_KEY } = {}) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw new Error('storage with get/set is required');
    }

    function readEntry() {
      let entry;
      try { entry = storage.get(key, null); } catch (_) { return null; }
      return validEntry(entry) ? entry : null;
    }

    function read() {
      const entry = readEntry();
      if (!entry) return null;
      const age = Math.max(0, now() - entry.fetchedAt);
      if (age > DISCARD_AFTER_MS) {
        clear();
        return null;
      }
      return Object.freeze({
        snapshot: entry.data,
        stateVersion: typeof entry.stateVersion === 'string' ? entry.stateVersion : null,
        fetchedAt: entry.fetchedAt,
        stale: age > STALE_AFTER_MS
      });
    }

    function write(snapshot, fetchedAt = now()) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
      const at = Number(fetchedAt);
      if (!Number.isFinite(at)) return false;
      const existing = readEntry();
      if (existing && existing.fetchedAt > at) return false;
      try {
        storage.set(key, {
          stateVersion: typeof snapshot.stateVersion === 'string' ? snapshot.stateVersion : null,
          fetchedAt: at,
          data: snapshot
        });
      } catch (_) {
        return false;
      }
      return true;
    }

    function clear() {
      try { storage.set(key, null); } catch (_) { /* storage unavailable: nothing to clear */ }
    }

    return Object.freeze({ read, write, clear });
  }

  return Object.freeze({ SNAPSHOT_KEY, STALE_AFTER_MS, DISCARD_AFTER_MS, createSnapshotCache });
});
