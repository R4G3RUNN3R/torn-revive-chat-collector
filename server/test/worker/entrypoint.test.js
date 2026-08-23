const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../src/worker.js');

function loadWorker() {
  assert.ok(fs.existsSync(modulePath), 'server/src/worker.js must exist');
  return require(modulePath);
}

test('worker registers the five planned Stage 1 job types', () => {
  const { REGISTERED_JOB_TYPES } = loadWorker();
  assert.deepEqual(REGISTERED_JOB_TYPES, [
    'payment.verify',
    'revive.verify',
    'refund.verify',
    'subscription.scan',
    'sheets.mirror'
  ]);
  assert.equal(Object.isFrozen(REGISTERED_JOB_TYPES), true);
});

test('placeholder verification handlers fail terminally until their stage implements them', async () => {
  const { REGISTERED_JOB_TYPES, createPendingHandlers } = loadWorker();
  const handlers = createPendingHandlers(REGISTERED_JOB_TYPES);

  for (const type of REGISTERED_JOB_TYPES) {
    await assert.rejects(
      () => handlers[type]({ id: 'job-id', type, payload: {} }),
      (error) => {
        assert.equal(error.code, 'HANDLER_NOT_IMPLEMENTED');
        assert.equal(error.retryable, false);
        assert.match(error.message, new RegExp(type.replace('.', '\\.')));
        return true;
      }
    );
  }
});
