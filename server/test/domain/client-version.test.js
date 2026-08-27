const test = require('node:test');
const assert = require('node:assert/strict');
const { parseClientVersion, compareClientVersions, meetsMinimum, validateReleaseManifest } = require('../../src/domain/client-version');

const valid = {
  latestVersion:'0.4.0', minimumVersion:'0.3.0', releasedAt:'2026-08-26T12:00:00.000Z',
  releaseNotes:'Payment verification improvements.', gitCommit:'0'.repeat(40),
  automatic:{installUrl:'https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.user.js',metaUrl:'https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.meta.js',sha256:'a'.repeat(64)},
  manual:{installUrl:'https://reviverelay.voidsmithindustries.com/install/reviverelay-manual.user.js',sha256:'b'.repeat(64)}, mandatory:false
};

test('server client version semantics are strict numeric triples', () => {
  assert.deepEqual(parseClientVersion('0.4.10'), [0,4,10]);
  assert.equal(compareClientVersions('0.4.10','0.4.9'),1);
  assert.equal(meetsMinimum('0.4.0','0.4.0'),true);
  assert.equal(meetsMinimum('0.3.9','0.4.0'),false);
  assert.throws(() => parseClientVersion('v0.4.0'), /version/i);
});

test('validates the exact public release manifest contract', () => {
  const result = validateReleaseManifest(valid);
  assert.deepEqual(result, valid);
  assert.throws(() => validateReleaseManifest({...valid, extra:'nope'}), /manifest/i);
  assert.throws(() => validateReleaseManifest({...valid, minimumVersion:'0.5.0'}), /minimum/i);
  assert.throws(() => validateReleaseManifest({...valid, gitCommit:'bad'}), /commit/i);
  assert.throws(() => validateReleaseManifest({...valid, automatic:{...valid.automatic, sha256:'bad'}}), /sha/i);
  assert.throws(() => validateReleaseManifest({...valid, releaseNotes:'x'.repeat(4001)}), /notes/i);
  assert.throws(() => validateReleaseManifest({...valid, releasedAt:'not-a-date'}), /released/i);
});
