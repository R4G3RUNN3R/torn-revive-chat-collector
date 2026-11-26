const test = require('node:test');
const assert = require('node:assert/strict');
const {
  POLL_BOUNDS_MS,
  BACKOFF_MS,
  clampPollMs,
  backoffMs,
  pollDelayMs,
  createScheduler
} = require('../src/lite/scheduler');
const { createFakeTimers } = require('./helpers/fake-timers');

function setup({ hidden = false, random = () => 0.5 } = {}) {
  const clock = createFakeTimers();
  const page = { hidden };
  const scheduler = createScheduler({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    random,
    isHidden: () => page.hidden
  });
  return { clock, page, scheduler };
}

test('poll bounds and back-off constants match the spec', () => {
  assert.deepEqual(POLL_BOUNDS_MS, { min: 3000, max: 120000 });
  assert.deepEqual(BACKOFF_MS, { min: 5000, max: 120000 });
});

test('clampPollMs honours server nextPollMs within 3–120 s', () => {
  assert.equal(clampPollMs(5000), 5000);
  assert.equal(clampPollMs(1), 3000);
  assert.equal(clampPollMs(999999), 120000);
  assert.equal(clampPollMs(null), null);
  assert.equal(clampPollMs('nope'), null);
});

test('backoffMs grows 5 → 120 s and jitters ±20 %', () => {
  const mid = () => 0.5;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => backoffMs(n, mid)), [5000, 10000, 20000, 40000, 80000, 120000, 120000]);
  assert.equal(backoffMs(3, () => 0), 16000);
  assert.equal(backoffMs(3, () => 1), 24000);
  assert.equal(backoffMs(1, () => 0), 5000);
  assert.equal(backoffMs(9, () => 1), 120000);
});

test('pollDelayMs follows the cadence table', () => {
  assert.equal(pollDelayMs({ hidden: true }), null);
  assert.equal(pollDelayMs({}), 60000);
  assert.equal(pollDelayMs({ hasActive: true }), 5000);
  assert.equal(pollDelayMs({ isReviver: true }), 20000);
  assert.equal(pollDelayMs({ isReviver: true, sheetOpen: true }), 5000);
  assert.equal(pollDelayMs({ nextPollMs: 45000 }), 45000);
  assert.equal(pollDelayMs({ nextPollMs: 500 }), 3000);
  assert.equal(pollDelayMs({ nextPollMs: 900000, hasActive: true }), 120000);
  assert.equal(pollDelayMs({ isReviver: true, sheetOpen: true, nextPollMs: 20000 }), 5000);
  assert.equal(pollDelayMs({ isReviver: true, sheetOpen: true, nextPollMs: 90000 }), 90000);
});

test('one timer per tab: only the earliest due job is armed', async () => {
  const { clock, scheduler } = setup();
  const runs = [];
  scheduler.addJob('slow', { delay: () => 60000, run: () => { runs.push('slow'); } });
  scheduler.addJob('fast', { delay: () => 1000, run: () => { runs.push('fast'); } });
  scheduler.start();
  assert.equal(clock.pending(), 1);
  assert.equal(clock.nextDelay(), 1000);
  await clock.advance(3000);
  assert.deepEqual(runs, ['fast', 'fast', 'fast']);
  assert.equal(clock.pending(), 1);
  await clock.advance(57000);
  assert.equal(runs.filter(name => name === 'slow').length, 1);
  assert.equal(clock.pending(), 1);
});

test('a job whose delay is null holds no timer until rescheduled', async () => {
  const { clock, scheduler } = setup();
  const state = { delay: null };
  let runs = 0;
  scheduler.addJob('tick', { delay: () => state.delay, run: () => { runs += 1; } });
  scheduler.start();
  assert.equal(clock.pending(), 0);
  state.delay = 1000;
  scheduler.reschedule('tick');
  assert.equal(clock.pending(), 1);
  await clock.advance(1000);
  assert.equal(runs, 1);
});

test('runNow and trigger run a job immediately', async () => {
  const { clock, scheduler } = setup();
  let runs = 0;
  scheduler.addJob('poll', { delay: () => 60000, run: () => { runs += 1; }, runNow: true });
  scheduler.start();
  await clock.advance(0);
  assert.equal(runs, 1);
  scheduler.trigger('poll');
  await clock.advance(0);
  assert.equal(runs, 2);
  assert.equal(clock.nextDelay(), 60000);
});

test('zero timers while hidden; visible again re-arms and catches up', async () => {
  const { clock, page, scheduler } = setup();
  let runs = 0;
  scheduler.addJob('poll', { delay: () => 60000, run: () => { runs += 1; } });
  scheduler.start();
  await clock.advance(30000);
  page.hidden = true;
  scheduler.onVisibilityChange();
  assert.equal(clock.pending(), 0);
  await clock.advance(10 * 60000);
  assert.equal(runs, 0);
  page.hidden = false;
  scheduler.onVisibilityChange();
  assert.equal(clock.pending(), 1);
  assert.equal(clock.nextDelay(), 0);
  await clock.advance(0);
  assert.equal(runs, 1);
});

test('starting while hidden arms nothing', () => {
  const { clock, scheduler } = setup({ hidden: true });
  scheduler.addJob('poll', { delay: () => 1000, run: () => {}, runNow: true });
  scheduler.start();
  assert.equal(clock.pending(), 0);
});

