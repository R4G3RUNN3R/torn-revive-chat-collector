const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveRequesterStatus } = require('../../src/torn/requester-status');

test('home hospital yields until time and abroad false', () => {
  assert.deepEqual(
    deriveRequesterStatus({ status: { state: 'Hospital', until: 1795612800, description: 'In hospital for 2 hrs 10 mins' } }),
    { hospitalUntil: new Date(1795612800 * 1000), abroad: false }
  );
});

test('foreign hospital yields abroad true', () => {
  const result = deriveRequesterStatus({ status: { state: 'Hospital', until: 1795612800, description: 'In a Mexican hospital for 45 mins' } });
  assert.equal(result.abroad, true);
  assert.equal(deriveRequesterStatus({ status: { state: 'Hospital', until: 1795612800, description: 'In an Argentinian hospital for 3 mins' } }).abroad, true);
});

test('unrecognised description leaves abroad unknown', () => {
  assert.equal(deriveRequesterStatus({ status: { state: 'Hospital', until: 1795612800, description: 'Hospitalized by someone' } }).abroad, null);
});

test('not in hospital, missing or malformed data yields unknowns', () => {
  const unknown = { hospitalUntil: null, abroad: null };
  assert.deepEqual(deriveRequesterStatus({ status: { state: 'Okay', until: 0, description: 'Okay' } }), unknown);
  assert.deepEqual(deriveRequesterStatus({}), unknown);
  assert.deepEqual(deriveRequesterStatus(null), unknown);
  assert.deepEqual(deriveRequesterStatus({ status: { state: 'Hospital', until: 'soon', description: 'In hospital for 1 min' } }), { hospitalUntil: null, abroad: false });
});
