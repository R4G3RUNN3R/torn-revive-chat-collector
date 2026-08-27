const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, isNewer } = require('../src/versioning');

test('strict numeric version comparison', () => {
  assert.equal(compareVersions('0.4.0','0.4.0'),0);
  assert.equal(compareVersions('0.4.10','0.4.9'),1);
  assert.equal(compareVersions('1.0.0','0.99.99'),1);
  assert.equal(compareVersions('0.3.9','0.4.0'),-1);
  assert.equal(isNewer('0.5.0','0.4.9'),true);
  assert.throws(() => compareVersions('latest','0.4.0'), /version/i);
  assert.throws(() => compareVersions('0.4','0.4.0'), /version/i);
});
