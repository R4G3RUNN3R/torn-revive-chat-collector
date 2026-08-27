const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprintError } = require('../../src/telemetry/fingerprint');

test('same error across versions and numeric IDs has one fingerprint', () => {
  const a = fingerprintError({
    product: 'reviverelay', component: 'client', errorCode: 'TYPE_ERROR',
    message: 'Cannot read x for user 12345', stack: 'at render (/src/ui.js:42:7)',
    version: '0.4.0', buildCommit: 'abc123'
  });
  const b = fingerprintError({
    product: 'reviverelay', component: 'client', errorCode: 'TYPE_ERROR',
    message: 'Cannot read x for user 67890', stack: 'at render (/src/ui.js:99:7)',
    version: '0.4.1', buildCommit: 'def456'
  });

  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('normalizes UUIDs, timestamps, quoted values and URLs', () => {
  const first = fingerprintError({
    product: 'reviverelay', component: 'worker', errorName: 'RequestError',
    message: 'Job 550e8400-e29b-41d4-a716-446655440000 failed at 2026-08-26T10:11:12.123Z with "alpha" from https://api.example/jobs/123?token=one',
    stack: 'RequestError: dynamic\n    at runJob (/srv/app/worker.js:120:4)'
  });
  const second = fingerprintError({
    product: 'reviverelay', component: 'worker', errorName: 'RequestError',
    message: "Job 123e4567-e89b-12d3-a456-426614174000 failed at 2027-01-02T03:04:05Z with 'beta' from https://other.example/tasks/999?token=two",
    stack: 'RequestError: other\n    at runJob (/srv/app/worker.js:999:18)'
  });

  assert.equal(first, second);
});

test('normalizes UUID-shaped values regardless of UUID version bits', () => {
  const first = fingerprintError({ message: 'failed ffffffff-ffff-ffff-ffff-ffffffffffff' });
  const second = fingerprintError({ message: 'failed eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' });
  assert.equal(first, second);
});

test('uses only the top three stack function/file signatures', () => {
  const base = {
    product: 'reviverelay', component: 'server', errorCode: 'DB_FAILURE', message: 'query failed'
  };
  const first = fingerprintError({
    ...base,
    stack: [
      'Error: query failed',
      '    at execute (/app/src/db.js:10:2)',
      '    at save (/app/src/repository.js:20:3)',
      '    at handle (/app/src/routes.js:30:4)',
      '    at frameworkA (/node_modules/framework/a.js:40:5)'
    ].join('\n')
  });
  const second = fingerprintError({
    ...base,
    stack: [
      'Error: another rendering',
      '    at execute (/app/src/db.js:100:20)',
      '    at save (/app/src/repository.js:200:30)',
      '    at handle (/app/src/routes.js:300:40)',
      '    at frameworkB (/completely/different.js:1:1)'
    ].join('\n')
  });

  assert.equal(first, second);
});

test('normalizes browser stack URLs while preserving function and file signatures', () => {
  const base = { product: 'reviverelay', component: 'client', message: 'render failed' };
  const first = fingerprintError({ ...base, stack: 'render@https://one.example/src/ui.js:42:7' });
  const moved = fingerprintError({ ...base, stack: 'render@https://two.example/src/ui.js:99:3' });
  const different = fingerprintError({ ...base, stack: 'submit@https://two.example/src/api.js:42:7' });

  assert.equal(first, moved);
  assert.notEqual(first, different);
});

test('preserves stable product, component, error type/code, message template and stack signature', () => {
  const base = {
    product: 'reviverelay', component: 'client', errorCode: 'TYPE_ERROR',
    errorName: 'TypeError', message: 'Cannot render request 123',
    stack: 'at render (/src/ui.js:42:7)'
  };

  assert.notEqual(fingerprintError(base), fingerprintError({ ...base, product: 'another-product' }));
  assert.notEqual(fingerprintError(base), fingerprintError({ ...base, component: 'worker' }));
  assert.notEqual(fingerprintError(base), fingerprintError({ ...base, errorCode: 'NETWORK_ERROR' }));
  assert.notEqual(fingerprintError(base), fingerprintError({ ...base, message: 'Cannot submit request 123' }));
  assert.notEqual(fingerprintError(base), fingerprintError({ ...base, stack: 'at submit (/src/api.js:42:7)' }));
});
