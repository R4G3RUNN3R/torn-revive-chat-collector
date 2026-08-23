const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../src/domain/request.js');

function loadRequestDomain() {
  assert.ok(fs.existsSync(modulePath), 'server/src/domain/request.js must exist');
  return require(modulePath);
}

test('Cash offers require at least 500000 whole Torn dollars', () => {
  const { validateOffer } = loadRequestDomain();

  assert.throws(() => validateOffer({ paymentMethod: 'cash', offerAmount: 499999 }), /500000/i);
  assert.throws(() => validateOffer({ paymentMethod: 'cash', offerAmount: 500000.5 }), /whole|integer/i);
  assert.deepEqual(
    validateOffer({ paymentMethod: 'cash', offerAmount: 500000 }),
    { paymentMethod: 'cash', offerAmount: 500000, comment: null }
  );
});

test('Xanax offers require at least one whole Xanax', () => {
  const { validateOffer } = loadRequestDomain();

  assert.throws(() => validateOffer({ paymentMethod: 'xanax', offerAmount: 0 }), /at least 1/i);
  assert.throws(() => validateOffer({ paymentMethod: 'xanax', offerAmount: 1.5 }), /whole|integer/i);
  assert.deepEqual(
    validateOffer({ paymentMethod: 'xanax', offerAmount: 1 }),
    { paymentMethod: 'xanax', offerAmount: 1, comment: null }
  );
});

test('unsupported payment methods are rejected', () => {
  const { validateOffer } = loadRequestDomain();

  for (const paymentMethod of ['free', 'other', 'points', '', null]) {
    assert.throws(
      () => validateOffer({ paymentMethod, offerAmount: 1 }),
      /cash|xanax|payment method/i,
      String(paymentMethod)
    );
  }
});

test('optional requester comment is trimmed and capped at 500 characters', () => {
  const { validateOffer } = loadRequestDomain();

  assert.deepEqual(
    validateOffer({ paymentMethod: 'xanax', offerAmount: 2, comment: '  please hurry  ' }),
    { paymentMethod: 'xanax', offerAmount: 2, comment: 'please hurry' }
  );
  assert.throws(
    () => validateOffer({ paymentMethod: 'xanax', offerAmount: 2, comment: 'x'.repeat(501) }),
    /500/i
  );
});
