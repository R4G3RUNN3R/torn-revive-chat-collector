const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('supported client test command builds generated release artifacts before tests run', () => {
  assert.equal(pkg.scripts['pretest:client'], 'npm run build');
  assert.equal(pkg.scripts['test:client'], 'npm run test:client:raw');
});

test('review verification brackets raw checks with immutable verification and cannot trigger client build lifecycles', () => {
  assert.equal(pkg.scripts['test:client:raw'], 'node --test test');
  assert.equal(pkg.scripts['pretest:client:raw'], undefined);
  assert.equal(pkg.scripts['posttest:client:raw'], undefined);
  assert.equal(pkg.scripts['preverify:review'], undefined);
  assert.equal(pkg.scripts['postverify:review'], undefined);
  assert.equal(
    pkg.scripts['verify:review'],
    'node scripts/verify-review-artifact.js && npm run test:client:raw && npm run test:server && node --check dist/review/ReviveRelay-0.6.9.user.js && node --test test/review-release-smoke.test.js test/release-dependency-verification.test.js && npm run audit:review && node scripts/verify-review-artifact.js'
  );
});
