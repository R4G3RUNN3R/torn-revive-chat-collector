const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../src/domain/transaction-state.js');

function loadState() {
  assert.ok(fs.existsSync(modulePath), 'server/src/domain/transaction-state.js must exist');
  return require(modulePath);
}

test('transaction state table permits only approved Stage 1 transitions', () => {
  const { STATES, canTransition } = loadState();

  const allowed = [
    [STATES.AVAILABLE, 'accept', STATES.WAITING_FOR_PAYMENT],
    [STATES.WAITING_FOR_PAYMENT, 'deadline', STATES.PAYMENT_RECONCILING],
    [STATES.PAYMENT_RECONCILING, 'valid_payment', STATES.WAITING_FOR_REVIVE],
    [STATES.PAYMENT_RECONCILING, 'no_payment', STATES.AVAILABLE],
    [STATES.PAYMENT_RECONCILING, 'late_payment', STATES.REFUND_REQUIRED_LATE_PAYMENT],
    [STATES.WAITING_FOR_REVIVE, 'success', STATES.COMPLETED],
    [STATES.WAITING_FOR_REVIVE, 'failed', STATES.FAILED_ATTEMPT_CHOICE],
    [STATES.FAILED_ATTEMPT_CHOICE, 'retry', STATES.RETRY_OFFERED],
    [STATES.FAILED_ATTEMPT_CHOICE, 'refund', STATES.REFUND_REQUIRED],
    [STATES.RETRY_OFFERED, 'accepted', STATES.WAITING_FOR_REVIVE],
    [STATES.RETRY_OFFERED, 'declined_or_timeout', STATES.REFUND_REQUIRED],
    [STATES.REFUND_REQUIRED, 'refunded', STATES.REFUNDED],
    [STATES.REFUND_REQUIRED_LATE_PAYMENT, 'refunded', STATES.REFUNDED]
  ];

  for (const [from, event, to] of allowed) {
    assert.equal(canTransition(from, event), to, `${from} --${event}--> ${to}`);
  }

  for (const [from, event] of [
    [STATES.AVAILABLE, 'success'],
    [STATES.WAITING_FOR_PAYMENT, 'success'],
    [STATES.COMPLETED, 'retry'],
    [STATES.REFUNDED, 'accept'],
    ['MADE_UP_STATE', 'accept']
  ]) {
    assert.equal(canTransition(from, event), null, `${from} must not accept ${event}`);
  }
});

test('state constants are frozen and include reporting states used by later verification', () => {
  const { STATES } = loadState();
  assert.equal(Object.isFrozen(STATES), true);
  assert.equal(STATES.REPORTABLE_NO_ATTEMPT, 'REPORTABLE_NO_ATTEMPT');
  assert.equal(STATES.REPORTABLE_NO_REFUND, 'REPORTABLE_NO_REFUND');
});
