const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECT_SUPPORT_MODULES } = require('../scripts/client-modules');

const REQUIRED = [
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  'src/sidebar-action.js'
];

const FORBIDDEN = [
  'src/api-client.js',
  'src/chat-dom.js',
  'src/public-channels.js',
  'src/client-chat-policy.js',
  'src/revive-classifier.js',
  'src/candidate-pipeline.js'
];

function bundledMarker(relativePath) {
  return `/* ReviveRelay bundled module: ${relativePath} */`;
}

test('canonical direct module inventory is exact and immutable', () => {
  assert.deepEqual([...DIRECT_SUPPORT_MODULES], REQUIRED);
  assert.equal(Object.isFrozen(DIRECT_SUPPORT_MODULES), true);
});

test('main bootstrap consumes the exact core global exported by src/core.js', () => {
  const coreSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'core.js'), 'utf8');
  const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

  assert.match(coreSource, /root\.TornReviveCore\s*=\s*api/);
  assert.match(mainSource, /const Core = globalThis\.TornReviveCore;/);
  assert.doesNotMatch(mainSource, /TornReviveChatCollectorCore/);
});

test('current review bundle contains direct support exactly once and zero legacy chat/candidate modules', () => {
  const version = require('../package.json').version;
  const filename = `review/ReviveRelay-${version}.user.js`;
  const built = fs.readFileSync(path.resolve(__dirname, '..', 'dist', filename), 'utf8');
  for (const modulePath of REQUIRED) {
    assert.equal(built.split(bundledMarker(modulePath)).length - 1, 1, `${filename}: ${modulePath}`);
  }
  for (const modulePath of FORBIDDEN) {
    assert.equal(built.includes(bundledMarker(modulePath)), false, `${filename}: ${modulePath}`);
  }
  assert.doesNotMatch(built, /\/v1\/candidates|Shared public chat requests|Live Capture|Rescan public chats/);
  assert.doesNotMatch(built, /ReviveRelayApiClient|ReviveRelayProClient|createProClient|submitCandidate|drainCandidateOutbox|createOutboxEntry/);
  assert.match(built, /ReviveRelayDirectApiClient/);
  assert.match(built, /ReviveRelay → Revive Me!/);
  assert.match(built, /const UPDATE_CHANNEL = 'review'/);
});


test('current direct-only review implementation is versioned as 0.6.6', () => {
  assert.equal(require('../package.json').version, '0.6.6');
});
