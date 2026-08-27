const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeTelemetryEnvelope,
  sanitizeMessage,
  sanitizeStack
} = require('../../src/telemetry/sanitize');

test('sanitizes the plan example and preserves only safe context', () => {
  const output = sanitizeTelemetryEnvelope({
    component: 'client',
    version: '0.4.0',
    severity: 'high',
    errorName: 'Error',
    message: 'Authorization: Bearer SECRET_TOKEN apiKey=ABC123 cookie=session',
    stack: 'Error: boom\n at fn (https://example/x.js?key=ABC123:1:2)',
    context: {
      operation: 'request',
      requestBody: { apiKey: 'ABC123' },
      route: '/v1/requests'
    }
  });

  assert.doesNotMatch(JSON.stringify(output), /SECRET_TOKEN|ABC123|requestBody|cookie/i);
  assert.equal(output.context.route, '/v1/requests');
  assert.equal(output.context.operation, 'request');
});

test('redacts headers, named credentials, bearer tokens and token-like strings', () => {
  const secrets = [
    'Authorization: Bearer ' + ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIn0', 'signature'].join('.'),
    'Cookie: rr_session=super-secret-session; theme=dark',
    'apiKey=ABC123XYZ',
    'token: ' + ['tok', 'live'].join('_') + '_1234567890',
    'secret="very-secret-value"',
    'password=hunter2',
    'failed with ' + ['sk', 'live'].join('_') + '_abcdefghijklmnopqrstuvwxyz012345',
    'GitHub rejected ' + 'gh' + 'p_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    'Slack rejected ' + 'xo' + 'xb-' + '1234567890-abcdefghijklmnop'
  ];

  for (const value of secrets) {
    const sanitized = sanitizeMessage(value);
    assert.match(sanitized, /\[REDACTED\]/);
    assert.doesNotMatch(sanitized, /eyJhbGci|super-secret-session|ABC123XYZ|tok_live|very-secret|hunter2|sk_live|ghp_|xoxb-/i);
  }
});

test('redacts database and credential-bearing URLs including query secrets', () => {
  const output = sanitizeTelemetryEnvelope({
    message: [
      'postgres://dbuser:dbpass@db.internal:5432/reviverelay',
      'mongodb+srv://mongo:secret@cluster.example/app',
      'mysql://mysqluser:mysqlpass@db.internal/reviverelay',
      'redis://cacheuser:cachepass@cache.internal/0',
      'https://alice:password@example.com/private',
      'https://example.com/path?api_key=QUERYSECRET&safe=value'
    ].join(' '),
    stack: 'at request (https://example.com/app.js?access_token=STACKSECRET:42:7)',
    context: {
      route: '/v1/jobs?token=ROUTESECRET&view=short',
      operation: 'postgres://admin:DBSECRET@localhost/app'
    }
  });
  const serialized = JSON.stringify(output);

  assert.doesNotMatch(serialized, /dbuser|dbpass|mongo|mysqluser|mysqlpass|cacheuser|cachepass|QUERYSECRET|STACKSECRET|ROUTESECRET|DBSECRET|alice:password/i);
  assert.doesNotMatch(serialized, /postgres:|mongodb|mysql:|redis:/i);
  assert.match(serialized, /\[REDACTED\]/);
});

test('drops payload-bearing and unsupported context keys', () => {
  const output = sanitizeTelemetryEnvelope({
    context: {
      operation: 'verify', route: '/v1/transactions/:id', jobType: 'refund.verify',
      httpStatus: 503, tornStatus: 429, state: 'pending', method: 'POST',
      retryable: true, releaseChannel: 'automatic',
      chat: 'private chat', message: 'private message', comment: 'private comment',
      evidence: { raw: 'private evidence' }, body: { password: 'private password' },
      requestBody: { apiKey: 'private key' }, responseBody: { token: 'private token' },
      headers: { authorization: 'Bearer private' }, player: { id: 12345 }, unsupported: 'drop me'
    }
  });

  assert.deepEqual(Object.keys(output.context).sort(), [
    'httpStatus', 'jobType', 'method', 'operation', 'releaseChannel',
    'retryable', 'route', 'state', 'tornStatus'
  ]);
  assert.doesNotMatch(JSON.stringify(output), /private|unsupported|requestBody|responseBody|headers|player/i);
});

test('enforces exact field limits and scalar safe-context values', () => {
  const output = sanitizeTelemetryEnvelope({
    message: `prefix ${'m'.repeat(2000)}`,
    stack: `Error\n${'s'.repeat(9000)}`,
    context: {
      operation: 'o'.repeat(400),
      route: { nested: 'must not survive' },
      httpStatus: 500,
      retryable: false
    }
  });

  assert.equal(output.message.length, 1000);
  assert.equal(output.stack.length, 8000);
  assert.equal(output.context.operation.length, 250);
  assert.equal(output.context.httpStatus, 500);
  assert.equal(output.context.retryable, false);
  assert.equal(Object.hasOwn(output.context, 'route'), false);
  assert.ok(Object.keys(output.context).length <= 12);
});

test('redacts before truncation and redacts the serialized result again', () => {
  const beforeBoundary = sanitizeMessage(`${'x'.repeat(990)} token=SECRET_AFTER_BOUNDARY`);
  assert.equal(beforeBoundary.length, 1000);
  assert.doesNotMatch(beforeBoundary, /SECRET_AFTER_BOUNDARY/);

  const output = sanitizeTelemetryEnvelope({
    message: 'safe',
    context: {
      operation: {
        toJSON() {
          return 'Authorization: Bearer SERIALIZED_SECRET';
        }
      }
    }
  });
  assert.doesNotMatch(JSON.stringify(output), /SERIALIZED_SECRET/);
});

test('sanitizeStack applies redaction and the 8000-character bound', () => {
  const stack = sanitizeStack(`Error: password=STACK_PASSWORD\n${'x'.repeat(9000)}`);
  assert.equal(stack.length, 8000);
  assert.doesNotMatch(stack, /STACK_PASSWORD/);
});
