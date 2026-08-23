const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('loadConfig rejects missing database URL', () => {
  assert.throws(() => loadConfig({
    API_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
    SESSION_TOKEN_PEPPER: 'pepper'
  }), /DATABASE_URL/);
});

test('loadConfig accepts a complete development environment', () => {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    PORT: '3100',
    DATABASE_URL: 'postgres://reviverelay:test@localhost/reviverelay_test',
    API_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
    SESSION_TOKEN_PEPPER: 'pepper',
    TORN_API_BASE_URL: 'https://api.torn.com/v2',
    OPERATOR_TORN_ID: '123456',
    ADMIN_API_TOKEN: 'admin-test-token',
    SHEETS_MIRROR_URL: '',
    SHEETS_MIRROR_TOKEN: '',
    PAID_TIER_ENABLED: 'false'
  });

  assert.equal(cfg.PORT, 3100);
  assert.equal(cfg.PAID_TIER_ENABLED, false);
});
