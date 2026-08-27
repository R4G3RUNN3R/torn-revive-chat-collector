const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelemetryRetentionHandler, RETENTION_DAYS, RETENTION_INTERVAL_MS } = require('../../src/worker/telemetry-retention');

test('retention deletes only raw occurrences older than 30 days and reschedules daily', async () => {
  const purges=[];
  const now=new Date('2026-08-26T12:00:00Z');
  const repository={ async purgeOccurrences(before){ purges.push(before); return 7; } };
  const handler=createTelemetryRetentionHandler({telemetryRepository:repository,clock:()=>new Date(now)});
  const result=await handler({type:'telemetry.retention'});
  assert.equal(RETENTION_DAYS,30);
  assert.equal(purges.length,1);
  assert.equal(purges[0].toISOString(),'2026-07-27T12:00:00.000Z');
  assert.equal(result.status,'reschedule');
  assert.equal(result.runAt.getTime(),now.getTime()+RETENTION_INTERVAL_MS);
  assert.equal(result.deletedOccurrences,7);
});

test('retention interface has no aggregate group/version deletion capability', async () => {
  const calls=[];
  const repository={ async purgeOccurrences(before){calls.push(['occurrences',before]);return 0;} };
  const handler=createTelemetryRetentionHandler({telemetryRepository:repository,clock:()=>new Date('2026-08-26T12:00:00Z')});
  await handler({type:'telemetry.retention'});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'occurrences');
});
