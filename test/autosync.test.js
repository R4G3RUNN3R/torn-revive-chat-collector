const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('legacy raw Google Sheets and chat autosync paths are absent from direct runtime', () => {
  for (const token of [
    'SYNC_EVERY_MS','BATCH_SIZE','trcc_sheet_endpoint','trcc_sheet_token',
    'script.google.com','script.googleusercontent.com','drainCandidateOutbox',
    'ReviveRelayCandidatePipeline','enqueueCandidate','captureAllowed()','/v1/candidates'
  ]) assert.equal(source.includes(token), false, token);
});

test('direct runtime polls only product state, Pro state, queue, invoice, sidebar and diagnostics', () => {
  for (const token of [
    'refreshActiveRequest()','refreshProState({ includePlans: false })',
    'refreshReviverQueue()','refreshCurrentInvoice()','refreshSidebarState',
    'state.telemetry.drain()'
  ]) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /postJson\(|markSynced\(|handlePublicMessage\(/);
});
