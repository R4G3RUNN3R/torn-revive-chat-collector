const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkerRunner } = require('../../src/worker/runner');

test('worker dispatches known jobs and records unknown job types as failures', async () => {
  const completed = [];
  const failed = [];
  const handled = [];
  let claims = 0;

  const runner = createWorkerRunner({
    workerId: 'worker-test',
    jobRepository: {
      async claimDueJobs() {
        claims += 1;
        return claims === 1 ? [
          { id: 'job-1', type: 'payment.verify', payload: { value: 1 } },
          { id: 'job-2', type: 'unknown.type', payload: {} }
        ] : [];
      },
      async completeJob(jobId) {
        completed.push(jobId);
      },
      async failJob(jobId, error) {
        failed.push([jobId, error]);
      }
    },
    handlers: {
      'payment.verify': async job => {
        handled.push(job.id);
      }
    },
    sleep: async () => {},
    logger: { error() {}, info() {} }
  });

  const count = await runner.runOnce();
  assert.equal(count, 2);
  assert.deepEqual(handled, ['job-1']);
  assert.deepEqual(completed, ['job-1']);
  assert.equal(failed.length, 1);
  assert.equal(failed[0][0], 'job-2');
  assert.match(failed[0][1], /unknown job type/i);
});

test('worker records handler failures instead of silently losing jobs', async () => {
  const failed = [];
  const runner = createWorkerRunner({
    workerId: 'worker-test',
    jobRepository: {
      async claimDueJobs() {
        return [{ id: 'job-1', type: 'revive.verify', payload: {} }];
      },
      async completeJob() {
        throw new Error('must not complete failed job');
      },
      async failJob(jobId, error) {
        failed.push([jobId, error]);
      }
    },
    handlers: {
      'revive.verify': async () => {
        throw new Error('Torn unavailable');
      }
    },
    sleep: async () => {},
    logger: { error() {}, info() {} }
  });

  await runner.runOnce();
  assert.deepEqual(failed, [['job-1', 'Torn unavailable']]);
});
