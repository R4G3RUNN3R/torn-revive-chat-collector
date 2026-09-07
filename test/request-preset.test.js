const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePreset, deriveSidebarState } = require('../src/request-preset');

test('cash preset enforces existing minimum and bounded optional message', () => {
  assert.deepEqual(validatePreset({ paymentMethod:'cash', offerAmount:500000, comment:' Please revive ' }), {
    ok:true,
    preset:{ paymentMethod:'cash', offerAmount:500000, comment:'Please revive' }
  });
  assert.equal(validatePreset({ paymentMethod:'cash', offerAmount:499999 }).ok, false);
  assert.equal(validatePreset({ paymentMethod:'cash', offerAmount:500000, comment:'x'.repeat(501) }).ok, false);
});

test('xanax preset requires positive whole safe quantity', () => {
  assert.deepEqual(validatePreset({ paymentMethod:'xanax', offerAmount:1 }), {
    ok:true,
    preset:{ paymentMethod:'xanax', offerAmount:1, comment:null }
  });
  assert.equal(validatePreset({ paymentMethod:'xanax', offerAmount:0 }).ok, false);
  assert.equal(validatePreset({ paymentMethod:'xanax', offerAmount:1.5 }).ok, false);
  assert.equal(validatePreset({ paymentMethod:'xanax', offerAmount:Number.MAX_SAFE_INTEGER + 1 }).ok, false);
});

test('preset rejects unknown fields so credentials can never become stored preset data', () => {
  for (const key of ['apiKey','tornKey','sessionToken','verificationCredential','password']) {
    const result = validatePreset({ paymentMethod:'cash', offerAmount:500000, [key]:'secret' });
    assert.equal(result.ok, false, key);
    assert.equal(result.error, 'UNKNOWN_FIELD');
  }
});

test('sidebar state has deterministic precedence and requires both session and valid preset', () => {
  const preset={paymentMethod:'cash',offerAmount:500000,comment:null};
  assert.equal(deriveSidebarState({sessionToken:'',preset}), 'SETUP_REQUIRED');
  assert.equal(deriveSidebarState({sessionToken:'token',preset:null}), 'SETUP_REQUIRED');
  assert.equal(deriveSidebarState({sessionToken:'token',preset}), 'READY');
  assert.equal(deriveSidebarState({sessionToken:'token',preset,activeRequest:{id:'r1'}}), 'ACTIVE');
  assert.equal(deriveSidebarState({sessionToken:'token',preset,lastError:'network'}), 'ERROR');
  assert.equal(deriveSidebarState({sessionToken:'token',preset,activeRequest:{id:'r1'},lastError:'network'}), 'ACTIVE');
  assert.equal(deriveSidebarState({sessionToken:'token',preset,submitting:true,activeRequest:{id:'r1'},lastError:'network'}), 'SUBMITTING');
});
