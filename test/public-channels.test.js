const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalPublicChannel,
  isPublicChannel
} = require('../src/public-channels');

const accepted = [
  ['public_global', 'global'],
  ['public_trade', 'trade'],
  ['public_hospital', 'hospital'],
  ['public_jail', 'jail'],
  ['public_new_player', 'new_player'],
  ['public_travel_mexico', 'travel']
];

for (const [id, type] of accepted) {
  test(`allows known public channel ${id}`, () => {
    const channel = canonicalPublicChannel(id);
    assert.ok(channel);
    assert.equal(channel.id, id);
    assert.equal(channel.type, type);
    assert.equal(isPublicChannel(id), true);
  });
}

for (const id of [
  'faction-123',
  'company-123',
  'private-123',
  'competition-123',
  '',
  'public_totally_unknown',
  'not-a-chat'
]) {
  test(`rejects non-allowlisted channel ${JSON.stringify(id)}`, () => {
    assert.equal(canonicalPublicChannel(id), null);
    assert.equal(isPublicChannel(id), false);
  });
}
