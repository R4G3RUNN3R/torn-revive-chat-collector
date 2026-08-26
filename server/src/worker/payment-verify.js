const { matchPaymentEvidence } = require('../domain/payment-matcher');
const { STATES } = require('../domain/transaction-state');

const PAYMENT_POLL_MS = 15_000;
const PAYMENT_RECONCILE_GRACE_MS = 30_000;
const PAYMENT_RECONCILE_POLL_MS = 5_000;
const SERVICE_RETRY_MS = 15_000;
const CREDENTIAL_RETRY_MS = 60_000;

function minDate(a,b) {
  return a <= b ? a : b;
}

function createPaymentVerifyHandler({
  paymentRepository,
  transactionService,
  evidenceService,
  jobRepository,
  clock = () => new Date()
}) {
  if (!paymentRepository || typeof paymentRepository.getVerificationContext !== 'function' ||
      typeof paymentRepository.recordVerifiedPayment !== 'function') {
    throw new Error('paymentRepository is required');
  }
  if (!transactionService || typeof transactionService.transitionTransaction !== 'function') {
    throw new Error('transactionService is required');
  }
  if (!evidenceService || typeof evidenceService.getIncomingPaymentEvidence !== 'function') {
    throw new Error('evidenceService is required');
  }
  if (!jobRepository || typeof jobRepository.enqueueUniqueJob !== 'function') {
    throw new Error('jobRepository is required');
  }

  return async function paymentVerify(job) {
    const transactionId = job && (job.entityId || (job.payload && job.payload.transactionId));
    if (!transactionId) return { status:'complete' };
    let context = await paymentRepository.getVerificationContext(transactionId);
    if (!context) return { status:'complete' };
    if (![STATES.WAITING_FOR_PAYMENT, STATES.PAYMENT_RECONCILING].includes(context.state)) {
      return { status:'complete' };
    }

    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('Payment verification clock returned invalid date');

    if (context.state === STATES.WAITING_FOR_PAYMENT && now >= context.paymentDeadline) {
      const reconcileUntil = new Date(context.paymentDeadline.getTime() + PAYMENT_RECONCILE_GRACE_MS);
      const transition = await transactionService.transitionTransaction({
        transactionId,
        event:'deadline',
        actor:{type:'system'},
        details:{reconcileUntil},
        now
      });
      if (!transition.transitioned) return { status:'complete' };
      context = {
        ...context,
        state: STATES.PAYMENT_RECONCILING,
        paymentReconcileUntil: reconcileUntil
      };
    }

    let logs;
    try {
      logs = await evidenceService.getIncomingPaymentEvidence({
        reviverUserId: context.reviverUserId,
        requesterTornId: context.requesterTornId,
        method: context.method,
        from: context.acceptedAt,
        to: now
      });
      if (context.verificationHoldReason && typeof transactionService.clearVerificationHold === 'function') {
        await transactionService.clearVerificationHold({ transactionId, now });
      }
    } catch (error) {
      const code = error && error.code;
      if (['VERIFICATION_CREDENTIAL_REQUIRED','VERIFICATION_CREDENTIAL_INVALID','VERIFICATION_CREDENTIAL_INSUFFICIENT'].includes(code)) {
        if (typeof transactionService.setVerificationHold === 'function') {
          await transactionService.setVerificationHold({ transactionId, reason: code, metadata:{ phase:'payment' }, now });
        }
        return { status:'reschedule', runAt:new Date(now.getTime() + CREDENTIAL_RETRY_MS) };
      }
      if (code === 'TORN_UNAVAILABLE') {
        if (typeof transactionService.setVerificationHold === 'function') {
          await transactionService.setVerificationHold({ transactionId, reason:'TORN_UNAVAILABLE', metadata:{ phase:'payment' }, now });
        }
        return { status:'reschedule', runAt:new Date(now.getTime() + SERVICE_RETRY_MS) };
      }
      throw error;
    }

    const match = matchPaymentEvidence({
      method: context.method,
      offerAmount: context.offerAmount,
      requesterTornId: context.requesterTornId,
      acceptedAt: context.acceptedAt,
      paymentDeadline: context.paymentDeadline,
      logs
    });

    if (match.status === 'verified') {
      await paymentRepository.recordVerifiedPayment({
        transactionId,
        method:context.method,
        expectedAmount:context.offerAmount,
        verifiedAmount:match.verifiedAmount,
        evidence:match.evidence,
        verifiedAt:now
      });
      const reviveDeadline = new Date(now.getTime() + 5 * 60 * 1000);
      const transition = await transactionService.transitionTransaction({
        transactionId,
        event:'payment_verified',
        actor:{type:'system'},
        details:{ paymentVerifiedAt:now, reviveDeadline },
        now
      });
      if (transition.transitioned) {
        await jobRepository.enqueueUniqueJob({
          type:'revive.verify',
          entityId:transactionId,
          runAt:now,
          dedupeKey:`revive.verify:${transactionId}`,
          payload:{transactionId}
        });
      }
      return { status:'complete' };
    }

    if (match.status === 'late') {
      await paymentRepository.recordVerifiedPayment({
        transactionId,
        method:context.method,
        expectedAmount:context.offerAmount,
        verifiedAmount:match.verifiedAmount,
        evidence:match.evidence,
        verifiedAt:now
      });
      await transactionService.transitionTransaction({
        transactionId,
        event:'late_payment',
        actor:{type:'system'},
        details:{refundReason:'late_payment'},
        now
      });
      return { status:'complete' };
    }

    if (now < context.paymentDeadline) {
      return {
        status:'reschedule',
        runAt:minDate(new Date(now.getTime() + PAYMENT_POLL_MS), context.paymentDeadline)
      };
    }

    const reconcileUntil = context.paymentReconcileUntil || new Date(context.paymentDeadline.getTime() + PAYMENT_RECONCILE_GRACE_MS);
    if (now < reconcileUntil) {
      return {
        status:'reschedule',
        runAt:minDate(new Date(now.getTime() + PAYMENT_RECONCILE_POLL_MS), reconcileUntil)
      };
    }

    await transactionService.transitionTransaction({
      transactionId,
      event:'payment_expired',
      actor:{type:'system'},
      now
    });
    return { status:'complete' };
  };
}

module.exports = {
  PAYMENT_POLL_MS,
  PAYMENT_RECONCILE_GRACE_MS,
  createPaymentVerifyHandler
};
