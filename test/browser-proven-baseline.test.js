const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const fixturePath = path.resolve(__dirname, 'fixtures/client/reviverelay-0.4.5-from-0.4.2.user.txt');
const manifestPath = path.resolve(__dirname, 'fixtures/client/reviverelay-0.4.5-baseline.json');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('browser-proven 0.4.5 artifact remains byte-for-byte frozen', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(sha256(fixturePath), 'fbfc6a27395b5d3cfa7bd0b3ebcab96e4be856d71d9772881e127eebb848fee9');
  assert.equal(manifest.artifactSha256, 'fbfc6a27395b5d3cfa7bd0b3ebcab96e4be856d71d9772881e127eebb848fee9');
  const text = fs.readFileSync(fixturePath, 'utf8');
  assert.match(text, /@version\s+0\.4\.5/);
  assert.match(text, /Shared public chat requests/);
  assert.match(text, /fetchRecentPublicCandidates/);
});
