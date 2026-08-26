const {
  REVIVE_RECONCILE_GRACE_MS,
  classifyReviveOutcome
} = require('../domain/revive-matcher');
const { STATES } = require('../domain/transaction-state');

const REVIVE_POLL_MS = 10_000;
const REVIVE_RECONCILE_POLL_MS = 5_000;
const CREDENTIAL_RETRY_MS = 60_000;
const SERVICE_RETRY_MS = 15_000;
const AMBIGUOUS_RETRY_MS = 60_000;

function minDate(a, b) {
  return a <= b ? a : b;
}

function isHospitalState(value) {
  const state = String(value || '').trim().toLowerCase();
  return state === 'hospital' || state === 'hospitalized';
}

function createReviveVerifyHandler({
  reviveAttemptRepository,
  transactionService,
  evidenceService,
  clock = () => new Date()
}) {
  if (!reviveAttemptRepository ||
      typeof reviveAttemptRepository.getVerificationContext !== 'function' ||
      typeof reviveAttemptRepository.recordAttempt !== 'function' ||
      typeof reviveAttemptRepository.recordHospitalBaseline !== 'function') {
    throw new Error('reviveAttemptRepository is required');
  }
  if (!transactionService || typeof transactionService.transitionTransaction !== 'function') {
    throw new Error('transactionService is required');
  }
  if (!evidenceService || typeof evidenceService.getReviveEvidence !== 'function') {
    throw new Error('evidenceService is required');
  }

  return async function reviveVerify(job) {
    const transactionId = job && (job.entityId || (job.payload && job.payload.transactionId));
    if (!transactionId) return { status:'complete' };
    const context = await reviveAttemptRepository.getVerificationContext(transactionId);
    if (!context) return { status:"complete" };

    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new Error("Revive verification clock returned invalid date");
    }

    if (context.state === STATES.RETRY_OFFERED) {
      const retryDeadline = context.retryResponseDeadline instanceof Date
        ? context.retryResponseDeadline
        : new Date(context.retryResponseDeadline);
      if (Number.isNaN(retryDeadline.getTime())) throw new Error("Retry response deadline is missing or invalid");
      if (now < retryDeadline) return { status:"reschedule", runAt:retryDeadline };
      await transactionService.transitionTransaction({
        transactionId,
        event:"retry_timeout",
        actor:{type:"system"},
        details:{refundReason:"retry_timeout"},
        now
      });
      return { status:"complete" };
    }

    if (context.state !== STATES.WAITING_FOR_REVIVE) return { status:"complete" };

    let evidence;
    try {
      evidence = await evidenceService.getReviveEvidence({
        requesterUserId:context.requesterUserId,
        reviverUserId:context.reviverUserId,
        requesterTornId:context.requesterTornId,
        reviverTornId:context.reviverTornId,
        from:context.attemptWindowStart,
        to:now
      });
      if (context.verificationHoldReason && typeof transactionService.clearVerificationHold === 'function') {
        await transactionService.clearVerificationHold({ transactionId, now });
      }
    } catch (error) {
      const code = error && error.code;
      if (['VERIFICATION_CREDENTIAL_REQUIRED','VERIFICATION_CREDENTIAL_INVALID','VERIFICATION_CREDENTIAL_INSUFFICIENT'].includes(code)) {
        if (typeof transactionService.setVerificationHold === 'function') {
          await transactionService.setVerificationHold({ transactionId, reason:code, metadata:{phase:'revive'}, now });
        }
        return { status:'reschedule', runAt:new Date(now.getTime() + CREDENTIAL_RETRY_MS) };
      }
      if (code === 'TORN_UNAVAILABLE') {
        if (typeof transactionService.setVerificationHold === 'function') {
          await transactionService.setVerificationHold({ transactionId, reason:'TORN_UNAVAILABLE', metadata:{phase:'revive'}, now });
        }
        return { status:'reschedule', runAt:new Date(now.getTime() + SERVICE_RETRY_MS) };
      }
      throw error;
    }

    let hospitalUntilBaseline = context.requesterHospitalUntil;
    const status = evidence && evidence.profile && evidence.profile.status;
    if (!hospitalUntilBaseline && status && isHospitalState(status.state) && status.until instanceof Date) {
      const stored = await reviveAttemptRepository.recordHospitalBaseline({
        transactionId,
        until:status.until,
        observedAt:now
      });
      hospitalUntilBaseline = stored && stored.requesterHospitalUntil
        ? stored.requesterHospitalUntil
        : status.until;
    }

    const revives = Array.isArray(evidence && evidence.revives) ? evidence.revives : [];
    for (const row of revives) {
      if (Number(row.reviverId) !== context.reviverTornId || Number(row.targetId) !== context.requesterTornId) continue;
      const at = row.at instanceof Date ? row.at : new Date(row.at);
      if (Number.isNaN(at.getTime()) || at < context.attemptWindowStart) continue;
      await reviveAttemptRepository.recordAttempt({
        transactionId,
        reviverUserId:context.reviverUserId,
        evidence:{ id:row.id, at, success:Boolean(row.success) }
      });
    }

    const outcome = classifyReviveOutcome({
      requesterTornId:context.requesterTornId,
      assignedReviverTornId:context.reviverTornId,
      attemptWindowStart:context.attemptWindowStart,
      reviveDeadline:context.reviveDeadline,
      now,
      revives,
      hospitalStatus:status || {state:'',until:null},
      hospitalUntilBaseline
    });

    const eventByKind = {
      assigned_success:'revive_success',
      assigned_failed:'revive_failed',
      third_party_success:'third_party_revive',
      requester_exit:'requester_exit',
      natural_expiry:'natural_expiry',
      no_attempt:'no_attempt'
    };
    const event = eventByKind[outcome.kind];
    if (event) {
      await transactionService.transitionTransaction({
        transactionId,
        event,
        actor:{type:'system'},
        details: outcome.evidence ? { tornEvidenceId:outcome.evidence.id } : {},
        now
      });
      return { status:'complete' };
    }

    if (outcome.kind === 'ambiguous') {
      if (typeof transactionService.setVerificationHold === 'function') {
        await transactionService.setVerificationHold({
          transactionId,
          reason:'EVIDENCE_AMBIGUOUS',
          metadata:{phase:'revive',reason:outcome.reason || 'ambiguous'},
          now
        });
      }
      return { status:'reschedule', runAt:new Date(now.getTime() + AMBIGUOUS_RETRY_MS) };
    }

    const finalAt = new Date(context.reviveDeadline.getTime() + REVIVE_RECONCILE_GRACE_MS);
    if (now < context.reviveDeadline) {
      return {
        status:'reschedule',
        runAt:minDate(new Date(now.getTime() + REVIVE_POLL_MS), context.reviveDeadline)
      };
    }
    return {
      status:'reschedule',
      runAt:minDate(new Date(now.getTime() + REVIVE_RECONCILE_POLL_MS), finalAt)
    };
  };
}

module.exports = {
  REVIVE_POLL_MS,
  createReviveVerifyHandler
};
