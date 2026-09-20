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
    SUBSCRIPTION_MODE: 'free'
  });

  assert.equal(cfg.PORT, 3100);
  assert.equal(cfg.SUBSCRIPTION_MODE, 'free');
  assert.equal(Object.hasOwn(cfg, 'PAID_TIER_ENABLED'), false);
});

test('Google error mirror configuration defaults safely and accepts explicit ReviveRelay values', () => {
  const base = { NODE_ENV:'test', DATABASE_URL:'postgres://x:y@localhost/z', API_KEY_ENCRYPTION_KEY:'a'.repeat(64), SESSION_TOKEN_PEPPER:'pepper' };
  const defaults=loadConfig(base);
  assert.equal(defaults.REVIVERELAY_GOOGLE_SERVICE_ACCOUNT_FILE,'');
  assert.equal(defaults.REVIVERELAY_ERROR_SHEET_ID,'');
  assert.equal(defaults.REVIVERELAY_ERROR_SHEET_TAB,'ReviveRelay Issues');
  assert.equal(defaults.REVIVERELAY_REVIEW_MANIFEST_FILE,'');
  assert.equal(defaults.REVIVERELAY_STABLE_MANIFEST_FILE,'');
  assert.equal(Object.hasOwn(defaults,'REVIVERELAY_RELEASE_MANIFEST_FILE'),false);
  const explicit=loadConfig({...base,
    REVIVERELAY_GOOGLE_SERVICE_ACCOUNT_FILE:'/run/secrets/reviverelay-google-service-account.json',
    REVIVERELAY_ERROR_SHEET_ID:'sheet123', REVIVERELAY_ERROR_SHEET_TAB:'ReviveRelay Issues'
  });
  assert.equal(explicit.REVIVERELAY_ERROR_SHEET_ID,'sheet123');
});


test('release manifest configuration is either absent or supplies both review and stable manifests', () => {
  const base={NODE_ENV:'test',DATABASE_URL:'postgres://x:y@localhost/z',API_KEY_ENCRYPTION_KEY:'a'.repeat(64),SESSION_TOKEN_PEPPER:'pepper'};
  assert.doesNotThrow(()=>loadConfig(base));
  assert.throws(()=>loadConfig({...base,REVIVERELAY_REVIEW_MANIFEST_FILE:'/releases/review.json'}),/STABLE_MANIFEST/i);
  assert.throws(()=>loadConfig({...base,REVIVERELAY_STABLE_MANIFEST_FILE:'/releases/stable.json'}),/REVIEW_MANIFEST/i);
  const cfg=loadConfig({...base,REVIVERELAY_REVIEW_MANIFEST_FILE:'/releases/review.json',REVIVERELAY_STABLE_MANIFEST_FILE:'/releases/stable.json'});
  assert.equal(cfg.REVIVERELAY_REVIEW_MANIFEST_FILE,'/releases/review.json');
  assert.equal(cfg.REVIVERELAY_STABLE_MANIFEST_FILE,'/releases/stable.json');
});


test('runtime version configuration enforces single-digit Voidsmith components', () => {
  const base={NODE_ENV:'test',DATABASE_URL:'postgres://x:y@localhost/z',API_KEY_ENCRYPTION_KEY:'a'.repeat(64),SESSION_TOKEN_PEPPER:'pepper'};
  assert.doesNotThrow(()=>loadConfig({...base,REVIVERELAY_SERVER_VERSION:'0.7.0',REVIVERELAY_MINIMUM_CLIENT_VERSION:'0.6.9'}));
  for(const invalid of ['0.6.10','0.10.0','10.0.0','0.07.0']){
    assert.throws(()=>loadConfig({...base,REVIVERELAY_SERVER_VERSION:invalid}),/REVIVERELAY_SERVER_VERSION|Invalid string|format/i,invalid);
    assert.throws(()=>loadConfig({...base,REVIVERELAY_MINIMUM_CLIENT_VERSION:invalid}),/REVIVERELAY_MINIMUM_CLIENT_VERSION|Invalid string|format/i,invalid);
  }
});
