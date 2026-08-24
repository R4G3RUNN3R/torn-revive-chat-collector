const STATES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  WAITING_FOR_PAYMENT: 'WAITING_FOR_PAYMENT',
  PAYMENT_RECONCILING: 'PAYMENT_RECONCILING',
  WAITING_FOR_REVIVE: 'WAITING_FOR_REVIVE',
  REFUND_REQUIRED_LATE_PAYMENT: 'REFUND_REQUIRED_LATE_PAYMENT',
  COMPLETED: 'COMPLETED',
  FAILED_ATTEMPT_CHOICE: 'FAILED_ATTEMPT_CHOICE',
  RETRY_OFFERED: 'RETRY_OFFERED',
  REFUND_REQUIRED: 'REFUND_REQUIRED',
  REFUNDED: 'REFUNDED',
  CANCELLED_BY_REQUESTER: 'CANCELLED_BY_REQUESTER'
});

const TRANSITIONS = Object.freeze({
  [STATES.AVAILABLE]: Object.freeze({
    accept: STATES.WAITING_FOR_PAYMENT
  }),
  [STATES.WAITING_FOR_PAYMENT]: Object.freeze({
    requester_cancel: STATES.CANCELLED_BY_REQUESTER,
    deadline: STATES.PAYMENT_RECONCILING
  }),
  [STATES.PAYMENT_RECONCILING]: Object.freeze({
    valid_payment: STATES.WAITING_FOR_REVIVE,
    no_payment: STATES.AVAILABLE,
    late_payment: STATES.REFUND_REQUIRED_LATE_PAYMENT
  }),
  [STATES.WAITING_FOR_REVIVE]: Object.freeze({
    success: STATES.COMPLETED,
    failed: STATES.FAILED_ATTEMPT_CHOICE
  }),
  [STATES.FAILED_ATTEMPT_CHOICE]: Object.freeze({
    retry: STATES.RETRY_OFFERED
  }),
  [STATES.RETRY_OFFERED]: Object.freeze({
    accepted: STATES.WAITING_FOR_REVIVE,
    declined_or_timeout: STATES.REFUND_REQUIRED
  }),
  [STATES.REFUND_REQUIRED]: Object.freeze({
    refunded: STATES.REFUNDED
  })
});

function canTransition(from, event) {
  const transitions = TRANSITIONS[from];
  if (!transitions) return null;
  return transitions[event] || null;
}

module.exports = {
  STATES,
  canTransition
};
