const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../src/public-channels.js');

function loadPolicy() {
  assert.ok(fs.existsSync(modulePath), 'src/public-channels.js must exist');
  return require(modulePath);
}

test('canonicalPublicChannel accepts only explicitly supported Torn public channel families', () => {
  const { canonicalPublicChannel, isPublicChannel } = loadPolicy();

  const cases = [
    ['public_global', { id: 'public_global', name: 'Global', type: 'global' }],
    ['public_trade', { id: 'public_trade', name: 'Trade', type: 'trade' }],
    ['public_hospital', { id: 'public_hospital', name: 'Hospital', type: 'hospital' }],
    ['public_jail', { id: 'public_jail', name: 'Jail', type: 'jail' }],
    ['public_new_player', { id: 'public_new_player', name: 'New Player', type: 'new_player' }],
    ['public_travel_mexico', { id: 'public_travel_mexico', name: 'Mexico', type: 'travel' }]
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(canonicalPublicChannel(input), expected, input);
    assert.equal(isPublicChannel(input), true, input);
  }
});

test('public channel policy rejects private, pseudo-private and unknown channel ids', () => {
  const { canonicalPublicChannel, isPublicChannel } = loadPolicy();

  for (const input of [
    'faction-123',
    'company-456',
    'private-111-222',
    'competition-999',
    'group-123',
    'public_secret_future_channel',
    'public_travel_atlantis',
    '',
    null,
    undefined
  ]) {
    assert.equal(canonicalPublicChannel(input), null, String(input));
    assert.equal(isPublicChannel(input), false, String(input));
  }
});

test('canonicalPublicChannel normalizes supported public names without widening the allowlist', () => {
  const { canonicalPublicChannel } = loadPolicy();

  assert.deepEqual(canonicalPublicChannel('Global'), { id: 'public_global', name: 'Global', type: 'global' });
  assert.deepEqual(canonicalPublicChannel('hospital'), { id: 'public_hospital', name: 'Hospital', type: 'hospital' });
  assert.deepEqual(canonicalPublicChannel('Mexico'), { id: 'public_travel_mexico', name: 'Mexico', type: 'travel' });
  assert.equal(canonicalPublicChannel('Faction'), null);
});
