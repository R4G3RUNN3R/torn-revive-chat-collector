const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUpdateManager,
  parseDistributionMetadata,
  distributionUrls,
  UPDATE_CHECK_MS
} = require('../src/update-manager');

function meta({
  version = '0.6.8',
  channel = 'review',
  updateUrl,
  downloadUrl,
  duplicateVersion = false
} = {}) {
  const urls = distributionUrls(channel);
  return `// ==UserScript==\n// @name         ReviveRelay\n// @version      ${version}\n${duplicateVersion ? `// @version      ${version}\n` : ''}// @updateURL    ${updateUrl || urls.metaUrl}\n// @downloadURL  ${downloadUrl || urls.userUrl}\n// ==/UserScript==\n`;
}

test('distribution metadata accepts only the canonical channel-scoped dist URLs', () => {
  const parsed = parseDistributionMetadata(meta(), 'review');
  assert.equal(parsed.latestVersion, '0.6.8');
  assert.equal(parsed.releaseChannel, 'review');
  assert.deepEqual(parsed.install, {
    installUrl: 'https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.user.js',
    metaUrl: 'https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.meta.js'
  });
});

test('distribution metadata rejects off-origin, cross-channel, duplicate and malformed values', () => {
  assert.throws(() => parseDistributionMetadata(meta({ downloadUrl: 'https://evil.example/ReviveRelay.user.js' }), 'review'), /Invalid distribution metadata/);
  assert.throws(() => parseDistributionMetadata(meta({ channel: 'stable' }), 'review'), /Invalid distribution metadata/);
  assert.throws(() => parseDistributionMetadata(meta({ duplicateVersion: true }), 'review'), /Invalid distribution metadata/);
  assert.throws(() => parseDistributionMetadata(meta({ version: 'banana' }), 'review'), /Invalid distribution metadata/);
});

test('automatic checks read the canonical dist metadata at most once every 12 hours', async () => {
  let fetches = 0;
  let state = {};
  let now = UPDATE_CHECK_MS + 1;
  const requested = [];
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: async url => {
      fetches += 1;
      requested.push(url);
      return meta();
    },
    getState: () => state,
    saveState: value => { state = value; },
    now: () => now,
    openUrl: () => {}
  });

  const first = await manager.check();
  assert.equal(first.updateAvailable, true);
  assert.equal(first.latestVersion, '0.6.8');
  assert.equal(fetches, 1);
  assert.deepEqual(requested, ['https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.meta.js']);

  now += UPDATE_CHECK_MS - 1;
  const skipped = await manager.check();
  assert.equal(skipped.skipped, true);
  assert.equal(fetches, 1);

  now += 2;
  const second = await manager.check();
  assert.equal(second.skipped, false);
  assert.equal(fetches, 2);
});

test('first dist-backed check ignores legacy backend-manifest throttle state', async () => {
  let fetches = 0;
  let state = {
    lastCheckedAt: Date.now(),
    lastManifest: { latestVersion: '0.6.7' }
  };
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: async () => { fetches += 1; return meta(); },
    getState: () => state,
    saveState: value => { state = value; },
    now: () => Date.now(),
    openUrl: () => {}
  });

  const result = await manager.check();
  assert.equal(result.updateAvailable, true);
  assert.equal(fetches, 1);
  assert.equal(state.source, 'distribution-meta-v1');
});

test('forced checks bypass the 12-hour throttle', async () => {
  let fetches = 0;
  let state = {};
  let now = UPDATE_CHECK_MS + 1;
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: async () => { fetches += 1; return meta(); },
    getState: () => state,
    saveState: value => { state = value; },
    now: () => now,
    openUrl: () => {}
  });

  await manager.check();
  now += 10;
  await manager.check({ force: true });
  assert.equal(fetches, 2);
});

test('network or metadata failures are bounded and preserve a previously validated update', async () => {
  let state = {};
  let fail = false;
  let now = UPDATE_CHECK_MS + 1;
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: async () => {
      if (fail) throw new Error('offline');
      return meta();
    },
    getState: () => state,
    saveState: value => { state = value; },
    now: () => now,
    openUrl: () => {}
  });

  const first = await manager.check();
  assert.equal(first.updateAvailable, true);
  fail = true;
  now += UPDATE_CHECK_MS + 1;
  const failed = await manager.check();
  assert.equal(failed.error, 'UPDATE_CHECK_FAILED');
  assert.equal(failed.updateAvailable, true);
  assert.equal(failed.latestVersion, '0.6.8');
});

test('openUpdate opens only a validated newer dist userscript for the current channel', async () => {
  let state = {};
  const opened = [];
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: async () => meta(),
    getState: () => state,
    saveState: value => { state = value; },
    now: () => UPDATE_CHECK_MS + 1,
    openUrl: url => { opened.push(url); return true; }
  });

  await manager.check({ force: true });
  assert.equal(manager.openUpdate(), true);
  assert.deepEqual(opened, ['https://voidsmithindustries.com/torn/install/reviverelay.user.js']);

  state.lastManifest.install.installUrl = 'https://evil.example/ReviveRelay.user.js';
  assert.equal(manager.openUpdate(), false);
  assert.equal(opened.length, 1);
});

test('openUpdate reports failure when the trusted installer cannot be opened', async () => {
  let state = {};
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: async () => meta(),
    getState: () => state,
    saveState: value => { state = value; },
    now: () => UPDATE_CHECK_MS + 1,
    openUrl: () => false
  });

  await manager.check({ force: true });
  assert.equal(manager.openUpdate(), false);
});

test('openUpdate does nothing when dist reports the already-installed version', async () => {
  let state = {};
  const opened = [];
  const manager = createUpdateManager({
    currentVersion: '0.6.8',
    channel: 'review',
    fetchText: async () => meta({ version: '0.6.8' }),
    getState: () => state,
    saveState: value => { state = value; },
    now: () => UPDATE_CHECK_MS + 1,
    openUrl: url => opened.push(url)
  });

  await manager.check({ force: true });
  assert.equal(manager.openUpdate(), false);
  assert.deepEqual(opened, []);
});