test('failures back off exponentially with jitter and reset after a success', async () => {
  const { clock, scheduler } = setup();
  const outcome = { fail: true };
  let runs = 0;
  scheduler.addJob('poll', {
    delay: () => 60000,
    runNow: true,
    run: () => { runs += 1; if (outcome.fail) throw new Error('down'); }
  });
  scheduler.start();
  await clock.advance(0);
  assert.equal(scheduler.failures('poll'), 1);
  assert.equal(clock.nextDelay(), 5000);
  await clock.advance(5000);
  assert.equal(clock.nextDelay(), 10000);
  await clock.advance(10000);
  assert.equal(clock.nextDelay(), 20000);
  outcome.fail = false;
  await clock.advance(20000);
  assert.equal(runs, 4);
  assert.equal(scheduler.failures('poll'), 0);
  assert.equal(clock.nextDelay(), 60000);
});

test('rescheduling uses the last run as the base so a shorter cadence fires at once', async () => {
  const { clock, scheduler } = setup();
  const cadence = { ms: 60000 };
  let runs = 0;
  scheduler.addJob('poll', { delay: () => cadence.ms, run: () => { runs += 1; }, runNow: true });
  scheduler.start();
  await clock.advance(0);
  await clock.advance(10000);
  cadence.ms = 5000;
  scheduler.reschedule('poll');
  assert.equal(clock.nextDelay(), 0);
  await clock.advance(0);
  assert.equal(runs, 2);
});

test('a job never overlaps itself and the delay function sees the context', async () => {
  const { clock, scheduler } = setup();
  const seen = [];
  let release;
  scheduler.addJob('poll', {
    delay: ctx => { seen.push(ctx); return 1000; },
    runNow: true,
    run: () => new Promise(resolve => { release = resolve; })
  });
  scheduler.start();
  await clock.advance(0);
  scheduler.trigger('poll');
  await clock.advance(5000);
  assert.equal(clock.pending(), 0);
  release();
  await clock.flush();
  // The trigger that arrived mid-run is kept: the job runs once more, then follows its delay.
  assert.equal(clock.pending(), 1);
  assert.equal(clock.nextDelay(), 0);
  await clock.advance(0);
  release();
  await clock.flush();
  assert.equal(clock.pending(), 1);
  assert.equal(clock.nextDelay(), 1000);
  const last = seen[seen.length - 1];
  assert.equal(last.hidden, false);
  assert.equal(last.failures, 0);
  assert.equal(typeof last.now, 'number');
});

test('stop clears the timer; start is idempotent; clear forgets jobs', async () => {
  const { clock, scheduler } = setup();
  let runs = 0;
  scheduler.addJob('poll', { delay: () => 1000, run: () => { runs += 1; } });
  scheduler.start();
  scheduler.start();
  assert.equal(clock.pending(), 1);
  scheduler.stop();
  scheduler.stop();
  assert.equal(clock.pending(), 0);
  await clock.advance(5000);
  assert.equal(runs, 0);
  scheduler.start();
  assert.equal(clock.pending(), 1);
  scheduler.clear();
  assert.equal(clock.pending(), 0);
  assert.throws(() => scheduler.addJob('poll', { delay: 1, run: () => {} }), /delay and run are required/);
});

test('duplicate job names are rejected', () => {
  const { scheduler } = setup();
  scheduler.addJob('poll', { delay: () => null, run: () => {} });
  assert.throws(() => scheduler.addJob('poll', { delay: () => null, run: () => {} }), /already registered/);
});

test('a trigger while the job is running is kept and runs the job again as soon as it completes', async () => {
  const { clock, scheduler } = setup();
  let runs = 0;
  let finish;
  scheduler.addJob('poll', { delay: () => 60000, run: () => { runs += 1; return new Promise(resolve => { finish = resolve; }); }, runNow: true });
  scheduler.start();
  await clock.advance(0);
  assert.equal(runs, 1);
  scheduler.trigger('poll');
  await clock.advance(1000);
  assert.equal(runs, 1, 'never overlaps itself');
  finish();
  await clock.advance(0);
  assert.equal(runs, 2);
  finish();
  await clock.advance(0);
  assert.equal(runs, 2, 'the pending trigger is consumed once');
  assert.equal(clock.nextDelay(), 60000);
});

test('a trigger pending when the job completes while hidden waits until visible', async () => {
  const { clock, page, scheduler } = setup();
  let runs = 0;
  let finish;
  scheduler.addJob('poll', { delay: () => 60000, run: () => { runs += 1; return new Promise(resolve => { finish = resolve; }); }, runNow: true });
  scheduler.start();
  await clock.advance(0);
  scheduler.trigger('poll');
  page.hidden = true;
  scheduler.onVisibilityChange();
  finish();
  await clock.advance(2000);
  assert.equal(runs, 1);
  assert.equal(clock.pending(), 0);
  page.hidden = false;
  scheduler.onVisibilityChange();
  assert.equal(clock.nextDelay(), 0);
  await clock.advance(0);
  assert.equal(runs, 2);
});

test('a failing job whose delay turns null arms no back-off timer', async () => {
  const { clock, scheduler } = setup();
  const gate = { open: true };
  scheduler.addJob('poll', { delay: () => (gate.open ? 60000 : null), runNow: true, run: () => { gate.open = false; throw new Error('down'); } });
  scheduler.start();
  await clock.advance(0);
  assert.equal(scheduler.failures('poll'), 1);
  assert.equal(clock.pending(), 0, 'no stray no-op back-off timer');
  gate.open = true;
  scheduler.reschedule('poll');
  assert.equal(clock.nextDelay(), 5000, 'the back-off still applies once the job is due again');
});
