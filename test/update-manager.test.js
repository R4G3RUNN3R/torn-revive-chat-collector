const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUpdateManager,
  parseDistributionMetadata,
  distributionUrls,
  immutableReleaseUrls,
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
  return '// ==UserScript==\n'
    + '// @name         ReviveRelay\n'
    + '// @version      ' + version + '\n'
    + (duplicateVersion ? '// @version      ' + version + '\n' : '')
    + '// @updateURL    ' + (updateUrl || urls.metaUrl) + '\n'
    + '// @downloadURL  ' + (downloadUrl || urls.userUrl) + '\n'
    + '// ==/UserScript==\n';
}

function artifact({
  version = '0.6.8',
  channel = 'review',
  publicWrapperMetadata = false,
  commit = 'a'.repeat(40),
  timestamp = '2026-09-24T12:00:00.000Z',
  body = '\nconsole.log("reviverelay");\n'
} = {}) {
  const urls = distributionUrls(channel);
  const wrapper = 'https://voidsmithindustries.com/torn/install/reviverelay.user.js';
  return '// ==UserScript==\n'
    + '// @name         ReviveRelay\n'
    + '// @version      ' + version + '\n'
    + '// @updateURL    ' + (publicWrapperMetadata ? wrapper : urls.metaUrl) + '\n'
    + '// @downloadURL  ' + (publicWrapperMetadata ? wrapper : urls.userUrl) + '\n'
    + '// ReviveRelay-Build-Commit: ' + commit + '\n'
    + '// ReviveRelay-Build-Timestamp: ' + timestamp + '\n'
    + '// ==/UserScript==' + body;
}

function boundFetch({
  version = '0.6.8',
  body = '\nconsole.log("reviverelay");\n',
  immutableBody = body,
  publicWrapperMetadata = true
} = {}) {
  const urls = distributionUrls('review');
  const immutable = immutableReleaseUrls('review', version);
  return async url => {
    if (url === urls.metaUrl) {
      return meta({
        version,
        updateUrl: publicWrapperMetadata
          ? 'https://voidsmithindustries.com/torn/install/reviverelay.user.js'
          : urls.metaUrl,
        downloadUrl: publicWrapperMetadata
          ? 'https://voidsmithindustries.com/torn/install/reviverelay.user.js'
          : urls.userUrl
      });
    }
    if (url === urls.userUrl) return artifact({ version, publicWrapperMetadata, body });
    if (url === immutable.installUrl) return artifact({ version, publicWrapperMetadata: false, body: immutableBody });
    throw new Error('unexpected fetch ' + url);
  };
}

test('distribution metadata accepts canonical dist metadata and the exact public review wrapper metadata', () => {
  const parsed = parseDistributionMetadata(meta(), 'review');
  assert.equal(parsed.latestVersion, '0.6.8');
  assert.equal(parsed.releaseChannel, 'review');
  assert.deepEqual(parsed.install, {
    installUrl: 'https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.user.js',
    metaUrl: 'https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.meta.js'
  });

  const wrapper = 'https://voidsmithindustries.com/torn/install/reviverelay.user.js';
  const live = parseDistributionMetadata(meta({ updateUrl: wrapper, downloadUrl: wrapper }), 'review');
  assert.equal(live.latestVersion, '0.6.8');
  assert.equal(live.metadataAuthority, 'public-review-wrapper');
});

test('distribution metadata rejects off-origin, cross-channel, duplicate and malformed values', () => {
  assert.throws(() => parseDistributionMetadata(meta({ downloadUrl: 'https://evil.example/ReviveRelay.user.js' }), 'review'), /Invalid distribution metadata/);
  assert.throws(() => parseDistributionMetadata(meta({ channel: 'stable' }), 'review'), /Invalid distribution metadata/);
  assert.throws(() => parseDistributionMetadata(meta({ duplicateVersion: true }), 'review'), /Invalid distribution metadata/);
  assert.throws(() => parseDistributionMetadata(meta({ version: 'banana' }), 'review'), /Invalid distribution metadata/);
  assert.throws(() => parseDistributionMetadata(meta({
    updateUrl: 'https://voidsmithindustries.com/anything-else.user.js',
    downloadUrl: 'https://voidsmithindustries.com/anything-else.user.js'
  }), 'review'), /Invalid distribution metadata/);
});

