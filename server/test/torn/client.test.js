const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../src/torn/client.js');

function loadClient() {
  assert.ok(fs.existsSync(modulePath), 'server/src/torn/client.js must exist');
  return require(modulePath);
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function keyInfoBody() {
  return {
    info: {
      selections: {
        company: [],
        faction: [],
        market: [],
        property: [],
        torn: [],
        user: ['basic'],
        racing: [],
        forum: [],
        key: ['info']
      },
      user: { id: 1234567, faction_id: null, company_id: null },
      access: {
        level: 1,
        type: 'Custom',
        faction: false,
        company: false,
        log: { custom_permissions: true, available: [] }
      }
    }
  };
}

test('getKeyInfo binds the official key/info identity to user/basic display name', async () => {
  const { createTornClient } = loadClient();
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/key/info')) return response(200, keyInfoBody());
    if (url.endsWith('/user/basic')) {
      return response(200, {
        profile: {
          id: 1234567,
          name: 'ReviverOne',
          level: 50,
          gender: 'Male',
          status: { description: 'Okay', details: '', state: 'Okay', color: 'green', until: null }
        }
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const torn = createTornClient({ baseUrl: 'https://api.torn.com/v2', fetchImpl: fakeFetch });
  const result = await torn.getKeyInfo('secret-key');

  assert.equal(result.tornId, 1234567);
  assert.equal(result.name, 'ReviverOne');
  assert.equal(result.access.type, 'Custom');
  assert.deepEqual(result.access.selections.user, ['basic']);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, 'ApiKey secret-key');
    assert.ok(!call.url.includes('secret-key'), 'API key must not be placed in the query string');
  }
});

test('getKeyInfo maps incorrect Torn keys to TORN_INVALID_KEY', async () => {
  const { createTornClient } = loadClient();
  const torn = createTornClient({
    baseUrl: 'https://api.torn.com/v2',
    fetchImpl: async () => response(400, { error: { code: 2, error: 'Incorrect key' } })
  });

  await assert.rejects(
    () => torn.getKeyInfo('bad-key'),
    (error) => error && error.code === 'TORN_INVALID_KEY'
  );
});

test('getKeyInfo maps network failures to TORN_UNAVAILABLE without leaking the key', async () => {
  const { createTornClient } = loadClient();
  const torn = createTornClient({
    baseUrl: 'https://api.torn.com/v2',
    fetchImpl: async () => {
      throw new Error('network down');
    }
  });

  await assert.rejects(
    () => torn.getKeyInfo('do-not-leak-this'),
    (error) => {
      assert.equal(error.code, 'TORN_UNAVAILABLE');
      assert.doesNotMatch(error.message, /do-not-leak-this/);
      return true;
    }
  );
});

test('getKeyInfo rejects mismatched key owner and profile identities', async () => {
  const { createTornClient } = loadClient();
  const torn = createTornClient({
    baseUrl: 'https://api.torn.com/v2',
    fetchImpl: async (url) => {
      if (url.endsWith('/key/info')) return response(200, keyInfoBody());
      return response(200, {
        profile: {
          id: 9999999,
          name: 'WrongPlayer',
          level: 1,
          gender: 'Male',
          status: { description: 'Okay', details: '', state: 'Okay', color: 'green', until: null }
        }
      });
    }
  });

  await assert.rejects(
    () => torn.getKeyInfo('secret-key'),
    (error) => error && error.code === 'TORN_RESPONSE_INVALID'
  );
});
