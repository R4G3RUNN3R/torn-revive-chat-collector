const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES } = require('../scripts/client-modules');
const { bundledModule } = require('../scripts/build');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createFakeDocument, createFakeWindow } = require('./helpers/fake-dom');

const root = path.resolve(__dirname, '..');

const EXPECTED = [
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js',
  'src/lite/notify.js',
  'src/lite/badges.js',
  'src/lite/boot.js'
];

const GLOBALS = {
  'src/lite/pill-state.js': 'ReviveRelayLitePillState',
  'src/lite/scheduler.js': 'ReviveRelayLiteScheduler',
  'src/lite/snapshot-cache.js': 'ReviveRelayLiteSnapshotCache',
  'src/lite/tab-leader.js': 'ReviveRelayLiteTabLeader',
  'src/lite/state-client.js': 'ReviveRelayLiteStateClient',
  'src/lite/icons.js': 'ReviveRelayLiteIcons',
  'src/lite/tokens.js': 'ReviveRelayLiteTokens',
  'src/lite/pill-view.js': 'ReviveRelayLitePillView',
  'src/lite/engine.js': 'ReviveRelayLiteEngine',
  'src/lite/notify.js': 'ReviveRelayLiteNotify',
  'src/lite/badges.js': 'ReviveRelayLiteBadges',
  'src/lite/boot.js': 'ReviveRelayLiteBoot'
};

const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('lite engine inventory is exact, frozen and bundled in load order at the end of the 1.0 bundle', () => {
  assert.deepEqual([...LITE_ENGINE_MODULES], EXPECTED);
  assert.equal(Object.isFrozen(LITE_ENGINE_MODULES), true);
  assert.deepEqual([...DIRECT_SUPPORT_MODULES].slice(-EXPECTED.length), EXPECTED);
  const version = require('../package.json').version;
  const built = fs.readFileSync(path.join(root, 'dist', 'review', `ReviveRelay-${version}.user.js`), 'utf8');
  const positions = EXPECTED.map(modulePath => built.indexOf(`/* ReviveRelay bundled module: ${modulePath} */`));
  for (const position of positions) assert.ok(position > 0);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.equal(fs.existsSync(path.join(root, 'src', 'core')), false);
});

test('each lite module is a UMD file that sets exactly one ReviveRelayLite global', () => {
  for (const modulePath of LITE_ENGINE_MODULES) {
    const source = read(modulePath);
    const globals = [...source.matchAll(/root\.(\w+)\s*=\s*api;/g)].map(match => match[1]);
    assert.deepEqual(globals, [GLOBALS[modulePath]], modulePath);
    assert.match(source, /^\(function \(root, factory\) \{\n  const api = factory\(\);\n  if \(typeof module === 'object' && module\.exports\) module\.exports = api;/, modulePath);
    assert.match(source, /'use strict';/, modulePath);
  }
});

test('lite sources avoid dynamic HTML, dynamic code, fetch and remote dependencies', () => {
  for (const modulePath of LITE_ENGINE_MODULES) {
    const source = read(modulePath);
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, modulePath);
    assert.doesNotMatch(source, /\beval\s*\(|\bnew\s+Function\s*\(/, modulePath);
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket/, modulePath);
    assert.doesNotMatch(source, /^\/\/\s*@require/m, modulePath);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, modulePath);
  }
});

test('bundled exactly as build.js would, the lite modules resolve each other through globals without require', async () => {
  const bundle = ['src/direct-api-client.js', 'src/versioning.js', ...LITE_ENGINE_MODULES].map(bundledModule).join('\n\n');
  const sandbox = vm.createContext({});
  vm.runInContext(bundle, sandbox, { filename: 'lite-bundle.js' });
  for (const name of Object.values(GLOBALS)) assert.equal(typeof sandbox[name], 'object', name);
  assert.equal(vm.runInContext('typeof require', sandbox), 'undefined');

  const stateClient = sandbox.ReviveRelayLiteStateClient.createStateClient({
    baseUrl: 'https://reviverelay.voidsmithindustries.com/review',
    request: async () => ({ status: 401, body: { error: 'AUTH_REQUIRED' } })
  });
  await assert.rejects(stateClient.getState(), error => error.name === 'DirectApiClientError' && error.code === 'AUTH_REQUIRED');

  const clock = createFakeTimers();
  const document = createFakeDocument();
  const values = {};
  const engine = sandbox.ReviveRelayLiteEngine.createLiteEngine({
    api: { getState: async () => ({ notModified: false, snapshot: { stateVersion: '0123456789abcdef', nextPollMs: 60000, me: { roles: ['requester'], verification: { usable: true, requester: true, reviver: false } }, activeRequest: null, activeTransactions: [], revivers: { online: 0 }, queue: null } }) },
    window: createFakeWindow(),
    document,
    storage: { get: (key, fallback) => (key in values ? values[key] : fallback), set: (key, value) => { values[key] = value; } },
    clock
  });
  engine.start();
  await clock.advance(0);
  assert.equal(engine.viewModel().text, 'Revive me');
  assert.ok(document.getElementById('reviverelay-lite-root'));
  engine.stop();
  assert.equal(clock.pending(), 0);
});

test('Lite-core sources carry no comments; their rationale lives in docs/lite/ENGINE-NOTES.md', () => {
  for (const modulePath of [...LITE_ENGINE_MODULES, 'src/platform.js', 'src/direct-api-client.js']) {
    const source = read(modulePath);
    assert.doesNotMatch(source, /^\s*\/\//m, modulePath);
    assert.doesNotMatch(source, /[;{},)\]] \/\/ /, modulePath);
    assert.doesNotMatch(source, /\/\*/, modulePath);
  }
  assert.match(read('docs/lite/ENGINE-NOTES.md'), /^# ReviveRelay Lite engine notes/);
});
