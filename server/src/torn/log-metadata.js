function normalizeLogCategories(input) {
  const rows = Array.isArray(input) ? input : input && input.logcategories;
  if (!Array.isArray(rows)) throw new Error('Torn log category metadata is missing');

  const categories = {};
  for (const row of rows) {
    const id = Number(row && row.id);
    const title = String(row && row.title || '').trim().replace(/\s+/g, ' ');
    if (!Number.isSafeInteger(id) || id <= 0 || !title) {
      throw new Error('Torn log category metadata contains an invalid category');
    }
    categories[id] = title;
  }

  return Object.freeze({ categories: Object.freeze(categories) });
}

function createLogMetadataResolver({ tornClient, ttlMs = 6 * 60 * 60 * 1000, now = Date.now } = {}) {
  if (!tornClient || typeof tornClient.getLogCategories !== 'function') {
    throw new Error('Torn client with getLogCategories is required');
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Log metadata TTL must be positive');
  if (typeof now !== 'function') throw new Error('Clock is required');

  let cached = null;
  let expiresAt = 0;

  return {
    async get(apiKey) {
      const current = Number(now());
      if (cached && current < expiresAt) return cached;
      const rows = await tornClient.getLogCategories(apiKey);
      const normalized = normalizeLogCategories(rows);
      cached = normalized;
      expiresAt = current + ttlMs;
      return normalized;
    },
    clear() {
      cached = null;
      expiresAt = 0;
    }
  };
}

module.exports = {
  normalizeLogCategories,
  createLogMetadataResolver
};
