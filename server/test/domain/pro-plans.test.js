const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRO_PLANS,
  getProPlan,
  amountForCurrency,
  extendCalendarDuration
} = require('../../src/domain/pro-plans');

test('launch Pro plan catalog is server-owned, exact and immutable', () => {
  assert.deepEqual(PRO_PLANS.monthly, { id:'monthly', months:1, xanax:10, cash:10000000 });
  assert.deepEqual(PRO_PLANS.six_months, { id:'six_months', months:6, xanax:55, cash:55000000 });
  assert.deepEqual(PRO_PLANS.yearly, { id:'yearly', months:12, xanax:100, cash:100000000 });
  assert.equal(Object.isFrozen(PRO_PLANS), true);
  assert.equal(Object.isFrozen(PRO_PLANS.monthly), true);
});

test('plan lookup and currency pricing accept only server-known values', () => {
  assert.equal(getProPlan('monthly'), PRO_PLANS.monthly);
  assert.equal(amountForCurrency(PRO_PLANS.monthly, 'xanax'), 10);
  assert.equal(amountForCurrency(PRO_PLANS.monthly, 'cash'), 10000000);
  assert.throws(() => getProPlan('fourteen_xanax_special'), /UNKNOWN_PRO_PLAN/);
  assert.throws(() => amountForCurrency(PRO_PLANS.monthly, 'points'), /UNKNOWN_PRO_CURRENCY/);
});

test('calendar extension uses UTC calendar months', () => {
  assert.equal(
    extendCalendarDuration(new Date('2026-08-30T12:00:00Z'), 1).toISOString(),
    '2026-09-30T12:00:00.000Z'
  );
  assert.equal(
    extendCalendarDuration(new Date('2026-08-30T12:00:00Z'), 6).toISOString(),
    '2027-02-28T12:00:00.000Z'
  );
});

test('calendar extension rejects malformed dates and month counts', () => {
  assert.throws(() => extendCalendarDuration(new Date('invalid'), 1), /INVALID_BASE_DATE/);
  assert.throws(() => extendCalendarDuration(new Date(), 0), /INVALID_MONTH_COUNT/);
  assert.throws(() => extendCalendarDuration(new Date(), 1.5), /INVALID_MONTH_COUNT/);
});
