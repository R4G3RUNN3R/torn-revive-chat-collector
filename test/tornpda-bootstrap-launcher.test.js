const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('bootstrap installs the recovery launcher before full initialization', () => {
  const start = source.indexOf('function start() {');
  const initCall = source.indexOf('init().catch', start);
  const hook = source.indexOf('installPdaReadinessHook();', start);
  const launcher = source.indexOf('syncPdaLauncher({ forceVisible: isRecoveryLauncherContext() });', start);
  assert.ok(start >= 0 && hook > start && launcher > hook && initCall > launcher);
});

test('late TornPDA platform readiness reconciles launcher and panel', () => {
  assert.match(source, /flutterInAppWebViewPlatformReady/);
  assert.match(source, /globalThis\.__PDA_platformReadyPromise/);
  assert.match(source, /Promise\.resolve\(readyPromise\)\.then\(reconcilePdaReadyUi\)/);
  assert.match(source, /syncPdaLauncher\(\{ forceVisible: true \}\)/);
  assert.match(source, /panel\.classList\.add\('rr-tornpda'\)/);
});

test('failed initialization tears down partial state and keeps a TornPDA retry surface available', () => {
  const start = source.indexOf('function start() {');
  const end = source.indexOf("if (document.readyState === 'loading')", start);
  const block = source.slice(start, end);
  assert.match(block, /cleanupPartialInitialization\(\)/);
  assert.match(block, /syncPdaLauncher\(\{ forceVisible: isRecoveryLauncherContext\(\) \}\)/);
  assert.match(block, /failed to initialize\. Tap to retry/);
  assert.match(block, /initPromise = null/);
  assert.match(source, /function cleanupPartialInitialization\(\) \{/);
  assert.match(source, /state\.sidebarController\.destroy\(\)/);
  assert.match(source, /panel\.remove\(\)/);
  assert.match(source, /stopTimers\(\)/);
});

test('launcher retry restarts initialization when the previous attempt did not fully initialize', () => {
  const start = source.indexOf('function restorePanelFromPdaLauncher() {');
  const end = source.indexOf('function createPdaLauncher()', start);
  const block = source.slice(start, end);
  assert.match(block, /if \(!initialized\)/);
  assert.match(block, /if \(!initPromise\)/);
  assert.match(block, /cleanupPartialInitialization\(\)/);
  assert.match(block, /start\(\)/);
});

test('recovery launcher is scoped to dynamically detected TornPDA rather than viewport width', () => {
  assert.match(source, /function isRecoveryLauncherContext\(\) \{\s*return isTornPdaNow\(\);\s*\}/);
  assert.doesNotMatch(source, /viewportWidth <= 900/);
  assert.doesNotMatch(source, /pointer: coarse/);
});

test('recovery launcher critical style is not dependent on injected stylesheet success', () => {
  assert.match(source, /function applyRecoveryLauncherCriticalStyle\(button\)/);
  assert.match(source, /button\.style\.setProperty\([^\n]*'important'\)/);
  assert.match(source, /zIndex: '2147483646'/);
  assert.match(source, /pointerEvents: 'auto'/);
  assert.match(source, /visibility: 'visible'/);
  assert.match(source, /opacity: '1'/);
});

test('recovery launcher watcher remounts the control after Torn/WebView DOM replacement', () => {
  assert.match(source, /function startPdaLauncherWatch\(\)/);
  assert.match(source, /window\.setInterval\(\(\) => \{/);
  assert.match(source, /syncPdaLauncher\(\{ forceVisible: true \}\)/);
  assert.match(source, /\}, 2000\)/);
  assert.match(source, /startPdaLauncherWatch\(\);/);
});
