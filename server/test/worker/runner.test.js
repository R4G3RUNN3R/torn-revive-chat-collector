const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../src/worker/runner.js');

function loadRunner() {
  assert.ok(fs.existsSync(modulePath), 'server/src/worker/runner.js must exist');
  return require(modulePath);
}

test('runOnce completes jobs handled by registered handlers', async () => {
  const { createWorkerRunner } = loadRunner();
  const completed = [];
  const calls = [];
  const jobRepository = {
    async claimDueJobs() {
      return [{ id: 'job-1', type: 'payment.verify', payload: { transactionId: 'tx-1' } }];
    },
    async markComplete(id, workerId) { completed.push([id, workerId]); },
    async markFailed() { throw new Error('not expected'); }
  };
  const runner = createWorkerRunner({
    jobRepository,
    workerId: 'worker-a',
    handlers: {
      'payment.verify': async (job) => calls.push(job.payload.transactionId)
    },
    sleep: async () => {}
  });

  const count = await runner.runOnce();
  assert.equal(count, 1);
  assert.deepEqual(calls, ['tx-1']);
  assert.deepEqual(completed, [['job-1', 'worker-a']]);
});

test('unknown job type is recorded as terminal failure instead of disappearing', async () => {
  const { createWorkerRunner } = loadRunner();
  const failures = [];
  const runner = createWorkerRunner({
    jobRepository: {
      async claimDueJobs() { return [{ id: 'job-2', type: 'mystery.job', payload: {} }]; },
      async markComplete() { throw new Error('not expected'); },
      async markFailed(id, workerId, errorMessage, retryAt) {
        failures.push({ id, workerId, errorMessage, retryAt });
      }
    },
    workerId: 'worker-a',
    handlers: {},
    sleep: async () => {}
  });

  await runner.runOnce();
  assert.equal(failures.length, 1);
  assert.equal(failures[0].id, 'job-2');
  assert.match(failures[0].errorMessage, /unknown job type/i);
  assert.equal(failures[0].retryAt, null);
});

test('run sleeps one second when no jobs are due and stop prevents another claim cycle', async () => {
  const { createWorkerRunner } = loadRunner();
  const sleeps = [];
  let claims = 0;
  let runner;
  const jobRepository = {
    async claimDueJobs() {
      claims += 1;
      return [];
    },
    async markComplete() {},
    async markFailed() {}
  };

  runner = createWorkerRunner({
    jobRepository,
    workerId: 'worker-a',
    handlers: {},
    sleep: async (ms) => {
      sleeps.push(ms);
      runner.stop();
    }
  });

  await runner.run();
  assert.deepEqual(sleeps, [1000]);
  assert.equal(claims, 1);
});

test('handler errors are recorded for retry rather than completing the job', async () => {
  const { createWorkerRunner } = loadRunner();
  const failures = [];
  const fixedNow = new Date('2026-08-23T18:45:00.000Z');
  const runner = createWorkerRunner({
    jobRepository: {
      async claimDueJobs() { return [{ id: 'job-3', type: 'revive.verify', payload: {} }]; },
      async markComplete() { throw new Error('not expected'); },
      async markFailed(id, workerId, errorMessage, retryAt) {
        failures.push({ id, workerId, errorMessage, retryAt });
      }
    },
    workerId: 'worker-a',
    handlers: {
      'revive.verify': async () => { throw new Error('Torn temporarily unavailable'); }
    },
    now: () => fixedNow,
    sleep: async () => {}
  });

  await runner.runOnce();
  assert.equal(failures.length, 1);
  assert.match(failures[0].errorMessage, /temporarily unavailable/);
  assert.equal(failures[0].retryAt.toISOString(), '2026-08-23T18:45:30.000Z');
});
