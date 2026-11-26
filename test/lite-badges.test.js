const test = require('node:test');
const assert = require('node:assert/strict');
const { createBadges, badgeText } = require('../src/lite/badges');
const { createFakeDocument } = require('./helpers/fake-dom');

function setup({ href = 'https://www.torn.com/profiles.php?XID=42', badge = { tornId: 42, requesterVerified: false, reviverVerified: true }, enabled = true } = {}) {
  const document = createFakeDocument();
  const slot = document.createElement('div');
  slot.setAttribute('id', 'rr-profile');
  document.body.appendChild(slot);
  const calls = [];
  const api = { async getPlayerBadge(id) { calls.push(id); if (badge instanceof Error) throw badge; return badge; } };
  const badges = createBadges({ document, window: { location: { href } }, api, enabled: () => enabled, slots: ['#rr-profile'] });
  return { document, slot, calls, badges };
}

test('a visible profile page gets one RR verified chip, inserted once', async () => {
  const { badges, slot, calls } = setup();
  assert.equal(await badges.scan(), true);
  assert.equal(await badges.scan(), false);
  const chips = slot.querySelectorAll('[data-rr-badge]');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].textContent, 'RR verified reviver');
  assert.deepEqual(calls, ['42']);
});

test('hidden pages, other pages, opt-out and unverified players get nothing', async () => {
  const hidden = setup();
  hidden.document.visibilityState = 'hidden';
  assert.equal(await hidden.badges.scan(), false);
  assert.equal(hidden.calls.length, 0);
  const other = setup({ href: 'https://www.torn.com/hospitalview.php' });
  assert.equal(await other.badges.scan(), false);
  const off = setup({ enabled: false });
  assert.equal(await off.badges.scan(), false);
  assert.equal(off.calls.length, 0);
  const plain = setup({ badge: { tornId: 42, requesterVerified: false, reviverVerified: false } });
  assert.equal(await plain.badges.scan(), false);
  assert.equal(plain.slot.querySelectorAll('[data-rr-badge]').length, 0);
});

test('a failed lookup leaves the page untouched', async () => {
  const { badges, slot } = setup({ badge: new Error('RATE_LIMITED') });
  assert.equal(await badges.scan(), false);
  assert.equal(slot.querySelectorAll('[data-rr-badge]').length, 0);
});

test('badge text names each verified role', () => {
  assert.equal(badgeText({ requesterVerified: true, reviverVerified: true }), 'RR verified requester · reviver');
  assert.equal(badgeText({ requesterVerified: false, reviverVerified: false }), '');
});
