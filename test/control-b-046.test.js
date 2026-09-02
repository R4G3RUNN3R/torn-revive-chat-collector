const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const fixture = path.resolve(__dirname, 'fixtures/client/reviverelay-0.4.6-control-b.user.txt');
const manifestPath = path.resolve(__dirname, 'fixtures/client/reviverelay-0.4.6-control-b.json');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('0.4.6 Control B remains the immutable browser rollback baseline', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(sha256(fixture), 'f6fb5a8d2400fdaf225ba11c6988961e12b8b6b0c9cd8f6ab70dc2909aeb6564');
  assert.equal(manifest.buildCommit, 'b98127727936f851e0cf0be2d46397311e751e06');
  assert.equal(manifest.version, '0.4.6');
  assert.equal(manifest.sha256, 'f6fb5a8d2400fdaf225ba11c6988961e12b8b6b0c9cd8f6ab70dc2909aeb6564');
});

const packageJson = require('../package.json');

test('direct-only release boundary starts at package version 0.5.0', () => {
  assert.equal(packageJson.version, '0.5.0');
});
