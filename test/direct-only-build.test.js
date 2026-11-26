const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES } = require('../scripts/client-modules');

const REQUIRED = [
  'src/platform.js',
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js',
  'src/lite/boot.js'
];

const FORBIDDEN = [
  'src/api-client.js',
  'src/chat-dom.js',
  'src/public-channels.js',
  'src/client-chat-policy.js',
  'src/revive-classifier.js',
  'src/candidate-pipeline.js',
  'src/sidebar-action.js'
];

function bundledMarker(relativePath) {
  return `/* ReviveRelay bundled module: ${relativePath} */`;
}

test('canonical direct module inventory is exact and immutable', () => {
  assert.deepEqual([...DIRECT_SUPPORT_MODULES], REQUIRED);
  assert.equal(Object.isFrozen(DIRECT_SUPPORT_MODULES), true);
  assert.deepEqual([...LITE_ENGINE_MODULES], REQUIRED.filter(modulePath => modulePath.startsWith('src/lite/')));
});

test('the Lite state client loads after the direct API client and versioning it depends on', () => {
  const index = modulePath => DIRECT_SUPPORT_MODULES.indexOf(modulePath);
  assert.ok(index('src/direct-api-client.js') < index('src/lite/state-client.js'));
  assert.ok(index('src/versioning.js') < index('src/lite/state-client.js'));
  assert.ok(index('src/lite/engine.js') < index('src/lite/boot.js'));
});

test('main bootstrap consumes the exact core and Lite boot globals', () => {
  const coreSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'core.js'), 'utf8');
  const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

  assert.match(coreSource, /root\.TornReviveCore\s*=\s*api/);
  assert.match(mainSource, /const Core = globalThis\.TornReviveCore;/);
  assert.match(mainSource, /const LiteBoot = globalThis\.ReviveRelayLiteBoot;/);
  assert.doesNotMatch(mainSource, /TornReviveChatCollectorCore|ReviveRelaySidebarAction/);
});

test('current review bundle contains direct support exactly once and zero legacy chat/candidate/sidebar modules', () => {
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
  assert.doesNotMatch(built, /createSidebarController|ReviveRelay → Revive Me!/);
  assert.match(built, /ReviveRelayDirectApiClient/);
  assert.match(built, /ReviveRelayLiteBoot/);
  assert.match(built, /Request certified revive/);
  assert.match(built, /const UPDATE_CHANNEL = 'review'/);
});

test('ReviveRelay 1.0 is versioned 1.0.0', () => {
  assert.equal(require('../package.json').version, '1.0.0');
});

