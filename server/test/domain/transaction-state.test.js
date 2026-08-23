const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES, canTransition } = require('../../src/domain/transaction-state');

const transitions = [
  ['AVAILABLE', 'accept', 'WAITING_FOR_PAYMENT'],
  ['WAITING_FOR_PAYMENT', 'deadline', 'PAYMENT_RECONCILING'],
  ['PAYMENT_RECONCILING', 'valid_payment', 'WAITING_FOR_REVIVE'],
  ['PAYMENT_RECONCILING', 'no_payment', 'AVAILABLE'],
  ['PAYMENT_RECONCILING', 'late_payment', 'REFUND_REQUIRED_LATE_PAYMENT'],
  ['WAITING_FOR_REVIVE', 'success', 'COMPLETED'],
  ['WAITING_FOR_REVIVE', 'failed', 'FAILED_ATTEMPT_CHOICE'],
  ['FAILED_ATTEMPT_CHOICE', 'retry', 'RETRY_OFFERED'],
  ['RETRY_OFFERED', 'accepted', 'WAITING_FOR_REVIVE'],
  ['RETRY_OFFERED', 'declined_or_timeout', 'REFUND_REQUIRED'],
  ['REFUND_REQUIRED', 'refunded', 'REFUNDED']
];

test('Stage 1 transaction transitions are explicit and deterministic', () => {
  for (const [from, event, to] of transitions) {
    assert.equal(STATES[from], from);
    assert.equal(STATES[to], to);
    assert.equal(canTransition(from, event), to, `${from} --${event}--> ${to}`);
  }
});

test('unsupported transaction transitions return null', () => {
  assert.equal(canTransition('AVAILABLE', 'success'), null);
  assert.equal(canTransition('COMPLETED', 'accept'), null);
  assert.equal(canTransition('NOT_A_STATE', 'accept'), null);
});
