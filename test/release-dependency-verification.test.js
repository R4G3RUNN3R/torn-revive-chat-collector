const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const releaseClient = require('../scripts/release-client');

function currentCommit() {
  return cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

test('release validation rejects moving dependency refs and stale build provenance', () => {
  assert.equal(typeof releaseClient.validatePinnedArtifacts, 'function');
  const auto = fs.readFileSync('dist/reviverelay-auto.user.js', 'utf8');
  const manual = fs.readFileSync('dist/reviverelay-manual.user.js', 'utf8');
  const meta = fs.readFileSync('dist/reviverelay-auto.meta.js', 'utf8');
  const head = currentCommit();

  assert.doesNotThrow(() => releaseClient.validatePinnedArtifacts({
    artifactTexts: [auto, manual, meta],
    expectedCommit: head
  }));

  const moving = auto.replace(`/${head}/src/core.js`, '/main/src/core.js');
  assert.throws(() => releaseClient.validatePinnedArtifacts({
    artifactTexts: [moving, manual, meta],
    expectedCommit: head
  }), /immutable|pinned|commit/i);

  assert.throws(() => releaseClient.validatePinnedArtifacts({
    artifactTexts: [auto, manual, meta],
    expectedCommit: 'f'.repeat(40)
  }), /stale|commit/i);
});

test('release verification compares every pinned GitHub dependency byte-for-byte with its local committed source', async () => {
  assert.equal(typeof releaseClient.verifyPinnedDependencyBytes, 'function');
  const auto = fs.readFileSync('dist/reviverelay-auto.user.js', 'utf8');
  const head = currentCommit();
  const validated = releaseClient.validatePinnedArtifacts({ artifactTexts: [auto], expectedCommit: head });
  const requested = [];

  await assert.doesNotReject(() => releaseClient.verifyPinnedDependencyBytes({
    dependencies: validated.dependencies,
    fetchImpl: async url => {
      requested.push(url);
      const dependency = validated.dependencies.find(item => item.url === url);
      return {
        ok: true,
        status: 200,
        async arrayBuffer() { return fs.readFileSync(dependency.relativePath); }
      };
    }
  }));
  assert.equal(requested.length, validated.dependencies.length);

  let changedOne = false;
  await assert.rejects(() => releaseClient.verifyPinnedDependencyBytes({
    dependencies: validated.dependencies,
    fetchImpl: async url => {
      const dependency = validated.dependencies.find(item => item.url === url);
      const local = fs.readFileSync(dependency.relativePath);
      if (!changedOne) {
        changedOne = true;
        return { ok: true, status: 200, async arrayBuffer() { return Buffer.concat([local, Buffer.from('\nchanged')]); } };
      }
      return { ok: true, status: 200, async arrayBuffer() { return local; } };
    }
  }), /mismatch|bytes|sha-256/i);
});
