(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const POLL_BOUNDS_MS = Object.freeze({ min: 3000, max: 120000 });
  const BACKOFF_MS = Object.freeze({ min: 5000, max: 120000 });
  const CADENCE_MS = Object.freeze({ IDLE: 60000, ACTIVE: 5000, REVIVER_SHEET_OPEN: 5000, REVIVER: 20000, TICK: 1000 });
  const JITTER_RATIO = 0.2;

  function clampPollMs(value) {
    const ms = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(ms)) return null;
    return Math.min(POLL_BOUNDS_MS.max, Math.max(POLL_BOUNDS_MS.min, Math.round(ms)));
  }

  function backoffMs(failures, random = Math.random) {
    const count = Math.max(1, Math.floor(Number(failures) || 1));
    const base = Math.min(BACKOFF_MS.max, BACKOFF_MS.min * Math.pow(2, count - 1));
    const factor = 1 - JITTER_RATIO + 2 * JITTER_RATIO * Number(random());
    return Math.min(BACKOFF_MS.max, Math.max(BACKOFF_MS.min, Math.round(base * factor)));
  }

  function pollDelayMs({ hidden = false, nextPollMs = null, hasActive = false, isReviver = false, sheetOpen = false } = {}) {
    if (hidden) return null;
    let table = CADENCE_MS.IDLE;
    if (hasActive) table = CADENCE_MS.ACTIVE;
    else if (isReviver && sheetOpen) table = CADENCE_MS.REVIVER_SHEET_OPEN;
    else if (isReviver) table = CADENCE_MS.REVIVER;
    const server = clampPollMs(nextPollMs);
    if (server === null) return table;
    if (isReviver && sheetOpen && !hasActive && server <= CADENCE_MS.REVIVER) return Math.min(server, CADENCE_MS.REVIVER_SHEET_OPEN);
    return server;
  }

  function createScheduler({ setTimeout: setTimer, clearTimeout: clearTimer, now, random = Math.random, isHidden = () => false } = {}) {
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') throw new Error('timer functions are required');
    if (typeof now !== 'function') throw new Error('now is required');

    const jobs = new Map();
    let timer = null;
    let started = false;

    function context(job) {
      return Object.freeze({ now: now(), hidden: Boolean(isHidden()), failures: job.failures, lastRunAt: job.lastRunAt });
    }

    function computeDueAt(job) {
      const base = job.lastRunAt === null ? job.addedAt : job.lastRunAt;
      const delay = job.delay(context(job));
      if (delay === null || delay === undefined || !Number.isFinite(Number(delay))) return null;
      return base + (job.failures > 0 ? job.backoff : Math.max(0, Number(delay)));
    }

    function nextDueAt(job) {
      if (job.pendingTrigger) {
        job.pendingTrigger = false;
        job.failures = 0;
        job.backoff = 0;
        return now();
      }
      return computeDueAt(job);
    }

    function disarm() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    }

    function arm() {
      disarm();
      if (!started || isHidden()) return;
      let earliest = null;
      for (const job of jobs.values()) {
        if (job.running || job.dueAt === null) continue;
        if (earliest === null || job.dueAt < earliest) earliest = job.dueAt;
      }
      if (earliest === null) return;
      timer = setTimer(fire, Math.max(0, earliest - now()));
    }

    function fire() {
      timer = null;
      if (!started || isHidden()) return;
      const at = now();
      for (const job of jobs.values()) {
        if (!job.running && job.dueAt !== null && job.dueAt <= at) runJob(job);
      }
      arm();
    }

    function runJob(job) {
      job.running = true;
      job.dueAt = null;
      const generation = job.generation;
      Promise.resolve()
        .then(() => job.run(context(job)))
        .then(() => {
          job.failures = 0;
          job.backoff = 0;
        }, () => {
          job.failures += 1;
          job.backoff = backoffMs(job.failures, random);
        })
        .then(() => {
          if (jobs.get(job.name) !== job || job.generation !== generation) return;
          job.running = false;
          job.lastRunAt = now();
          if (!isHidden()) job.dueAt = nextDueAt(job);
          arm();
        });
    }

    function addJob(name, { delay, run, runNow = false } = {}) {
      if (typeof delay !== 'function' || typeof run !== 'function') throw new Error('delay and run are required');
      if (jobs.has(name)) throw new Error(`job already registered: ${name}`);
      const job = { name, delay, run, dueAt: null, addedAt: now(), lastRunAt: null, failures: 0, backoff: 0, running: false, pendingTrigger: false, generation: 0 };
      jobs.set(name, job);
      if (!isHidden()) job.dueAt = runNow ? now() : computeDueAt(job);
      arm();
    }

    function removeJob(name) {
      const job = jobs.get(name);
      if (!job) return;
      job.generation += 1;
      jobs.delete(name);
      arm();
    }

    function reschedule(name) {
      const targets = name === undefined ? [...jobs.values()] : [jobs.get(name)].filter(Boolean);
      for (const job of targets) {
        if (job.running) continue;
        job.dueAt = isHidden() ? null : nextDueAt(job);
      }
      arm();
    }

    function trigger(name) {
      const job = jobs.get(name);
      if (!job) return;
      if (job.running) {
        job.pendingTrigger = true;
        return;
      }
      job.failures = 0;
      job.backoff = 0;
      job.dueAt = isHidden() ? null : now();
      arm();
    }

    function onVisibilityChange() {
      if (isHidden()) {
        for (const job of jobs.values()) if (!job.running) job.dueAt = null;
        disarm();
        return;
      }
      reschedule();
    }

    function start() {
      if (started) return;
      started = true;
      if (!isHidden()) {
        for (const job of jobs.values()) {
          if (!job.running && job.dueAt === null) job.dueAt = nextDueAt(job);
        }
      }
      arm();
    }

    function stop() {
      started = false;
      disarm();
    }

    function clear() {
      stop();
      for (const job of jobs.values()) job.generation += 1;
      jobs.clear();
    }

    return Object.freeze({
      addJob,
      removeJob,
      reschedule,
      trigger,
      onVisibilityChange,
      start,
      stop,
      clear,
      pendingTimers: () => (timer === null ? 0 : 1),
      dueAt: name => (jobs.has(name) ? jobs.get(name).dueAt : null),
      failures: name => (jobs.has(name) ? jobs.get(name).failures : 0)
    });
  }

  return Object.freeze({
    POLL_BOUNDS_MS,
    BACKOFF_MS,
    CADENCE_MS,
    clampPollMs,
    backoffMs,
    pollDelayMs,
    createScheduler
  });
});
