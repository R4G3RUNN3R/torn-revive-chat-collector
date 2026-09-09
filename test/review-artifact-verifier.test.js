const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildChannelArtifact } = require('../scripts/build');

const root = path.resolve(__dirname, '..');

test('immutable review verifier accepts the exact pinned candidate and rejects byte or provenance drift', () => {
  const { verifyReviewArtifactData } = require('../scripts/verify-review-artifact');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/review/BUILD-MANIFEST.json'), 'utf8'));
  const built = buildChannelArtifact('review', {
    gitCommit: manifest.artifactSourceCommit,
    buildTimestamp: manifest.buildTimestamp,
    write: false
  });
  const artifact = Buffer.from(built.artifact);
  const meta = built.meta;

  const verified = verifyReviewArtifactData({ manifest, artifact, meta, version: require('../package.json').version });
  assert.equal(verified.commit, manifest.artifactSourceCommit);
  assert.equal(verified.sha256, manifest.sha256);

  assert.throws(() => verifyReviewArtifactData({
    manifest,
    artifact: Buffer.concat([artifact, Buffer.from('\n')]),
    meta,
    version: require('../package.json').version
  }), /sha-?256|hash|size/i);

  assert.throws(() => verifyReviewArtifactData({
    manifest: { ...manifest, artifactSourceCommit: 'f'.repeat(40) },
    artifact,
    meta,
    version: require('../package.json').version
  }), /commit|provenance|stale/i);
});

test('filesystem verifier rejects a non-canonical manifest artifact path before reading it', () => {
  const { verifyReviewArtifact } = require('../scripts/verify-review-artifact');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reviverelay-review-verify-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'docs/review'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ version: '0.6.1' }));
    fs.writeFileSync(path.join(tempRoot, 'docs/review/BUILD-MANIFEST.json'), JSON.stringify({
      product: 'ReviveRelay',
      version: '0.6.1',
      channel: 'review',
      artifact: '../../etc/passwd',
      artifactSourceCommit: 'a'.repeat(40),
      buildTimestamp: '2026-09-08T10:14:47.250Z',
      sha256: 'b'.repeat(64),
      sizeBytes: 1,
      updateUrl: 'https://reviverelay.voidsmithindustries.com/releases/review/0.6.1/ReviveRelay-0.6.1.meta.js',
      downloadUrl: 'https://reviverelay.voidsmithindustries.com/releases/review/0.6.1/ReviveRelay-0.6.1.user.js'
    }));
    assert.throws(() => verifyReviewArtifact(tempRoot), /artifact path mismatch/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
