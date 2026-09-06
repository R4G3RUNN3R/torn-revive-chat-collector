const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLogCategories,
  createLogMetadataResolver
} = require('../../src/torn/log-metadata');
const { TornApiError } = require('../../src/torn/client');

test('normalizes Torn log category id/title pairs', () => {
  const result = normalizeLogCategories({
    logcategories: [
      { id: 10, title: 'Money incoming' },
      { id: 12, title: ' Items incoming ' }
    ]
  });
  assert.deepEqual(result.categories, { 10: 'Money incoming', 12: 'Items incoming' });
});

test('rejects malformed log category metadata', () => {
  assert.throws(() => normalizeLogCategories({ logcategories: [{ id: 'x', title: '' }] }), /log category/i);
});

test('resolver caches current Torn category metadata for its TTL', async () => {
  let calls = 0;
  let now = 1000;
  const resolver = createLogMetadataResolver({
    tornClient: {
      async getLogCategories() {
        calls += 1;
        return [{ id: 10, title: 'Money incoming' }];
      }
    },
    ttlMs: 1000,
    now: () => now
  });

  assert.equal((await resolver.get('key')).categories[10], 'Money incoming');
  now = 1500;
  assert.equal((await resolver.get('key')).categories[10], 'Money incoming');
  assert.equal(calls, 1);
  now = 2501;
  await resolver.get('key');
  assert.equal(calls, 2);
});


test('resolver falls back to ReviveRelay transaction categories when a restricted key cannot read torn/logcategories', async () => {
  let calls = 0;
  const resolver = createLogMetadataResolver({
    tornClient: {
      async getLogCategories() {
        calls += 1;
        throw new TornApiError('TORN_UNAVAILABLE', 'Torn API is temporarily unavailable', {
          status: 200,
          tornStatus: 16
        });
      }
    }
  });

  const first = await resolver.get('restricted-key');
  assert.deepEqual(first.categories, {
    14: 'Money outgoing',
    15: 'Items incoming',
    16: 'Items outgoing',
    17: 'Money incoming'
  });
  const second = await resolver.get('restricted-key');
  assert.equal(second, first);
  assert.equal(calls, 1);
});

test('resolver does not hide genuine Torn API failures behind fallback metadata', async () => {
  const resolver = createLogMetadataResolver({
    tornClient: {
      async getLogCategories() {
        throw new TornApiError('TORN_UNAVAILABLE', 'Torn backend error', {
          status: 200,
          tornStatus: 17
        });
      }
    }
  });

  await assert.rejects(() => resolver.get('key'), error => error instanceof TornApiError && error.tornStatus === 17);
});
