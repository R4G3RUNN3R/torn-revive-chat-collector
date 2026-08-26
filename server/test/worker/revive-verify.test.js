const test=require('node:test');
const assert=require('node:assert/strict');
const {createReviveVerifyHandler}=require('../../src/worker/revive-verify');

function context(overrides={}){return{
 transactionId:'txn',requesterUserId:'req-user',reviverUserId:'rev-user',requesterTornId:100,reviverTornId:200,
 state:'WAITING_FOR_REVIVE',attemptWindowStart:new Date('2026-08-26T10:01:00Z'),reviveDeadline:new Date('2026-08-26T10:06:00Z'),
 requesterHospitalUntil:new Date('2026-08-26T10:20:00Z'),verificationHoldReason:null,...overrides};}
function setup({now='2026-08-26T10:03:00Z',ctx=context(),revives=[],profile={status:{state:'Hospital',until:Math.floor(Date.parse('2026-08-26T10:20:00Z')/1000)}},error=null}={}){
 const transitions=[],attempts=[],holds=[],baselines=[];
 const repo={
  async getVerificationContext(){return ctx;},
  async recordAttempt(input){attempts.push(input);return{id:'a'};},
  async recordHospitalBaseline(input){baselines.push(input);return{requesterHospitalUntil:input.until};}
 };
 const service={
  async transitionTransaction(input){transitions.push(input);return{transitioned:true};},
  async setVerificationHold(input){holds.push(input);},
  async clearVerificationHold(){}
 };
 const evidence={async getReviveEvidence(){if(error)throw error;return{revives,profile};}};
 return{handler:createReviveVerifyHandler({reviveAttemptRepository:repo,transactionService:service,evidenceService:evidence,clock:()=>new Date(now)}),transitions,attempts,holds,baselines};
}

test('assigned success records attempt and completes',async()=>{const s=setup({revives:[{id:'r1',reviverId:200,targetId:100,success:true,at:new Date('2026-08-26T10:02:00Z')} ]});const r=await s.handler({entityId:'txn'});assert.equal(r.status,'complete');assert.equal(s.attempts.length,1);assert.equal(s.transitions.at(-1).event,'revive_success');});
test('genuine assigned failure records attempt and enters choice instead of misconduct',async()=>{const s=setup({revives:[{id:'r1',reviverId:200,targetId:100,success:false,at:new Date('2026-08-26T10:02:00Z')} ]});await s.handler({entityId:'txn'});assert.equal(s.transitions.at(-1).event,'revive_failed');});
test('third-party success requires refund',async()=>{const s=setup({revives:[{id:'r2',reviverId:300,targetId:100,success:true,at:new Date('2026-08-26T10:02:00Z')} ]});await s.handler({entityId:'txn'});assert.equal(s.transitions.at(-1).event,'third_party_revive');});
test('self exit and natural expiry close without refund',async()=>{let s=setup({now:'2026-08-26T10:05:00Z',profile:{status:{state:'Okay',until:null}}});await s.handler({entityId:'txn'});assert.equal(s.transitions.at(-1).event,'requester_exit');s=setup({now:'2026-08-26T10:20:01Z',profile:{status:{state:'Okay',until:null}}});await s.handler({entityId:'txn'});assert.equal(s.transitions.at(-1).event,'natural_expiry');});
test('no attempt becomes reportable only after final reconciliation grace',async()=>{const s=setup({now:'2026-08-26T10:06:31Z'});await s.handler({entityId:'txn'});assert.equal(s.transitions.at(-1).event,'no_attempt');});
test('missing hospital baseline plus exit becomes evidence hold, not guessed outcome',async()=>{const s=setup({ctx:context({requesterHospitalUntil:null}),profile:{status:{state:'Okay',until:null}}});const r=await s.handler({entityId:'txn'});assert.equal(r.status,'reschedule');assert.equal(s.holds[0].reason,'EVIDENCE_AMBIGUOUS');assert.equal(s.transitions.length,0);});
test('credential outage creates hold and retry',async()=>{const s=setup({error:Object.assign(new Error('bad'),{code:'VERIFICATION_CREDENTIAL_INVALID'})});const r=await s.handler({entityId:'txn'});assert.equal(r.status,'reschedule');assert.equal(s.holds[0].reason,'VERIFICATION_CREDENTIAL_INVALID');});


test("retry offer waits only until authoritative response deadline",async()=>{
 const s=setup({now:"2026-08-26T10:10:30Z",ctx:context({state:"RETRY_OFFERED",retryResponseDeadline:new Date("2026-08-26T10:12:00Z")})});
 const r=await s.handler({entityId:"txn"});assert.equal(r.status,"reschedule");assert.equal(r.runAt.toISOString(),"2026-08-26T10:12:00.000Z");assert.equal(s.transitions.length,0);
});

test("expired retry offer becomes refund-required through retry_timeout",async()=>{
 const s=setup({now:"2026-08-26T10:12:01Z",ctx:context({state:"RETRY_OFFERED",retryResponseDeadline:new Date("2026-08-26T10:12:00Z")})});
 const r=await s.handler({entityId:"txn"});assert.equal(r.status,"complete");assert.equal(s.transitions.at(-1).event,"retry_timeout");
});
