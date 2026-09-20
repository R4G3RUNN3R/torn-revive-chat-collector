const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, isNewer, parseVersion } = require('../src/versioning');

test('strict single-digit numeric version comparison', () => {
  assert.equal(compareVersions('0.4.0','0.4.0'),0);
  assert.equal(compareVersions('0.7.0','0.6.9'),1);
  assert.equal(compareVersions('1.0.0','0.9.9'),1);
  assert.equal(compareVersions('0.3.9','0.4.0'),-1);
  assert.equal(isNewer('0.5.0','0.4.9'),true);
  assert.deepEqual(parseVersion('9.9.9'),[9,9,9]);
  assert.throws(() => compareVersions('latest','0.4.0'), /version/i);
  assert.throws(() => compareVersions('0.4','0.4.0'), /version/i);
});

test('Voidsmith version policy rejects any component above 9', () => {
  for (const invalid of ['0.6.10','3.4.10','1.2.11','10.0.0','0.10.0','0.0.10','0.07.0','00.7.0']) {
    assert.throws(() => parseVersion(invalid), /above 9|version/i, invalid);
  }
});
