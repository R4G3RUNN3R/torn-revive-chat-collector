'use strict';

// Deterministic clock + setTimeout for ReviveRelay Lite tests. Only what the modules use.
function createFakeTimers(startMs = Date.parse('2026-11-25T12:00:00.000Z')) {
  let current = startMs;
  let nextId = 1;
  const timers = new Map();

  function setTimeout(callback, delay = 0) {
    const id = nextId++;
    timers.set(id, { callback, at: current + Math.max(0, Number(delay) || 0) });
    return id;
  }

  function clearTimeout(id) {
    timers.delete(id);
  }

  async function flush() {
    for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve));
  }

  async function advance(ms) {
    const target = current + ms;
    await flush();
    for (;;) {
      let nextTimer = null;
      for (const [id, timer] of timers) {
        if (timer.at <= target && (nextTimer === null || timer.at < nextTimer.at || (timer.at === nextTimer.at && id < nextTimer.id))) {
          nextTimer = { id, ...timer };
        }
      }
      if (!nextTimer) break;
      current = Math.max(current, nextTimer.at);
      timers.delete(nextTimer.id);
      nextTimer.callback();
      await flush();
    }
    current = target;
    await flush();
  }

  return {
    now: () => current,
    setTimeout,
    clearTimeout,
    advance,
    flush,
    pending: () => timers.size,
    nextDelay: () => {
      let min = null;
      for (const timer of timers.values()) if (min === null || timer.at < min) min = timer.at;
      return min === null ? null : min - current;
    }
  };
}

module.exports = { createFakeTimers };
