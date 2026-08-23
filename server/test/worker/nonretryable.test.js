const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../src/worker/runner.js');

function loadRunner() {
  assert.ok(fs.existsSync(modulePath), 'server/src/worker/runner.js must exist');
  return require(modulePath);
}

test('non-retryable handler errors are recorded as terminal failures', async () => {
  const { createWorkerRunner } = loadRunner();
  const failures = [];
  const runner = createWorkerRunner({
    jobRepository: {
      async claimDueJobs() { return [{ id: 'job-4', type: 'payment.verify', payload: {} }]; },
      async markComplete() { throw new Error('not expected'); },
      async markFailed(id, workerId, errorMessage, retryAt) {
        failures.push({ id, workerId, errorMessage, retryAt });
      }
    },
    workerId: 'worker-a',
    handlers: {
      'payment.verify': async () => {
        const error = new Error('not implemented yet');
        error.retryable = false;
        throw error;
      }
    },
    sleep: async () => {}
  });

  await runner.runOnce();
  assert.equal(failures.length, 1);
  assert.equal(failures[0].retryAt, null);
  assert.match(failures[0].errorMessage, /not implemented yet/);
});
