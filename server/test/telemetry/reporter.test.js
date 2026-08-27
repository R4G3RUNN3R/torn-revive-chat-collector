const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelemetryReporter } = require('../../src/telemetry/reporter');

test('server reporter sanitizes and fingerprints operational failures before persistence', async () => {
  const recorded = [];
  const reporter = createTelemetryReporter({
    repository: { async recordOccurrence(envelope) { recorded.push(envelope); } },
    product: 'reviverelay',
    version: '0.4.0',
    buildCommit: 'abc123'
  });

  const result = await reporter.report(
    new Error('DATABASE_URL=postgres://user:pass@db/reviverelay failed Authorization: Bearer SECRET'),
    { component: 'api', operation: 'startup', requestBody: { apiKey: 'NEVER_STORE' } }
  );

  assert.equal(result, true);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].product, 'reviverelay');
  assert.equal(recorded[0].component, 'api');
  assert.equal(recorded[0].source, 'api');
  assert.equal(recorded[0].version, '0.4.0');
  assert.equal(recorded[0].buildCommit, 'abc123');
  assert.match(recorded[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(recorded[0].context.operation, 'startup');
  assert.doesNotMatch(JSON.stringify(recorded[0]), /user:pass|SECRET|NEVER_STORE|requestBody|apiKey/);
});

test('server reporter never throws when telemetry persistence itself fails', async () => {
  const reporter = createTelemetryReporter({
    repository: { async recordOccurrence() { throw new Error('telemetry database unavailable'); } },
    product: 'reviverelay',
    version: '0.4.0'
  });

  await assert.doesNotReject(() => reporter.report(new Error('primary failure'), {
    component: 'worker', operation: 'job.handle', jobType: 'payment.verify'
  }));
  assert.equal(await reporter.report(new Error('primary failure'), {
    component: 'worker', operation: 'job.handle'
  }), false);
});