test('checks bind mutable distribution bytes to the immutable versioned release and throttle for 12 hours', async () => {
  let fetches = 0;
  let state = {};
  let now = UPDATE_CHECK_MS + 1;
  const requested = [];
  const fetcher = boundFetch();
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: async url => {
      fetches += 1;
      requested.push(url);
      return fetcher(url);
    },
    getState: () => state,
    saveState: value => { state = value; },
    now: () => now,
    openUrl: () => true
  });

  const first = await manager.check();
  assert.equal(first.updateAvailable, true);
  assert.equal(first.latestVersion, '0.6.8');
  assert.equal(fetches, 3);
  assert.deepEqual(requested, [
    'https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.meta.js',
    'https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.user.js',
    'https://reviverelay.voidsmithindustries.com/releases/review/0.6.8/ReviveRelay-0.6.8.user.js'
  ]);
  assert.equal(state.source, 'distribution-bound-v2');
  assert.equal(state.lastManifest.install.installUrl, 'https://reviverelay.voidsmithindustries.com/releases/review/0.6.8/ReviveRelay-0.6.8.user.js');
  assert.match(state.lastManifest.bodySha256, /^[0-9a-f]{64}$/);

  now += UPDATE_CHECK_MS - 1;
  const skipped = await manager.check();
  assert.equal(skipped.skipped, true);
  assert.equal(fetches, 3);

  now += 2;
  const second = await manager.check();
  assert.equal(second.skipped, false);
  assert.equal(fetches, 6);
});

test('first bound check ignores legacy update throttle state', async () => {
  let fetches = 0;
  let state = { source: 'distribution-meta-v1', lastCheckedAt: Date.now(), lastManifest: { latestVersion: '0.6.7' } };
  const fetcher = boundFetch();
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: async url => { fetches += 1; return fetcher(url); },
    getState: () => state,
    saveState: value => { state = value; },
    now: () => Date.now(),
    openUrl: () => true
  });

  const result = await manager.check();
  assert.equal(result.updateAvailable, true);
  assert.equal(fetches, 3);
  assert.equal(state.source, 'distribution-bound-v2');
});

test('forced checks bypass the 12-hour throttle', async () => {
  let fetches = 0;
  let state = {};
  let now = UPDATE_CHECK_MS + 1;
  const fetcher = boundFetch();
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: async url => { fetches += 1; return fetcher(url); },
    getState: () => state,
    saveState: value => { state = value; },
    now: () => now,
    openUrl: () => true
  });

  await manager.check();
  now += 10;
  await manager.check({ force: true });
  assert.equal(fetches, 6);
});

test('network failures preserve a previously bound update', async () => {
  let state = {};
  let fail = false;
  let now = UPDATE_CHECK_MS + 1;
  const fetcher = boundFetch();
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: async url => {
      if (fail) throw new Error('offline');
      return fetcher(url);
    },
    getState: () => state,
    saveState: value => { state = value; },
    now: () => now,
    openUrl: () => true
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

test('check fails closed when mutable distribution executable differs from immutable release', async () => {
  let state = {};
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: boundFetch({ immutableBody: '\nconsole.log("different");\n' }),
    getState: () => state,
    saveState: value => { state = value; },
    now: () => UPDATE_CHECK_MS + 1,
    openUrl: () => true
  });

  const result = await manager.check({ force: true });
  assert.equal(result.error, 'UPDATE_CHECK_FAILED');
  assert.equal(result.updateAvailable, false);
  assert.equal(manager.openUpdate(), false);
});

test('openUpdate opens only the bound immutable release installer', async () => {
  let state = {};
  const opened = [];
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: boundFetch(),
    getState: () => state,
    saveState: value => { state = value; },
    now: () => UPDATE_CHECK_MS + 1,
    openUrl: url => { opened.push(url); return true; }
  });

  await manager.check({ force: true });
  assert.equal(manager.openUpdate(), true);
  assert.deepEqual(opened, ['https://reviverelay.voidsmithindustries.com/releases/review/0.6.8/ReviveRelay-0.6.8.user.js']);

  state.lastManifest.install.installUrl = 'https://evil.example/ReviveRelay.user.js';
  assert.equal(manager.openUpdate(), false);
  assert.equal(opened.length, 1);
});

test('openUpdate reports failure when the exact installer cannot be opened', async () => {
  let state = {};
  const manager = createUpdateManager({
    currentVersion: '0.6.7',
    channel: 'review',
    fetchText: boundFetch(),
    getState: () => state,
    saveState: value => { state = value; },
    now: () => UPDATE_CHECK_MS + 1,
    openUrl: () => false
  });

  await manager.check({ force: true });
  assert.equal(manager.openUpdate(), false);
});

test('openUpdate does nothing when the bound release is already installed', async () => {
  let state = {};
  const opened = [];
  const manager = createUpdateManager({
    currentVersion: '0.6.8',
    channel: 'review',
    fetchText: boundFetch({ version: '0.6.8' }),
    getState: () => state,
    saveState: value => { state = value; },
    now: () => UPDATE_CHECK_MS + 1,
    openUrl: url => { opened.push(url); return true; }
  });

  await manager.check({ force: true });
  assert.equal(manager.openUpdate(), false);
  assert.deepEqual(opened, []);
});
