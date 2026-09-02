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

test('canonical 0.5.0 source keeps the proven document-idle bootstrap but is direct-only', () => {
  const source = fs.readFileSync('torn-revive-chat-collector.user.js', 'utf8');
  assert.match(source, /@run-at\s+document-idle/);
  assert.match(source, /ReviveRelay → Revive Me!/);
  assert.match(source, /ReviveRelayRequestPreset/);
  assert.match(source, /ReviveRelayProClient/);
  assert.doesNotMatch(source, /fetchRecentPublicCandidates|\/v1\/candidates|Shared public chat requests/);
});

test('Control B build is self-contained, document-idle, current-version, and contains no transport observer', () => {
  const built = fs.readFileSync('dist/reviverelay-manual.user.js', 'utf8');
  const packageVersion = require('../package.json').version;
  assert.equal((built.match(/^\/\/ @require\s+/gm) || []).length, 0);
  assert.match(built, /@run-at\s+document-idle/);
  assert.match(built, new RegExp(`@version\\s+${packageVersion.replace(/\\./g, '\\\\.')}\\b`));
  assert.doesNotMatch(built, /ReviveRelayTransportObserver|transport_hook_anomaly|\/v1\/telemetry\/debug/);
  for (const relativePath of Object.keys(manifest.supportHashes)) {
    assert.equal(built.split(`/* ReviveRelay bundled module: ${relativePath} */`).length - 1, 1);
  }
});
