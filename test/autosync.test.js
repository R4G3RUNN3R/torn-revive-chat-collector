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

test('1.0 runtime has no timers of its own: the Lite engine polls, the open panel refreshes on state changes', () => {
  for (const token of [
    'refreshActiveRequest()','refreshProState({ includePlans',
    'refreshReviverQueue()','refreshCurrentInvoice()','liteBoot.refresh()',
    'state.telemetry.drain()','function refreshPanelData()'
  ]) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.doesNotMatch(source, /postJson\(|markSynced\(|handlePublicMessage\(/);
});
