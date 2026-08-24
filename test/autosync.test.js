const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const userscriptPath = path.join(__dirname, '..', 'torn-revive-chat-collector.user.js');
const source = fs.readFileSync(userscriptPath, 'utf8');

test('legacy raw Google Sheets autosync is removed from the installable userscript', () => {
  assert.doesNotMatch(source, /SYNC_EVERY_MS/);
  assert.doesNotMatch(source, /BATCH_SIZE/);
  assert.doesNotMatch(source, /trcc_sheet_endpoint/);
  assert.doesNotMatch(source, /trcc_sheet_token/);
  assert.doesNotMatch(source, /script\.google\.com/);
  assert.doesNotMatch(source, /script\.googleusercontent\.com/);
  assert.doesNotMatch(source, /records:\s*rows\.map\(Core\.buildSheetRecord\)/);
});

test('candidate outbox draining is gated by active Torn use', () => {
  assert.match(source, /drainCandidateOutbox/);
  assert.match(source, /if\s*\(!captureAllowed\(\)\)\s*return\s*;/);
});

test('candidate pipeline is the only automatic public-message submission path', () => {
  assert.match(source, /ReviveRelayCandidatePipeline\.handlePublicMessage/);
  assert.match(source, /enqueueCandidate/);
  assert.doesNotMatch(source, /postJson\(/);
  assert.doesNotMatch(source, /markSynced\(/);
});
