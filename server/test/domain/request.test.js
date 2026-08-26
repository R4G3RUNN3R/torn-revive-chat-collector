const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOffer } = require('../../src/domain/request');

test('cash offer enforces the 500000 minimum', () => {
  assert.throws(
    () => validateOffer({ paymentMethod: 'cash', offerAmount: 499999 }),
    /cash.*500000/i
  );

  assert.deepEqual(
    validateOffer({ paymentMethod: 'cash', offerAmount: 500000 }),
    { paymentMethod: 'cash', offerAmount: 500000, comment: null }
  );
});

test('xanax offer enforces the 1 Xanax minimum', () => {
  assert.throws(
    () => validateOffer({ paymentMethod: 'xanax', offerAmount: 0 }),
    /xanax.*1/i
  );

  assert.deepEqual(
    validateOffer({ paymentMethod: 'xanax', offerAmount: 1 }),
    { paymentMethod: 'xanax', offerAmount: 1, comment: null }
  );
});

test('offers must be whole numbers and use a supported method', () => {
  assert.throws(
    () => validateOffer({ paymentMethod: 'cash', offerAmount: 500000.5 }),
    /whole/i
  );
  assert.throws(
    () => validateOffer({ paymentMethod: 'xanax', offerAmount: 1.5 }),
    /whole/i
  );
  assert.throws(
    () => validateOffer({ paymentMethod: 'free', offerAmount: 1 }),
    /payment method/i
  );
});

test('optional comment is trimmed and capped at 500 characters', () => {
  assert.deepEqual(
    validateOffer({
      paymentMethod: 'cash',
      offerAmount: 750000,
      comment: '  Please revive quickly.  '
    }),
    {
      paymentMethod: 'cash',
      offerAmount: 750000,
      comment: 'Please revive quickly.'
    }
  );

  assert.equal(
    validateOffer({ paymentMethod: 'xanax', offerAmount: 1, comment: '   ' }).comment,
    null
  );

  assert.throws(
    () => validateOffer({ paymentMethod: 'xanax', offerAmount: 1, comment: 'x'.repeat(501) }),
    /500/
  );
});

test('offers larger than JavaScript safe integer range are rejected', () => {
  assert.throws(
    () => validateOffer({ paymentMethod: 'cash', offerAmount: Number.MAX_SAFE_INTEGER + 1 }),
    /safe|whole/i
  );
});
