const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validatePinnedArtifacts } = require('./release-client');
const { distributionUrls } = require('./build');

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function metadataValue(text, name) {
  const match = String(text || '').match(new RegExp(`^//\\s*@${name}\\s+([^\\s]+)\\s*$`, 'm'));
  return match ? match[1] : null;
}

function buildTimestampValue(text) {
  const match = String(text || '').match(/^\/\/ ReviveRelay-Build-Timestamp:\s*(\S+)\s*$/m);
  return match ? match[1] : null;
}

function validateReviewManifest(manifest, version) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Review build manifest is required');
  }
  if (manifest.product !== 'ReviveRelay') throw new Error('Review build manifest product mismatch');
  if (manifest.version !== version) throw new Error('Review build manifest version mismatch');
  if (manifest.channel !== 'review') throw new Error('Review build manifest channel mismatch');

  const artifactPath = `dist/review/ReviveRelay-${version}.user.js`;
  if (manifest.artifact !== artifactPath) throw new Error('Review build manifest artifact path mismatch');

  const commit = String(manifest.artifactSourceCommit || '');
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Review build manifest has invalid artifact source commit');
  const sha256 = String(manifest.sha256 || '');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Review build manifest has invalid SHA-256');
  const buildTimestamp = String(manifest.buildTimestamp || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(buildTimestamp) || Number.isNaN(Date.parse(buildTimestamp))) {
    throw new Error('Review build manifest has invalid build timestamp');
  }
  if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes < 1) {
    throw new Error('Review build manifest has invalid artifact size');
  }

  const urls = distributionUrls('review');
  if (manifest.updateUrl !== urls.updateUrl || manifest.downloadUrl !== urls.downloadUrl) {
    throw new Error('Review build manifest URL mismatch');
  }

  return Object.freeze({ artifactPath, commit, sha256, buildTimestamp, sizeBytes: manifest.sizeBytes, urls });
}

function verifyReviewArtifactData({ manifest, artifact, meta, version }) {
  const expected = validateReviewManifest(manifest, version);
  const artifactBuffer = Buffer.isBuffer(artifact) ? artifact : Buffer.from(String(artifact || ''));
  const artifactText = artifactBuffer.toString('utf8');
  const metaText = String(meta || '');
  const actualHash = sha256Buffer(artifactBuffer);
  if (actualHash !== expected.sha256) throw new Error(`Review artifact SHA-256 mismatch: ${actualHash}`);
  if (expected.sizeBytes !== artifactBuffer.length) throw new Error('Review artifact size mismatch');

  const pinned = validatePinnedArtifacts({ artifactTexts: [artifactText, metaText], expectedCommit: expected.commit });
  for (const [label, text] of [['artifact', artifactText], ['metadata', metaText]]) {
    if (metadataValue(text, 'version') !== version) throw new Error(`Review ${label} version mismatch`);
    if (metadataValue(text, 'updateURL') !== manifest.updateUrl) throw new Error(`Review ${label} update URL mismatch`);
    if (metadataValue(text, 'downloadURL') !== manifest.downloadUrl) throw new Error(`Review ${label} download URL mismatch`);
    if (buildTimestampValue(text) !== expected.buildTimestamp) throw new Error(`Review ${label} build timestamp mismatch`);
  }

  return Object.freeze({
    commit: pinned.commit,
    sha256: actualHash,
    sizeBytes: artifactBuffer.length,
    buildTimestamp: expected.buildTimestamp
  });
}

function verifyReviewArtifact(root = path.resolve(__dirname, '..')) {
  const packageVersion = require(path.join(root, 'package.json')).version;
  const manifestPath = path.join(root, 'docs/review/BUILD-MANIFEST.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expected = validateReviewManifest(manifest, packageVersion);
  const artifactPath = path.join(root, expected.artifactPath);
  const metaPath = path.join(root, 'dist/review', `ReviveRelay-${packageVersion}.meta.js`);
  const artifact = fs.readFileSync(artifactPath);
  const meta = fs.readFileSync(metaPath, 'utf8');
  return verifyReviewArtifactData({ manifest, artifact, meta, version: packageVersion });
}

if (require.main === module) {
  try {
    const result = verifyReviewArtifact();
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  sha256Buffer,
  validateReviewManifest,
  verifyReviewArtifactData,
  verifyReviewArtifact
};
