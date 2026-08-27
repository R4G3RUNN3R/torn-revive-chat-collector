const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const releaseClient = require('../scripts/release-client');

function currentCommit() {
  return cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

test('release validation accepts self-contained artifacts, rejects runtime @require, and rejects stale build provenance', () => {
  assert.equal(typeof releaseClient.validatePinnedArtifacts, 'function');
  const auto = fs.readFileSync('dist/reviverelay-auto.user.js', 'utf8');
  const manual = fs.readFileSync('dist/reviverelay-manual.user.js', 'utf8');
  const meta = fs.readFileSync('dist/reviverelay-auto.meta.js', 'utf8');
  const head = currentCommit();

  const validated = releaseClient.validatePinnedArtifacts({
    artifactTexts: [auto, manual, meta],
    expectedCommit: head
  });
  assert.equal(validated.commit, head);
  assert.equal(validated.dependencies.length, 10);

  const withRuntimeRequire = auto.replace(
    '// @run-at       document-idle',
    '// @require      https://raw.githubusercontent.com/example/dependency.js\n// @run-at       document-idle'
  );
  assert.throws(() => releaseClient.validatePinnedArtifacts({
    artifactTexts: [withRuntimeRequire, manual, meta],
    expectedCommit: head
  }), /self-contained|@require|external/i);

  assert.throws(() => releaseClient.validatePinnedArtifacts({
    artifactTexts: [auto, manual, meta],
    expectedCommit: 'f'.repeat(40)
  }), /stale|commit|provenance/i);
});

test('release verification still compares all ten GitHub source modules byte-for-byte with committed local source', async () => {
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
  assert.equal(requested.length, 10);

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

test('release validation rejects an executable artifact whose embedded support-module bytes were altered', () => {
  const auto = fs.readFileSync('dist/reviverelay-auto.user.js', 'utf8');
  const head = currentCommit();
  const start = '/* ReviveRelay bundled module: src/core.js */\n';
  assert.ok(auto.includes(start));
  const corrupted = auto.replace(start, `${start}// injected corruption\n`);
  assert.throws(() => releaseClient.validatePinnedArtifacts({
    artifactTexts: [corrupted],
    expectedCommit: head
  }), /bundled|embedded|mismatch|bytes/i);
});
