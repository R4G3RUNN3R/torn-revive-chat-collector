const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateTransactionCredential,
  requiredCapabilitiesFor
} = require('../../src/torn/key-capabilities');

const logMetadata = {
  categories: {
    10: 'Money incoming',
    11: 'Money outgoing',
    12: 'Items incoming',
    13: 'Items outgoing',
    14: 'Revive',
    15: 'Hospital'
  }
};

function keyInfo(overrides = {}) {
  return {
    tornId: 123,
    name: 'Tester',
    selections: {
      user: ['profile', 'revives'],
      company: [], faction: [], market: [], property: [], torn: [], racing: [], forum: [], key: ['info']
    },
    access: {
      level: 2,
      type: 'Limited Access',
      faction: false,
      company: false,
      log: { custom_permissions: false, available: [] }
    },
    ...overrides
  };
}

test('requester capability requires only profile and revives', () => {
  const result = validateTransactionCredential({ keyInfo: keyInfo(), ownerTornId: 123, logMetadata });
  assert.equal(result.requester, true);
  assert.equal(result.reviver, false);
  assert.deepEqual(requiredCapabilitiesFor('requester'), ['incoming_revives', 'hospital_status']);
});

test('reviver capability requires revives plus restricted incoming/outgoing money and item logs', () => {
  const info = keyInfo({
    selections: {
      user: ['revives', 'log'], company: [], faction: [], market: [], property: [], torn: [], racing: [], forum: [], key: ['info']
    },
    access: {
      level: 4,
      type: 'Full Access',
      faction: false,
      company: false,
      log: {
        custom_permissions: true,
        available: [10, 11, 12, 13].map(category_id => ({ category_id, log_ids: [] }))
      }
    }
  });
  const result = validateTransactionCredential({ keyInfo: info, ownerTornId: 123, logMetadata });
  assert.equal(result.requester, false);
  assert.equal(result.reviver, true);
  assert.deepEqual(requiredCapabilitiesFor('reviver'), [
    'outgoing_revives', 'money_incoming', 'item_incoming', 'money_outgoing', 'item_outgoing'
  ]);
});

test('one narrow key may satisfy both requester and reviver capabilities', () => {
  const info = keyInfo({
    selections: {
      user: ['profile', 'revives', 'log'], company: [], faction: [], market: [], property: [], torn: [], racing: [], forum: [], key: ['info']
    },
    access: {
      level: 4,
      type: 'Full Access',
      faction: false,
      company: false,
      log: {
        custom_permissions: true,
        available: [10, 11, 12, 13].map(category_id => ({ category_id, log_ids: [] }))
      }
    }
  });
  const result = validateTransactionCredential({ keyInfo: info, ownerTornId: 123, logMetadata });
  assert.equal(result.requester, true);
  assert.equal(result.reviver, true);
});

test('credential owner mismatch is rejected', () => {
  assert.throws(
    () => validateTransactionCredential({ keyInfo: keyInfo(), ownerTornId: 999, logMetadata }),
    /owner mismatch/i
  );
});

test('unrestricted user log access is rejected instead of accepted as broader than necessary', () => {
  const info = keyInfo({
    selections: {
      user: ['revives', 'log'], company: [], faction: [], market: [], property: [], torn: [], racing: [], forum: [], key: ['info']
    }
  });
  assert.throws(
    () => validateTransactionCredential({ keyInfo: info, ownerTornId: 123, logMetadata }),
    /restricted custom log permissions/i
  );
});

test('unrelated sensitive user selections are rejected', () => {
  const info = keyInfo({
    selections: {
      user: ['profile', 'revives', 'messages'], company: [], faction: [], market: [], property: [], torn: [], racing: [], forum: [], key: ['info']
    }
  });
  assert.throws(
    () => validateTransactionCredential({ keyInfo: info, ownerTornId: 123, logMetadata }),
    /unapproved user selections.*messages/i
  );
});

test('non-user private namespaces are rejected', () => {
  const info = keyInfo({
    selections: {
      user: ['profile', 'revives'], company: [], faction: ['basic'], market: [], property: [], torn: [], racing: [], forum: [], key: ['info']
    }
  });
  assert.throws(
    () => validateTransactionCredential({ keyInfo: info, ownerTornId: 123, logMetadata }),
    /unapproved namespace.*faction/i
  );
});

test('missing one required restricted log category leaves reviver capability false', () => {
  const info = keyInfo({
    selections: {
      user: ['revives', 'log'], company: [], faction: [], market: [], property: [], torn: [], racing: [], forum: [], key: ['info']
    },
    access: {
      level: 4, type: 'Full Access', faction: false, company: false,
      log: { custom_permissions: true, available: [10, 11, 12].map(category_id => ({ category_id, log_ids: [] })) }
    }
  });
  const result = validateTransactionCredential({ keyInfo: info, ownerTornId: 123, logMetadata });
  assert.equal(result.reviver, false);
  assert.ok(result.missing.reviver.includes('item_outgoing'));
});
