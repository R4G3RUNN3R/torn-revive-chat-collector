const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const manifest = require('./fixtures/client/reviverelay-0.4.5-baseline.json');

function sha(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

for (const [relativePath, expected] of Object.entries(manifest.supportHashes)) {
  test(`known-good support bytes stay locked: ${relativePath}`, () => {
    assert.equal(sha(relativePath), expected);
  });
}

test('canonical source carries the accepted shared-feed delta only in the main userscript', () => {
  const source = fs.readFileSync('torn-revive-chat-collector.user.js', 'utf8');
  assert.match(source, /async function fetchRecentPublicCandidates\(/);
  assert.match(source, /\/v1\/candidates\/recent/);
  assert.match(source, /Shared public chat requests/);
  assert.match(source, /ReviveRelayApiClient\.createGmRequestAdapter\(GM_xmlhttpRequest\)/);
  assert.match(source, /@run-at\s+document-idle/);
});
