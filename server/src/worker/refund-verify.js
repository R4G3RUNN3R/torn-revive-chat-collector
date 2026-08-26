const { matchRefundEvidence }=require("../domain/refund-matcher");
const { STATES }=require("../domain/transaction-state");

const REFUND_RECONCILE_GRACE_MS=30*1000;
const REFUND_POLL_MS=15*1000;
const REFUND_RECONCILE_POLL_MS=5*1000;
const CREDENTIAL_RETRY_MS=60*1000;
const SERVICE_RETRY_MS=15*1000;

function minDate(a,b){return a<=b?a:b;}

function createRefundVerifyHandler({refundRepository,transactionService,evidenceService,clock=()=>new Date()}) {
  if(!refundRepository||typeof refundRepository.getVerificationContext!=="function"||typeof refundRepository.recordRefundEvidence!=="function") throw new Error("refundRepository is required");
  if(!transactionService||typeof transactionService.transitionTransaction!=="function") throw new Error("transactionService is required");
  if(!evidenceService||typeof evidenceService.getOutgoingRefundEvidence!=="function") throw new Error("evidenceService is required");

  return async function refundVerify(job) {
    const transactionId=job&&(job.entityId||(job.payload&&job.payload.transactionId));
    if(!transactionId) return {status:"complete"};
    let context=await refundRepository.getVerificationContext(transactionId);
    if(!context||![STATES.REFUND_REQUIRED,STATES.REFUND_RECONCILING].includes(context.state)||context.verifiedAt) return {status:"complete"};
    const now=clock();
    if(!(now instanceof Date)||Number.isNaN(now.getTime())) throw new Error("Refund verification clock returned invalid date");

    let logs;
    try {
      logs=await evidenceService.getOutgoingRefundEvidence({reviverUserId:context.reviverUserId,requesterTornId:context.requesterTornId,method:context.method,from:context.refundRequiredAt,to:now});
      if(context.verificationHoldReason&&typeof transactionService.clearVerificationHold==="function") await transactionService.clearVerificationHold({transactionId,now});
    } catch(error) {
      const code=error&&error.code;
      if(["VERIFICATION_CREDENTIAL_REQUIRED","VERIFICATION_CREDENTIAL_INVALID","VERIFICATION_CREDENTIAL_INSUFFICIENT"].includes(code)) {
        if(typeof transactionService.setVerificationHold==="function") await transactionService.setVerificationHold({transactionId,reason:code,metadata:{phase:"refund"},now});
        return {status:"reschedule",runAt:new Date(now.getTime()+CREDENTIAL_RETRY_MS)};
      }
      if(code==="TORN_UNAVAILABLE") {
        if(typeof transactionService.setVerificationHold==="function") await transactionService.setVerificationHold({transactionId,reason:"TORN_UNAVAILABLE",metadata:{phase:"refund"},now});
        return {status:"reschedule",runAt:new Date(now.getTime()+SERVICE_RETRY_MS)};
      }
      throw error;
    }

    const match=matchRefundEvidence({method:context.method,requiredAmount:context.requiredAmount,requesterTornId:context.requesterTornId,refundRequiredAt:context.refundRequiredAt,refundDeadline:context.refundDeadline,logs});
    if(match.evidence.length) await refundRepository.recordRefundEvidence({transactionId,evidence:match.evidence,verifiedAt:match.status==="verified"?now:null});
    if(match.status==="verified") {
      await transactionService.transitionTransaction({transactionId,event:"refund_verified",actor:{type:"system"},details:{verifiedAmount:match.verifiedAmount},now});
      return {status:"complete"};
    }

    const finalAt=new Date(context.refundDeadline.getTime()+REFUND_RECONCILE_GRACE_MS);
    if(now<context.refundDeadline) return {status:"reschedule",runAt:minDate(new Date(now.getTime()+REFUND_POLL_MS),context.refundDeadline)};

    if(context.state===STATES.REFUND_REQUIRED) {
      const transition=await transactionService.transitionTransaction({transactionId,event:"deadline",actor:{type:"system"},details:{},now});
      if(transition&&transition.transitioned) context={...context,state:STATES.REFUND_RECONCILING};
    }
    if(now<finalAt) return {status:"reschedule",runAt:minDate(new Date(now.getTime()+REFUND_RECONCILE_POLL_MS),finalAt)};
    await transactionService.transitionTransaction({transactionId,event:"missing_refund",actor:{type:"system"},details:{verifiedAmount:match.verifiedAmount},now});
    return {status:"complete"};
  };
}

module.exports={REFUND_RECONCILE_GRACE_MS,createRefundVerifyHandler};
