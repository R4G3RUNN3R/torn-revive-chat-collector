const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES, canTransition, isTerminalState } = require('../../src/domain/transaction-state');

const transitions = [
  ['AVAILABLE', 'accept', 'WAITING_FOR_PAYMENT'],
  ['WAITING_FOR_PAYMENT', 'requester_cancel', 'CANCELLED_BY_REQUESTER'],
  ['WAITING_FOR_PAYMENT', 'payment_verified', 'WAITING_FOR_REVIVE'],
  ['WAITING_FOR_PAYMENT', 'deadline', 'PAYMENT_RECONCILING'],
  ['PAYMENT_RECONCILING', 'payment_verified', 'WAITING_FOR_REVIVE'],
  ['PAYMENT_RECONCILING', 'payment_expired', 'PAYMENT_EXPIRED'],
  ['PAYMENT_RECONCILING', 'late_payment', 'REFUND_REQUIRED'],
  ['WAITING_FOR_REVIVE', 'revive_success', 'COMPLETED'],
  ['WAITING_FOR_REVIVE', 'revive_failed', 'FAILED_ATTEMPT_CHOICE'],
  ['WAITING_FOR_REVIVE', 'third_party_revive', 'REFUND_REQUIRED'],
  ['WAITING_FOR_REVIVE', 'requester_exit', 'CLOSED_REQUESTER_EXIT'],
  ['WAITING_FOR_REVIVE', 'natural_expiry', 'CLOSED_NATURAL_EXPIRY'],
  ['WAITING_FOR_REVIVE', 'no_attempt', 'REPORTABLE_NO_ATTEMPT'],
  ['FAILED_ATTEMPT_CHOICE', 'retry_requested', 'RETRY_OFFERED'],
  ['FAILED_ATTEMPT_CHOICE', 'refund_requested', 'REFUND_REQUIRED'],
  ['RETRY_OFFERED', 'retry_accepted', 'WAITING_FOR_REVIVE'],
  ['RETRY_OFFERED', 'retry_declined', 'REFUND_REQUIRED'],
  ['RETRY_OFFERED', 'retry_timeout', 'REFUND_REQUIRED'],
  ['REFUND_REQUIRED', 'refund_verified', 'REFUNDED'],
  ['REFUND_REQUIRED', 'deadline', 'REFUND_RECONCILING'],
  ['REFUND_RECONCILING', 'refund_verified', 'REFUNDED'],
  ['REFUND_RECONCILING', 'missing_refund', 'REPORTABLE_MISSING_REFUND']
];

test('Stage 3 transaction transitions are explicit and deterministic', () => {
  for (const [from, event, to] of transitions) {
    assert.equal(STATES[from], from);
    assert.equal(STATES[to], to);
    assert.equal(canTransition(from, event), to, `${from} --${event}--> ${to}`);
  }
});

test('late payment uses normalized REFUND_REQUIRED instead of a separate permanent state', () => {
  assert.equal(STATES.REFUND_REQUIRED_LATE_PAYMENT, undefined);
  assert.equal(canTransition('PAYMENT_RECONCILING', 'late_payment'), 'REFUND_REQUIRED');
});

test('requester cancellation is only a pre-payment event', () => {
  assert.equal(canTransition('WAITING_FOR_PAYMENT', 'requester_cancel'), 'CANCELLED_BY_REQUESTER');
  assert.equal(canTransition('PAYMENT_RECONCILING', 'requester_cancel'), null);
  assert.equal(canTransition('WAITING_FOR_REVIVE', 'requester_cancel'), null);
});

test('terminal assignment states are identified explicitly', () => {
  for (const state of [
    'PAYMENT_EXPIRED','COMPLETED','REFUNDED','CANCELLED_BY_REQUESTER',
    'CLOSED_REQUESTER_EXIT','CLOSED_NATURAL_EXPIRY','REPORTABLE_NO_ATTEMPT','REPORTABLE_MISSING_REFUND'
  ]) assert.equal(isTerminalState(state), true, state);
  for (const state of ['WAITING_FOR_PAYMENT','PAYMENT_RECONCILING','WAITING_FOR_REVIVE','REFUND_REQUIRED']) {
    assert.equal(isTerminalState(state), false, state);
  }
});

test('unsupported transitions return null', () => {
  assert.equal(canTransition('AVAILABLE', 'revive_success'), null);
  assert.equal(canTransition('COMPLETED', 'accept'), null);
  assert.equal(canTransition('NOT_A_STATE', 'accept'), null);
});
