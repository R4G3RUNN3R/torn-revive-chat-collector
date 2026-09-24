(function(root, factory) {
  const api = factory(root && root.ReviveRelayVersioning);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayUpdateManager = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(browserVersioning) {
  'use strict';

  const DAY_MS = 86_400_000;
  const UPDATE_CHECK_MS = 43_200_000;
  const UPDATE_STATE_SOURCE = 'distribution-bound-v2';
  const CHANNELS = Object.freeze(['review', 'stable']);
  const DISTRIBUTION_ORIGIN = 'https://reviverelay.voidsmithindustries.com';
  const PUBLIC_REVIEW_INSTALL_URL = 'https://voidsmithindustries.com/torn/install/reviverelay.user.js';

  function versioning() {
    if (browserVersioning) return browserVersioning;
    if (typeof require === 'function') return require('./versioning');
    throw new Error('ReviveRelay versioning unavailable');
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function validChannel(channel) {
    return CHANNELS.includes(String(channel || ''));
  }

  function distributionUrls(channel) {
    if (!validChannel(channel)) throw new Error('Invalid distribution metadata');
    const base = `${DISTRIBUTION_ORIGIN}/dist/${channel}`;
    return Object.freeze({
      metaUrl: `${base}/ReviveRelay.meta.js`,
      userUrl: `${base}/ReviveRelay.user.js`
    });
  }

  function immutableReleaseUrls(channel, version) {
    if (!validChannel(channel)) throw new Error('Invalid distribution metadata');
    const safeVersion = validateVersion(version);
    const base = `${DISTRIBUTION_ORIGIN}/releases/${channel}/${safeVersion}`;
    return Object.freeze({
      installUrl: `${base}/ReviveRelay-${safeVersion}.user.js`,
      metaUrl: `${base}/ReviveRelay-${safeVersion}.meta.js`
    });
  }

  function validateVersion(value) {
    const normalized = String(value || '').trim();
    const { compareVersions } = versioning();
    compareVersions(normalized, normalized);
    return normalized;
  }

  function metadataValues(header, field) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^//\\s+@${escaped}\\s+(.+?)\\s*$`, 'gm');
    return [...header.matchAll(regex)].map(match => String(match[1] || '').trim());
  }

  function parseDistributionMetadata(input, expectedChannel) {
    try {
      if (!validChannel(expectedChannel) || typeof input !== 'string') throw new Error('invalid');
      const startMarker = '// ==UserScript==';
      const endMarker = '// ==/UserScript==';
      const start = input.indexOf(startMarker);
      const end = input.indexOf(endMarker);
      if (start < 0 || end <= start) throw new Error('invalid');
      const header = input.slice(start, end + endMarker.length);
      const versions = metadataValues(header, 'version');
      const updateUrls = metadataValues(header, 'updateURL');
      const downloadUrls = metadataValues(header, 'downloadURL');
      if (versions.length !== 1 || updateUrls.length !== 1 || downloadUrls.length !== 1) throw new Error('invalid');

      const latestVersion = validateVersion(versions[0]);
      const expected = distributionUrls(expectedChannel);
      const matchesDistribution =
        updateUrls[0] === expected.metaUrl && downloadUrls[0] === expected.userUrl;
      const matchesPublicReviewWrapper =
        expectedChannel === 'review'
        && updateUrls[0] === PUBLIC_REVIEW_INSTALL_URL
        && downloadUrls[0] === PUBLIC_REVIEW_INSTALL_URL;
      if (!matchesDistribution && !matchesPublicReviewWrapper) throw new Error('invalid');

      return Object.freeze({
        latestVersion,
        releaseChannel: expectedChannel,
        install: Object.freeze({
          installUrl: expected.userUrl,
          metaUrl: expected.metaUrl
        }),
        metadataAuthority: matchesPublicReviewWrapper ? 'public-review-wrapper' : 'distribution',
        mandatory: false
      });
    } catch (_) {
      throw new Error('Invalid distribution metadata');
    }
  }

  function userscriptBody(input) {
    const source = String(input || '');
    const marker = '// ==/UserScript==';
    const index = source.indexOf(marker);
    if (index < 0) throw new Error('Invalid distribution metadata');
    return source.slice(index + marker.length);
  }

  function userscriptProvenance(input) {
    const source = String(input || '');
    const commits = [...source.matchAll(/^\/\/ ReviveRelay-Build-Commit:\s*([0-9a-f]{40})\s*$/gm)];
    const timestamps = [...source.matchAll(/^\/\/ ReviveRelay-Build-Timestamp:\s*(\S+)\s*$/gm)];
    if (commits.length !== 1 || timestamps.length !== 1 || Number.isNaN(Date.parse(timestamps[0][1]))) {
      throw new Error('Invalid distribution metadata');
    }
    return Object.freeze({ buildCommit: commits[0][1], buildTimestamp: timestamps[0][1] });
  }

  async function sha256Text(value) {
    if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') {
      throw new Error('SHA-256 unavailable');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function validateDistributionRelease(input, expectedChannel) {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) || !validChannel(expectedChannel)) throw new Error('invalid');
      if (input.releaseChannel !== expectedChannel || input.mandatory !== false) throw new Error('invalid');
      const latestVersion = validateVersion(input.latestVersion);
      const expected = immutableReleaseUrls(expectedChannel, latestVersion);
      if (!input.install || input.install.installUrl !== expected.installUrl || input.install.metaUrl !== expected.metaUrl) throw new Error('invalid');
      if (typeof input.buildCommit !== 'string' || !/^[0-9a-f]{40}$/.test(input.buildCommit)) throw new Error('invalid');
      if (typeof input.buildTimestamp !== 'string' || Number.isNaN(Date.parse(input.buildTimestamp))) throw new Error('invalid');
      if (typeof input.bodySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.bodySha256)) throw new Error('invalid');
      return {
        latestVersion,
        releaseChannel: expectedChannel,
        install: { installUrl: expected.installUrl, metaUrl: expected.metaUrl },
        buildCommit: input.buildCommit,
        buildTimestamp: input.buildTimestamp,
        bodySha256: input.bodySha256,
        mandatory: false
      };
    } catch (_) {
      throw new Error('Invalid distribution metadata');
    }
  }

  // Retained for validating immutable server release manifests used by the
  // compatibility boundary and existing security tests. The client updater
  // itself now reads the distribution metadata feed directly.
  function validateManifest(input, expectedChannel = null) {
    const { compareVersions } = versioning();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid manifest');
    for (const key of ['latestVersion', 'minimumVersion', 'buildTimestamp', 'releaseNotes', 'gitCommit', 'releaseChannel', 'sha256', 'apiCompatibility', 'install', 'mandatory']) {
      if (!(key in input)) throw new Error('Invalid manifest');
    }
    compareVersions(input.latestVersion, input.minimumVersion);
    if (compareVersions(input.minimumVersion, input.latestVersion) > 0) throw new Error('Invalid manifest minimum');
    if (!validChannel(input.releaseChannel) || expectedChannel && input.releaseChannel !== expectedChannel) throw new Error('Invalid manifest channel');
    if (typeof input.releaseNotes !== 'string' || input.releaseNotes.length > 4000 || typeof input.buildTimestamp !== 'string' || Number.isNaN(Date.parse(input.buildTimestamp)) || typeof input.gitCommit !== 'string' || !/^[0-9a-f]{40}$/.test(input.gitCommit) || typeof input.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.sha256) || typeof input.mandatory !== 'boolean') throw new Error('Invalid manifest');
    const expectedReleaseBase = `${DISTRIBUTION_ORIGIN}/releases/${input.releaseChannel}/${input.latestVersion}`;
    if (!input.install || input.install.installUrl !== `${expectedReleaseBase}/ReviveRelay-${input.latestVersion}.user.js` || input.install.metaUrl !== `${expectedReleaseBase}/ReviveRelay-${input.latestVersion}.meta.js`) throw new Error('Invalid manifest');
    if (!input.apiCompatibility || !Number.isInteger(input.apiCompatibility.minimum) || !Number.isInteger(input.apiCompatibility.current) || input.apiCompatibility.current < input.apiCompatibility.minimum) throw new Error('Invalid manifest');
    return clone(input);
  }

  function createUpdateManager({ currentVersion, channel, fetchText, getState, saveState, now = Date.now, openUrl }) {
    const { compareVersions } = versioning();
    validateVersion(currentVersion);
    if (!validChannel(channel) || typeof fetchText !== 'function' || typeof getState !== 'function' || typeof saveState !== 'function' || typeof openUrl !== 'function') {
      throw new Error('Update manager dependencies are required');
    }
    const urls = distributionUrls(channel);

    function read() {
      const value = getState();
      return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
    }

    function validatedStoredRelease(state) {
      if (!state || state.source !== UPDATE_STATE_SOURCE || !state.lastManifest) return null;
      try {
        return validateDistributionRelease(state.lastManifest, channel);
      } catch (_) {
        return null;
      }
    }

    function write(state) {
      let release = null;
      if (state.lastManifest) {
        try { release = validateDistributionRelease(state.lastManifest, channel); } catch (_) {}
      }
      const next = {
        source: UPDATE_STATE_SOURCE,
        lastCheckedAt: Number(state.lastCheckedAt || 0),
        lastManifest: release ? clone(release) : null,
        dismissedVersion: state.dismissedVersion || null
      };
      saveState(next);
      return next;
    }

    function describe(release, state, extra = {}) {
      if (!release) return { updateAvailable: false, mandatory: false, supported: true, ...extra };
      const updateAvailable = compareVersions(release.latestVersion, currentVersion) > 0;
      const dismissed = Boolean(updateAvailable && state.dismissedVersion === release.latestVersion);
      return {
        manifest: clone(release),
        latestVersion: release.latestVersion,
        minimumVersion: null,
        updateAvailable,
        mandatory: false,
        supported: true,
        dismissed,
        ...extra
      };
    }

    async function check({ force = false } = {}) {
      let state = read();
      const timestamp = Number(now());
      const previous = validatedStoredRelease(state);
      const canThrottle = state.source === UPDATE_STATE_SOURCE && Number.isFinite(state.lastCheckedAt) && state.lastCheckedAt > 0;
      if (!force && canThrottle && timestamp - Number(state.lastCheckedAt) < UPDATE_CHECK_MS) {
        return describe(previous, state, { skipped: true, lastCheckedAt: Number(state.lastCheckedAt) });
      }

      try {
        const discovered = parseDistributionMetadata(await fetchText(urls.metaUrl), channel);
        const mutableArtifact = await fetchText(urls.userUrl);
        const mutableIdentity = parseDistributionMetadata(mutableArtifact, channel);
        const immutable = immutableReleaseUrls(channel, discovered.latestVersion);
        const immutableArtifact = await fetchText(immutable.installUrl);
        const immutableIdentity = parseDistributionMetadata(immutableArtifact, channel);

        if (mutableIdentity.latestVersion !== discovered.latestVersion
            || immutableIdentity.latestVersion !== discovered.latestVersion) {
          throw new Error('Distribution version mismatch');
        }

        const mutableProvenance = userscriptProvenance(mutableArtifact);
        const immutableProvenance = userscriptProvenance(immutableArtifact);
        if (mutableProvenance.buildCommit !== immutableProvenance.buildCommit
            || mutableProvenance.buildTimestamp !== immutableProvenance.buildTimestamp) {
          throw new Error('Distribution provenance mismatch');
        }

        const mutableBody = userscriptBody(mutableArtifact);
        const immutableBody = userscriptBody(immutableArtifact);
        const [mutableBodySha256, immutableBodySha256] = await Promise.all([
          sha256Text(mutableBody),
          sha256Text(immutableBody)
        ]);
        if (mutableBody !== immutableBody || mutableBodySha256 !== immutableBodySha256) {
          throw new Error('Distribution executable mismatch');
        }

        const release = validateDistributionRelease({
          latestVersion: discovered.latestVersion,
          releaseChannel: channel,
          install: immutable,
          buildCommit: immutableProvenance.buildCommit,
          buildTimestamp: immutableProvenance.buildTimestamp,
          bodySha256: immutableBodySha256,
          mandatory: false
        }, channel);
        if (state.dismissedVersion && state.dismissedVersion !== release.latestVersion) state.dismissedVersion = null;
        state = write({ ...state, lastCheckedAt: timestamp, lastManifest: release });
        return describe(release, state, { skipped: false, lastCheckedAt: timestamp });
      } catch (_) {
        state = write({ ...state, lastCheckedAt: timestamp, lastManifest: previous });
        return describe(previous, state, {
          error: 'UPDATE_CHECK_FAILED',
          skipped: false,
          lastCheckedAt: timestamp
        });
      }
    }

    function dismiss(version) {
      let state = read();
      const release = validatedStoredRelease(state);
      if (!release || release.latestVersion !== version || compareVersions(release.latestVersion, currentVersion) <= 0) return false;
      state = write({ ...state, dismissedVersion: version });
      return Boolean(state.dismissedVersion === version);
    }

    function openUpdate() {
      const state = read();
      const release = validatedStoredRelease(state);
      if (!release || compareVersions(release.latestVersion, currentVersion) <= 0) return false;
      return openUrl(release.install.installUrl) === true;
    }

    return Object.freeze({ check, dismiss, openUpdate, getState: read });
  }

  return Object.freeze({
    DAY_MS,
    UPDATE_CHECK_MS,
    UPDATE_STATE_SOURCE,
    PUBLIC_REVIEW_INSTALL_URL,
    distributionUrls,
    immutableReleaseUrls,
    parseDistributionMetadata,
    validateManifest,
    createUpdateManager
  });
});
