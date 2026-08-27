const test = require('node:test');
const assert = require('node:assert/strict');
const { createSheetsMirrorHandler, MIRROR_INTERVAL_MS } = require('../../src/worker/sheets-mirror');

test('mirror syncs dirty aggregate groups, marks only successful groups mirrored, and reschedules for 15 minutes', async () => {
  const groups = [{id:'g1', fingerprint:'f1'}, {id:'g2', fingerprint:'f2'}];
  const marked=[]; const synced=[];
  const now = new Date('2026-08-26T12:00:00Z');
  const handler = createSheetsMirrorHandler({
    telemetryRepository: { async listGroupsForMirror(){ return groups; }, async markMirrored(ids, at){ marked.push({ids,at}); return ids.length; } },
    sheetsClient: { async syncGroups(input, at){ synced.push({input,at}); } }, clock: () => new Date(now)
  });
  const result = await handler({type:'sheets.mirror'});
  assert.equal(synced.length,1);
  assert.deepEqual(synced[0].input,groups);
  assert.deepEqual(marked[0].ids,['g1','g2']);
  assert.equal(marked[0].at.toISOString(), now.toISOString());
  assert.equal(result.status,'reschedule');
  assert.equal(result.runAt.getTime(), now.getTime()+MIRROR_INTERVAL_MS);
});

test('Google outage preserves unsynced groups and only reschedules the mirror job', async () => {
  let marked=false; const reports=[];
  const now = new Date('2026-08-26T12:00:00Z');
  const handler = createSheetsMirrorHandler({
    telemetryRepository: { async listGroupsForMirror(){ return [{id:'g1', fingerprint:'f1'}]; }, async markMirrored(){ marked=true; } },
    sheetsClient: { async syncGroups(){ throw new Error('Google unavailable credential=SECRET'); } },
    telemetryReporter: { async report(error,context){ reports.push({error,context}); } }, clock: () => new Date(now)
  });
  const result = await handler({type:'sheets.mirror', payload:{apiKey:'DO_NOT_EXPORT'}});
  assert.equal(marked,false);
  assert.equal(result.status,'reschedule');
  assert.equal(result.runAt.getTime(), now.getTime()+MIRROR_INTERVAL_MS);
  assert.equal(reports.length,1);
  assert.deepEqual(reports[0].context,{component:'worker',operation:'sheets.mirror'});
  assert.doesNotMatch(JSON.stringify(reports[0].context), /payload|apiKey|DO_NOT_EXPORT/);
});

test('empty mirror still reschedules without calling Google', async () => {
  let synced=false;
  const now = new Date('2026-08-26T12:00:00Z');
  const handler = createSheetsMirrorHandler({
    telemetryRepository:{async listGroupsForMirror(){return[];},async markMirrored(){throw new Error('not called');}},
    sheetsClient:{async syncGroups(){synced=true;}}, clock:()=>new Date(now)
  });
  const result=await handler({type:'sheets.mirror'});
  assert.equal(synced,false);
  assert.equal(result.status,'reschedule');
});
