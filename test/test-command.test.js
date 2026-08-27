const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('supported client test command builds generated release artifacts before tests run', () => {
  assert.equal(pkg.scripts['pretest:client'], 'npm run build');
});
