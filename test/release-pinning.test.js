const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const REQUIRED = [
  'src/core.js',
  'src/chat-dom.js',
  'src/public-channels.js',
  'src/client-chat-policy.js',
  'src/api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/revive-classifier.js',
  'src/candidate-pipeline.js'
];

function requireRows(text) {
  return [...text.matchAll(/^\/\/ @require\s+(\S+)$/gm)].map(match => match[1]);
}

function marker(relativePath) {
  return `/* ReviveRelay bundled module: ${relativePath} */`;
}

test('tracked userscript is a self-contained release template with build provenance and no runtime @require dependencies', () => {
  const source = fs.readFileSync('torn-revive-chat-collector.user.js', 'utf8');
  assert.equal(requireRows(source).length, 0);
  assert.match(source, /ReviveRelay-Build-Commit:\s*__REVIVERELAY_GIT_COMMIT__/);
  assert.match(source, /const BUILD_COMMIT = '__REVIVERELAY_GIT_COMMIT__';/);
  assert.match(source, /buildCommit:\s*BUILD_COMMIT/);
});

test('built userscripts embed all support modules and have zero external @require dependencies', () => {
  for (const filename of ['dist/reviverelay-auto.user.js', 'dist/reviverelay-manual.user.js']) {
    const text = fs.readFileSync(filename, 'utf8');
    assert.equal(requireRows(text).length, 0, `${filename} must not depend on external @require loading`);
    const commit = text.match(/ReviveRelay-Build-Commit:\s*([0-9a-f]{40})/)?.[1];
    assert.ok(commit, `${filename} must carry immutable build provenance`);
    assert.match(text, new RegExp(`const BUILD_COMMIT = '${commit}';`));
    assert.match(text, /buildCommit:\s*BUILD_COMMIT/);
    for (const relativePath of REQUIRED) {
      assert.equal(text.split(marker(relativePath)).length - 1, 1, `${relativePath} must be bundled exactly once`);
    }
  }
});

test('automatic metadata contains no executable dependency URLs and keeps immutable build provenance', () => {
  const meta = fs.readFileSync('dist/reviverelay-auto.meta.js', 'utf8');
  assert.equal(requireRows(meta).length, 0);
  assert.match(meta, /ReviveRelay-Build-Commit:\s*[0-9a-f]{40}/);
  assert.doesNotMatch(meta, /raw\.githubusercontent\.com/);
});
