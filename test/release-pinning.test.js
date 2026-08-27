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

test('tracked userscript templates every support dependency and telemetry build provenance from one immutable Git commit marker', () => {
  const source = fs.readFileSync('torn-revive-chat-collector.user.js', 'utf8');
  const rows = requireRows(source);
  assert.equal(rows.length, REQUIRED.length);
  assert.doesNotMatch(source, /raw\.githubusercontent\.com\/R4G3RUNN3R\/torn-revive-chat-collector\/main\//);
  for (const relativePath of REQUIRED) {
    assert.ok(rows.includes(`https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/__REVIVERELAY_GIT_COMMIT__/${relativePath}`));
  }
  assert.match(source, /const BUILD_COMMIT = '__REVIVERELAY_GIT_COMMIT__';/);
  assert.match(source, /buildCommit:\s*BUILD_COMMIT/);
});

test('built userscripts pin every support dependency and telemetry provenance to one 40-hex commit', () => {
  for (const filename of ['dist/reviverelay-auto.user.js', 'dist/reviverelay-manual.user.js']) {
    const text = fs.readFileSync(filename, 'utf8');
    const rows = requireRows(text);
    assert.equal(rows.length, REQUIRED.length);
    assert.doesNotMatch(text, /\/main\/src\//);
    const commits = new Set();
    for (const row of rows) {
      const match = row.match(/^https:\/\/raw\.githubusercontent\.com\/R4G3RUNN3R\/torn-revive-chat-collector\/([0-9a-f]{40})\/(src\/.+)$/);
      assert.ok(match, `dependency is not immutable: ${row}`);
      assert.ok(REQUIRED.includes(match[2]), `unexpected support module: ${match[2]}`);
      commits.add(match[1]);
    }
    assert.equal(commits.size, 1);
    const commit = [...commits][0];
    assert.match(text, new RegExp(`const BUILD_COMMIT = '${commit}';`));
    assert.match(text, /buildCommit:\s*BUILD_COMMIT/);
  }
});
