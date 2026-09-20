const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const manifest = require('./fixtures/client/reviverelay-0.4.5-baseline.json');
const { DIRECT_SUPPORT_MODULES } = require('../scripts/client-modules');

function sha(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

for (const [relativePath, expected] of Object.entries(manifest.supportHashes).filter(([relativePath]) => !['src/update-manager.js','src/versioning.js'].includes(relativePath))) {
  test(`known-good support bytes stay locked: ${relativePath}`, () => {
    assert.equal(sha(relativePath), expected);
  });
}

test('canonical 0.6.0 source keeps the proven document-idle bootstrap but is direct-only', () => {
  const source = fs.readFileSync('torn-revive-chat-collector.user.js', 'utf8');
  assert.match(source, /@run-at\s+document-idle/);
  assert.match(source, /ReviveRelay → Revive Me!/);
  assert.match(source, /ReviveRelayRequestPreset/);
  assert.doesNotMatch(source, /ReviveRelayProClient|createProClient|state\.proApi/);
  assert.doesNotMatch(source, /fetchRecentPublicCandidates|\/v1\/candidates|Shared public chat requests/);
});

test('0.6.0 review build is self-contained, document-idle, current-version, and direct-only', () => {
  const packageVersion = require('../package.json').version;
  const built = fs.readFileSync(`dist/review/ReviveRelay-${packageVersion}.user.js`, 'utf8');
  assert.equal((built.match(/^\/\/ @require\s+/gm) || []).length, 0);
  assert.match(built, /@run-at\s+document-idle/);
  assert.match(built, new RegExp(`@version\\s+${packageVersion.replace(/\./g, '\\.')}\\b`));
  assert.doesNotMatch(built, /ReviveRelayTransportObserver|transport_hook_anomaly|\/v1\/telemetry\/debug/);
  for (const relativePath of DIRECT_SUPPORT_MODULES) {
    assert.equal(built.split(`/* ReviveRelay bundled module: ${relativePath} */`).length - 1, 1);
  }
  for (const relativePath of Object.keys(manifest.supportHashes).filter(path => !DIRECT_SUPPORT_MODULES.includes(path))) {
    assert.equal(built.includes(`/* ReviveRelay bundled module: ${relativePath} */`), false);
  }
});
