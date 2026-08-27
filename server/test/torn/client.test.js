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

test('getKeyInfo accepts current v2 wrapped key info and basic profile response', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/key/info')) return jsonResponse(200, {
      info: {
        selections: {
          company: [], faction: [], market: [], property: [], torn: [],
          user: ['profile', 'revives'], racing: [], forum: [], key: ['info']
        },
        access: { level: 2, type: 'Limited Access', faction: false, company: false, log: { custom_permissions: false, available: [] } },
        user: { id: 24680, faction_id: null, company_id: null }
      }
    });
    if (url.endsWith('/user/basic')) return jsonResponse(200, { profile: { id: 24680, name: 'TestReviver' } });
    throw new Error(`unexpected URL ${url}`);
  };
  const torn = createTornClient({ fetchImpl });
  const info = await torn.getKeyInfo('secret-key');
  assert.equal(info.tornId, 24680);
  assert.equal(info.name, 'TestReviver');
  assert.deepEqual(info.selections.user, ['profile', 'revives']);
});

test('getLogCategories normalizes current Torn response without putting key in URL', async () => {
  const calls = [];
  const torn = createTornClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { logcategories: [{ id: 10, title: 'Money incoming' }] });
    }
  });
  assert.deepEqual(await torn.getLogCategories('secret-key'), [{ id: 10, title: 'Money incoming' }]);
  assert.doesNotMatch(calls[0].url, /secret-key/);
  assert.equal(calls[0].options.headers.Authorization, 'ApiKey secret-key');
});

test('evidence methods encode bounded query parameters and keep key in header', async () => {
  const calls = [];
  const torn = createTornClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/user/revives')) return jsonResponse(200, { revives: [] });
      if (url.includes('/user/profile')) return jsonResponse(200, { profile: { id: 1, status: { state: 'Hospital', until: 1000 } } });
      if (url.includes('/user/log')) return jsonResponse(200, { log: [] });
      throw new Error(`unexpected URL ${url}`);
    }
  });

  await torn.getUserRevives('secret-key', { direction: 'outgoing', from: 100, to: 200, limit: 50 });
  await torn.getUserProfile('secret-key');
  await torn.getUserLogs('secret-key', { categoryId: 10, targetTornId: 123, from: 100, to: 200, limit: 50 });

  assert.match(calls[0].url, /filters=outgoing/);
  assert.match(calls[0].url, /from=100/);
  assert.match(calls[0].url, /to=200/);
  assert.match(calls[2].url, /cat=10/);
  assert.match(calls[2].url, /target=123/);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, 'ApiKey secret-key');
    assert.doesNotMatch(call.url, /secret-key/);
  }
});

test('Torn client reports invalid-key, rate-limit, server, malformed and timeout classes without secrets or query strings', async () => {
  const reports = [];
  const telemetryReporter = {
    async report(error, context) {
      reports.push({ message: error.message, context });
      return true;
    }
  };

  const invalid = createTornClient({
    telemetryReporter,
    fetchImpl: async () => jsonResponse(401, { error: { code: 2, error: 'Incorrect key' } })
  });
  await assert.rejects(() => invalid.getKeyInfo('INVALID_KEY_SECRET'));

  const limited = createTornClient({
    telemetryReporter,
    fetchImpl: async () => jsonResponse(429, { error: { code: 5, error: 'Too many requests' } })
  });
  await assert.rejects(() => limited.getUserRevives('RATE_LIMIT_KEY', { direction: 'incoming', from: 100, to: 200 }));

  const server = createTornClient({
    telemetryReporter,
    fetchImpl: async () => jsonResponse(503, { error: 'unavailable' })
  });
  await assert.rejects(() => server.getUserProfile('SERVER_KEY'));

  const malformed = createTornClient({
    telemetryReporter,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new SyntaxError('bad json'); } })
  });
  await assert.rejects(() => malformed.getLogCategories('MALFORMED_KEY'));

  const timeout = createTornClient({
    telemetryReporter,
    fetchImpl: async url => { throw Object.assign(new Error(`timeout at ${url}?apiKey=TIMEOUT_KEY_SECRET`), { name: 'TimeoutError' }); }
  });
  await assert.rejects(() => timeout.getUserRevives('TIMEOUT_KEY_SECRET', { direction: 'outgoing', from: 300, to: 400 }));

  assert.equal(reports.length, 5);
  const serialized = JSON.stringify(reports);
  assert.doesNotMatch(serialized, /INVALID_KEY_SECRET|RATE_LIMIT_KEY|SERVER_KEY|MALFORMED_KEY|TIMEOUT_KEY_SECRET|\?filters=|\?from=|apiKey=/);
  assert.ok(reports.every(item => item.context.component === 'torn'));
  assert.ok(reports.every(item => item.context.operation));
  assert.equal(reports[1].context.httpStatus, 429);
  assert.equal(reports[2].context.httpStatus, 503);
  assert.equal(reports[3].context.httpStatus, 200);
  assert.equal(reports[4].context.state, 'timeout');
});
