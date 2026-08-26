const test = require("node:test");
const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { registerTransactionRoutes, RETRY_RESPONSE_MS } = require("../../src/routes/transactions");

function makeApp({state="WAITING_FOR_PAYMENT",role="requester",transitioned=true}={}) {
  const app=Fastify({logger:false});
  const jobs=[]; const transitions=[];
  app.decorate("authenticate", async request => {
    const token=String(request.headers.authorization||"").replace(/^Bearer\s+/i,"");
    request.reviveRelayUser={userId:token||"requester-user",roles:["requester"]};
  });
  const transactionRepository={
    async getTransactionForUser({transactionId,userId}) {
      if (userId==="outsider") return null;
      const participantRole=userId==="reviver-user"?"reviver":role;
      return {id:transactionId,state,participantRole,retryResponseDeadline:new Date("2026-08-26T10:12:00Z")};
    }
  };
  const transactionService={async transitionTransaction(input){transitions.push(input);return {transitioned,reason:transitioned?null:"TRANSACTION_STATE_CONFLICT",transaction:{id:input.transactionId,state}};}};
  const jobRepository={async enqueueUniqueJob(input){jobs.push(input);return {id:"job"};}};
  registerTransactionRoutes(app,{transactionRepository,transactionService,jobRepository,clock:()=>new Date("2026-08-26T10:10:00Z")});
  return {app,jobs,transitions};
}

test("transaction read is participant scoped and does not leak to outsiders", async () => {
  const s=makeApp();
  const ok=await s.app.inject({method:"GET",url:"/v1/transactions/11111111-1111-4111-8111-111111111111",headers:{authorization:"Bearer requester-user"}});
  assert.equal(ok.statusCode,200);
  const denied=await s.app.inject({method:"GET",url:"/v1/transactions/11111111-1111-4111-8111-111111111111",headers:{authorization:"Bearer outsider"}});
  assert.equal(denied.statusCode,404);
  await s.app.close();
});

test("check payment only expedites the deduplicated payment job", async () => {
  const s=makeApp({state:"WAITING_FOR_PAYMENT"});
  const res=await s.app.inject({method:"POST",url:"/v1/transactions/11111111-1111-4111-8111-111111111111/check-payment",headers:{authorization:"Bearer requester-user"}});
  assert.equal(res.statusCode,202);
  assert.equal(s.jobs[0].type,"payment.verify");
  assert.equal(s.jobs[0].dedupeKey,"payment.verify:11111111-1111-4111-8111-111111111111");
  assert.equal(s.transitions.length,0);
  await s.app.close();
});

test("requester retry creates a bounded response window and a timeout check", async () => {
  const s=makeApp({state:"FAILED_ATTEMPT_CHOICE"});
  const res=await s.app.inject({method:"POST",url:"/v1/transactions/11111111-1111-4111-8111-111111111111/retry-request",headers:{authorization:"Bearer requester-user"}});
  assert.equal(res.statusCode,200);
  assert.equal(s.transitions[0].event,"retry_requested");
  assert.equal(s.transitions[0].details.retryResponseDeadline.getTime(),new Date("2026-08-26T10:10:00Z").getTime()+RETRY_RESPONSE_MS);
  assert.equal(s.jobs[0].type,"revive.verify");
  assert.equal(s.jobs[0].dedupeKey,"revive.retry:11111111-1111-4111-8111-111111111111");
  await s.app.close();
});

test("assigned reviver may accept retry and receives a fresh five-minute revive window", async () => {
  const s=makeApp({state:"RETRY_OFFERED",role:"requester"});
  const res=await s.app.inject({method:"POST",url:"/v1/transactions/11111111-1111-4111-8111-111111111111/retry-response",headers:{authorization:"Bearer reviver-user"},payload:{decision:"accept"}});
  assert.equal(res.statusCode,200);
  assert.equal(s.transitions[0].event,"retry_accepted");
  assert.equal(s.transitions[0].details.reviveDeadline.toISOString(),"2026-08-26T10:15:00.000Z");
  assert.equal(s.jobs[0].dedupeKey,"revive.retry:11111111-1111-4111-8111-111111111111");
  await s.app.close();
});

test("requester can choose refund after genuine failed attempt", async () => {
  const s=makeApp({state:"FAILED_ATTEMPT_CHOICE"});
  const res=await s.app.inject({method:"POST",url:"/v1/transactions/11111111-1111-4111-8111-111111111111/request-refund",headers:{authorization:"Bearer requester-user"}});
  assert.equal(res.statusCode,200);
  assert.equal(s.transitions[0].event,"refund_requested");
  await s.app.close();
});

test("check refund only expedites refund verification and arbitrary state payloads are rejected", async () => {
  const s=makeApp({state:"REFUND_REQUIRED"});
  const bad=await s.app.inject({method:"POST",url:"/v1/transactions/11111111-1111-4111-8111-111111111111/check-refund",headers:{authorization:"Bearer requester-user"},payload:{state:"COMPLETED"}});
  assert.equal(bad.statusCode,422);
  assert.equal(s.transitions.length,0);
  const good=await s.app.inject({method:"POST",url:"/v1/transactions/11111111-1111-4111-8111-111111111111/check-refund",headers:{authorization:"Bearer requester-user"},payload:{}});
  assert.equal(good.statusCode,202);
  assert.equal(s.jobs[0].type,"refund.verify");
  await s.app.close();
});
