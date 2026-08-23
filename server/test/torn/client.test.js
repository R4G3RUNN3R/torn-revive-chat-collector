const test = require('node:test');
const assert = require('node:assert/strict');
const { createTornClient, TornApiError } = require('../../src/torn/client');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test('getKeyInfo resolves Torn owner identity and access using API-key headers', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/key/info')) {
      return jsonResponse(200, {
        access: {
          level: 2,
          type: 'Limited Access',
          log: { custom_permissions: true, available: [1000, 1001] }
        },
        user: { id: 24680, faction_id: null, company_id: null }
      });
    }
    if (url.endsWith('/user/basic')) {
      return jsonResponse(200, { id: 24680, name: 'TestReviver', level: 50 });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const torn = createTornClient({ baseUrl: 'https://api.torn.com/v2', fetchImpl });
  const info = await torn.getKeyInfo('secret-key');

  assert.deepEqual(info, {
    tornId: 24680,
    name: 'TestReviver',
    access: {
      level: 2,
      type: 'Limited Access',
      log: { custom_permissions: true, available: [1000, 1001] }
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'ApiKey secret-key');
  assert.equal(calls[1].options.headers.Authorization, 'ApiKey secret-key');
  assert.doesNotMatch(calls[0].url, /secret-key/);
  assert.doesNotMatch(calls[1].url, /secret-key/);
});

test('getKeyInfo maps an invalid Torn key to TORN_INVALID_KEY', async () => {
  const torn = createTornClient({
    baseUrl: 'https://api.torn.com/v2',
    fetchImpl: async () => jsonResponse(401, { error: { code: 2, error: 'Incorrect key' } })
  });

  await assert.rejects(
    () => torn.getKeyInfo('bad-key'),
    error => error instanceof TornApiError && error.code === 'TORN_INVALID_KEY'
  );
});

test('getKeyInfo maps transport/server failures to TORN_UNAVAILABLE', async () => {
  const torn = createTornClient({
    baseUrl: 'https://api.torn.com/v2',
    fetchImpl: async () => jsonResponse(503, { error: 'unavailable' })
  });

  await assert.rejects(
    () => torn.getKeyInfo('key'),
    error => error instanceof TornApiError && error.code === 'TORN_UNAVAILABLE'
  );
});
