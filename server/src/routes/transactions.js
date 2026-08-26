const { z } = require("zod");
const { RATE_LIMITS } = require("../security/rate-limits");
const { STATES } = require("../domain/transaction-state");

const transactionIdSchema=z.string().uuid();
const emptyBodySchema=z.object({}).strict();
const retryResponseSchema=z.object({decision:z.enum(["accept","decline"])}).strict();
const RETRY_RESPONSE_MS=2*60*1000;

async function registerTransactionRoutes(app,{transactionRepository,transactionService,jobRepository,clock=()=>new Date()}) {
  if (!transactionRepository || typeof transactionRepository.getTransactionForUser!=="function") throw new Error("transactionRepository is required");
  if (!transactionService || typeof transactionService.transitionTransaction!=="function") throw new Error("transactionService is required");
  if (!jobRepository || typeof jobRepository.enqueueUniqueJob!=="function") throw new Error("jobRepository is required");
  if (typeof app.authenticate!=="function") throw new Error("transaction routes require session authentication");

  function now() {
    const value=clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("Transaction route clock returned invalid date");
    return value;
  }

  async function context(request,reply) {
    const parsed=transactionIdSchema.safeParse(request.params.id);
    if (!parsed.success) { reply.code(422).send({error:"INVALID_TRANSACTION_ID"}); return null; }
    const transaction=await transactionRepository.getTransactionForUser({transactionId:parsed.data,userId:request.reviveRelayUser.userId});
    if (!transaction) { reply.code(404).send({error:"TRANSACTION_NOT_FOUND"}); return null; }
    return transaction;
  }

  function parseEmpty(request,reply) {
    const parsed=emptyBodySchema.safeParse(request.body || {});
    if (!parsed.success) { reply.code(422).send({error:"INVALID_ACTION_PAYLOAD"}); return false; }
    return true;
  }

  async function transition(reply,input) {
    const result=await transactionService.transitionTransaction(input);
    if (!result.transitioned) { reply.code(409).send({error:result.reason||"TRANSACTION_STATE_CONFLICT"}); return null; }
    return result;
  }

  app.get("/v1/transactions/:id",{preHandler:[app.authenticate],config:{rateLimit:RATE_LIMITS.REVIVER_QUEUE}},async(request,reply)=>{
    const tx=await context(request,reply); if(!tx) return;
    return reply.code(200).send({transaction:tx});
  });

  app.post("/v1/transactions/:id/check-payment",{preHandler:[app.authenticate],config:{rateLimit:RATE_LIMITS.REQUEST_WRITE}},async(request,reply)=>{
    if(!parseEmpty(request,reply)) return;
    const tx=await context(request,reply); if(!tx) return;
    if(![STATES.WAITING_FOR_PAYMENT,STATES.PAYMENT_RECONCILING].includes(tx.state)) return reply.code(409).send({error:"PAYMENT_CHECK_NOT_AVAILABLE"});
    await jobRepository.enqueueUniqueJob({type:"payment.verify",entityId:tx.id,runAt:now(),dedupeKey:`payment.verify:${tx.id}`,payload:{transactionId:tx.id}});
    return reply.code(202).send({queued:true});
  });

  app.post("/v1/transactions/:id/retry-request",{preHandler:[app.authenticate],config:{rateLimit:RATE_LIMITS.REQUEST_WRITE}},async(request,reply)=>{
    if(!parseEmpty(request,reply)) return;
    const tx=await context(request,reply); if(!tx) return;
    if(tx.participantRole!=="requester") return reply.code(403).send({error:"REQUESTER_REQUIRED"});
    if(tx.state!==STATES.FAILED_ATTEMPT_CHOICE) return reply.code(409).send({error:"RETRY_NOT_AVAILABLE"});
    const at=now(); const retryResponseDeadline=new Date(at.getTime()+RETRY_RESPONSE_MS);
    const result=await transition(reply,{transactionId:tx.id,event:"retry_requested",actor:{type:"user",id:request.reviveRelayUser.userId},details:{retryResponseDeadline},now:at});
    if(!result) return;
    await jobRepository.enqueueUniqueJob({type:"revive.verify",entityId:tx.id,runAt:retryResponseDeadline,dedupeKey:`revive.retry:${tx.id}`,payload:{transactionId:tx.id}});
    return reply.code(200).send(result);
  });

  app.post("/v1/transactions/:id/retry-response",{preHandler:[app.authenticate],config:{rateLimit:RATE_LIMITS.REQUEST_WRITE}},async(request,reply)=>{
    const parsed=retryResponseSchema.safeParse(request.body || {});
    if(!parsed.success) return reply.code(422).send({error:"INVALID_RETRY_RESPONSE"});
    const tx=await context(request,reply); if(!tx) return;
    if(tx.participantRole!=="reviver") return reply.code(403).send({error:"REVIVER_REQUIRED"});
    if(tx.state!==STATES.RETRY_OFFERED) return reply.code(409).send({error:"RETRY_RESPONSE_NOT_AVAILABLE"});
    const at=now();
    if(tx.retryResponseDeadline && at>=new Date(tx.retryResponseDeadline)) {
      const expired=await transition(reply,{transactionId:tx.id,event:"retry_timeout",actor:{type:"system"},details:{refundReason:"retry_timeout"},now:at});
      if(!expired) return;
      return reply.code(409).send({error:"RETRY_WINDOW_EXPIRED"});
    }
    const accepting=parsed.data.decision==="accept";
    const reviveDeadline=accepting?new Date(at.getTime()+5*60*1000):null;
    const result=await transition(reply,{transactionId:tx.id,event:accepting?"retry_accepted":"retry_declined",actor:{type:"user",id:request.reviveRelayUser.userId},details:accepting?{reviveDeadline}:{refundReason:"retry_declined"},now:at});
    if(!result) return;
    if(accepting) await jobRepository.enqueueUniqueJob({type:"revive.verify",entityId:tx.id,runAt:at,dedupeKey:`revive.retry:${tx.id}`,payload:{transactionId:tx.id}});
    return reply.code(200).send(result);
  });

  app.post("/v1/transactions/:id/request-refund",{preHandler:[app.authenticate],config:{rateLimit:RATE_LIMITS.REQUEST_WRITE}},async(request,reply)=>{
    if(!parseEmpty(request,reply)) return;
    const tx=await context(request,reply); if(!tx) return;
    if(tx.participantRole!=="requester") return reply.code(403).send({error:"REQUESTER_REQUIRED"});
    if(tx.state!==STATES.FAILED_ATTEMPT_CHOICE) return reply.code(409).send({error:"REFUND_REQUEST_NOT_AVAILABLE"});
    const at=now();
    const result=await transition(reply,{transactionId:tx.id,event:"refund_requested",actor:{type:"user",id:request.reviveRelayUser.userId},details:{refundReason:"failed_attempt_requester_choice"},now:at});
    if(!result) return;
    return reply.code(200).send(result);
  });

  app.post("/v1/transactions/:id/check-refund",{preHandler:[app.authenticate],config:{rateLimit:RATE_LIMITS.REQUEST_WRITE}},async(request,reply)=>{
    if(!parseEmpty(request,reply)) return;
    const tx=await context(request,reply); if(!tx) return;
    if(![STATES.REFUND_REQUIRED,STATES.REFUND_RECONCILING].includes(tx.state)) return reply.code(409).send({error:"REFUND_CHECK_NOT_AVAILABLE"});
    await jobRepository.enqueueUniqueJob({type:"refund.verify",entityId:tx.id,runAt:now(),dedupeKey:`refund.verify:${tx.id}`,payload:{transactionId:tx.id}});
    return reply.code(202).send({queued:true});
  });
}

module.exports={registerTransactionRoutes,RETRY_RESPONSE_MS};
