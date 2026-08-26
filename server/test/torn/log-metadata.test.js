const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLogCategories,
  createLogMetadataResolver
} = require('../../src/torn/log-metadata');

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
