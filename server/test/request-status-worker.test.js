const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JOB_TYPES } = require('../src/db/jobs');
const { runRequestStatusLoop, ERROR_RETRY_MS } = require('../src/request-status-worker');

test('request status loop calls the handler and sleeps until its reschedule time', async () => {
  const signal = { stop: false };
  const sleeps = [];
  let calls = 0;
  await runRequestStatusLoop({
    handler: async () => {
      calls += 1;
      return { status: 'reschedule', runAt: new Date('2026-11-25T12:00:45Z'), checked: 0, refreshed: 0 };
    },
    sleep: async ms => { sleeps.push(ms); signal.stop = true; },
    signal,
    clock: () => new Date('2026-11-25T12:00:00Z'),
    logger: { error() { throw new Error('must not log'); } }
  });
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, [45000]);
});

test('request status loop logs once and sleeps 60s when the handler throws', async () => {
  const signal = { stop: false };
  const sleeps = [];
  const errors = [];
  await runRequestStatusLoop({
    handler: async () => { throw new Error('database down'); },
    sleep: async ms => { sleeps.push(ms); signal.stop = true; },
    signal,
    clock: () => new Date('2026-11-25T12:00:00Z'),
    logger: { error(message) { errors.push(message); } }
  });
  assert.equal(ERROR_RETRY_MS, 60000);
  assert.deepEqual(sleeps, [60000]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /database down/);
});

test('request status loop stops when signal.stop is set', async () => {
  const signal = { stop: false };
  const sleeps = [];
  let calls = 0;
  await runRequestStatusLoop({
    handler: async () => {
      calls += 1;
      if (calls === 2) signal.stop = true;
      return { status: 'reschedule', runAt: new Date('2026-11-25T12:01:00Z') };
    },
    sleep: async ms => { sleeps.push(ms); },
    signal,
    clock: () => new Date('2026-11-25T12:00:00Z'),
    logger: { error() {} }
  });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [60000]);

  const stopped = { stop: true };
  await runRequestStatusLoop({ handler: async () => { throw new Error('must not run'); }, sleep: async () => {}, signal: stopped });
});

test('request status scan does not use the shared jobs queue', () => {
  assert.equal(JOB_TYPES.includes('request.status-scan'), false);
  const workerSource = fs.readFileSync(path.resolve(__dirname, '../src/worker.js'), 'utf8');
  assert.doesNotMatch(workerSource, /request-status-scan|request\.status-scan/);
  const source = fs.readFileSync(path.resolve(__dirname, '../src/request-status-worker.js'), 'utf8');
  assert.doesNotMatch(source, /createJobRepository|enqueueUniqueJob|claimDueJobs|\.\/db\/jobs/);
});

test('package.json exposes the status-worker script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts['status-worker'], 'node src/request-status-worker.js');
});
