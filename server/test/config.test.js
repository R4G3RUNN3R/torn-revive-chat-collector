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

test('Google error mirror configuration defaults safely and accepts explicit ReviveRelay values', () => {
  const base = { NODE_ENV:'test', DATABASE_URL:'postgres://x:y@localhost/z', API_KEY_ENCRYPTION_KEY:'a'.repeat(64), SESSION_TOKEN_PEPPER:'pepper' };
  const defaults=loadConfig(base);
  assert.equal(defaults.REVIVERELAY_GOOGLE_SERVICE_ACCOUNT_FILE,'');
  assert.equal(defaults.REVIVERELAY_ERROR_SHEET_ID,'');
  assert.equal(defaults.REVIVERELAY_ERROR_SHEET_TAB,'ReviveRelay Issues');
  assert.equal(defaults.REVIVERELAY_RELEASE_MANIFEST_FILE,'');
  const explicit=loadConfig({...base,
    REVIVERELAY_GOOGLE_SERVICE_ACCOUNT_FILE:'/run/secrets/reviverelay-google-service-account.json',
    REVIVERELAY_ERROR_SHEET_ID:'sheet123', REVIVERELAY_ERROR_SHEET_TAB:'ReviveRelay Issues'
  });
  assert.equal(explicit.REVIVERELAY_ERROR_SHEET_ID,'sheet123');
});
