const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkerRunner } = require('../../src/worker/runner');

test('worker dispatches known jobs and records unknown job types as failures', async () => {
  const completed = [];
  const failed = [];
  const handled = [];
  let claims = 0;

  const runner = createWorkerRunner({
    workerId: 'worker-test',
    jobRepository: {
      async claimDueJobs() {
        claims += 1;
        return claims === 1 ? [
          { id: 'job-1', type: 'payment.verify', payload: { value: 1 } },
          { id: 'job-2', type: 'unknown.type', payload: {} }
        ] : [];
      },
      async completeJob(jobId) {
        completed.push(jobId);
      },
      async failJob(jobId, error) {
        failed.push([jobId, error]);
      }
    },
    handlers: {
      'payment.verify': async job => {
        handled.push(job.id);
      }
    },
    sleep: async () => {},
    logger: { error() {}, info() {} }
  });

  const count = await runner.runOnce();
  assert.equal(count, 2);
  assert.deepEqual(handled, ['job-1']);
  assert.deepEqual(completed, ['job-1']);
  assert.equal(failed.length, 1);
  assert.equal(failed[0][0], 'job-2');
  assert.match(failed[0][1], /unknown job type/i);
});

test('worker records handler failures instead of silently losing jobs', async () => {
  const failed = [];
  const runner = createWorkerRunner({
    workerId: 'worker-test',
    jobRepository: {
      async claimDueJobs() {
        return [{ id: 'job-1', type: 'revive.verify', payload: {} }];
      },
      async completeJob() {
        throw new Error('must not complete failed job');
      },
      async failJob(jobId, error) {
        failed.push([jobId, error]);
      }
    },
    handlers: {
      'revive.verify': async () => {
        throw new Error('Torn unavailable');
      }
    },
    sleep: async () => {},
    logger: { error() {}, info() {} }
  });

  await runner.runOnce();
  assert.deepEqual(failed, [['job-1', 'Torn unavailable']]);
});

test('worker reschedules normal polling outcomes without marking failure or completion', async () => {
  const completed=[]; const failed=[]; const rescheduled=[];
  const runAt = new Date('2026-08-26T10:00:15Z');
  const runner = createWorkerRunner({
    workerId:'worker-test',
    jobRepository:{
      async claimDueJobs(){ return [{id:'job-1',type:'payment.verify',payload:{}}]; },
      async completeJob(id){ completed.push(id); },
      async failJob(id,error){ failed.push([id,error]); },
      async rescheduleJob(id,input){ rescheduled.push([id,input]); }
    },
    handlers:{ 'payment.verify':async()=>({status:'reschedule',runAt}) },
    sleep:async()=>{}, logger:{error(){},info(){}}
  });
  await runner.runOnce();
  assert.deepEqual(completed,[]);
  assert.deepEqual(failed,[]);
  assert.equal(rescheduled.length,1);
  assert.equal(rescheduled[0][0],'job-1');
  assert.equal(rescheduled[0][1].runAt,runAt);
});

test('worker reports unknown job types and handler failures without passing job payloads', async () => {
  const reports = [];
  const failures = [];
  const jobs = [
    { id: 'job-unknown', type: 'unknown.type', payload: { apiKey: 'SECRET_UNKNOWN' } },
    { id: 'job-failed', type: 'payment.verify', payload: { apiKey: 'SECRET_HANDLER' } }
  ];
  let claimed = false;
  const runner = createWorkerRunner({
    workerId: 'worker-telemetry-test',
    jobRepository: {
      async claimDueJobs() { if (claimed) return []; claimed = true; return jobs; },
      async completeJob() {},
      async failJob(id, error) { failures.push([id, error]); }
    },
    handlers: {
      'payment.verify': async () => { throw new Error('handler failed token=TOPSECRET'); }
    },
    telemetryReporter: {
      async report(error, context) { reports.push({ message: error.message, context }); return true; }
    },
    logger: { error() {}, info() {} },
    sleep: async () => {}
  });

  await runner.runOnce();
  assert.equal(failures.length, 2);
  assert.equal(reports.length, 2);
  assert.deepEqual(reports.map(item => item.context.jobType), ['unknown.type', 'payment.verify']);
  assert.deepEqual(reports.map(item => item.context.component), ['worker', 'worker']);
  assert.ok(reports.every(item => item.context.operation));
  assert.doesNotMatch(JSON.stringify(reports.map(item => item.context)), /payload|SECRET_UNKNOWN|SECRET_HANDLER|apiKey/);
});
