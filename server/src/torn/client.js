class TornApiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'TornApiError';
    this.code = code;
    this.status = options.status;
  }
}

function createTornClient({
  baseUrl = 'https://api.torn.com/v2',
  fetchImpl = globalThis.fetch,
  telemetryReporter = null
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const normalizedBase = baseUrl.replace(/\/$/, '');

  function queryString(query = {}) {
    const params = new URLSearchParams();
    for (const [key, raw] of Object.entries(query)) {
      if (raw === undefined || raw === null || raw === '') continue;
      const value = Array.isArray(raw) ? raw.join(',') : raw;
      params.set(key, String(value));
    }
    const text = params.toString();
    return text ? `?${text}` : '';
  }

  async function reportFailure(error, operation, context = {}) {
    if (!telemetryReporter || typeof telemetryReporter.report !== 'function') return false;
    try {
      return await telemetryReporter.report(error, {
        component: 'torn',
        operation,
        method: 'GET',
        ...context
      });
    } catch (_) {
      return false;
    }
  }

  async function fail(code, message, operation, context = {}) {
    const error = new TornApiError(code, message, { status: context.httpStatus });
    await reportFailure(error, operation, context);
    throw error;
  }

  async function request(path, apiKey, query, operation = 'request') {
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return fail('TORN_INVALID_KEY', 'Torn API key is required', operation, { state: 'invalid-key' });
    }

    let response;
    try {
      response = await fetchImpl(`${normalizedBase}${path}${queryString(query)}`, {
        method: 'GET',
        headers: {
          Authorization: `ApiKey ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': 'ReviveRelay/0.3'
        }
      });
    } catch (error) {
      const timeout = /timeout|abort/i.test(String(error && error.name || ''));
      return fail(
        'TORN_UNAVAILABLE',
        timeout ? 'Torn API request timed out' : 'Torn API request failed',
        operation,
        { state: timeout ? 'timeout' : 'transport' }
      );
    }

    let body;
    try {
      body = await response.json();
    } catch (_) {
      return fail('TORN_UNAVAILABLE', 'Torn API returned invalid JSON', operation, {
        httpStatus: Number(response.status || 0),
        state: 'malformed'
      });
    }

    const apiErrorCode = body && body.error && Number(body.error.code);
    if (response.status === 401 || response.status === 403 || apiErrorCode === 2) {
      return fail('TORN_INVALID_KEY', 'Torn API key is invalid or unauthorized', operation, {
        httpStatus: Number(response.status || 0),
        tornStatus: Number.isFinite(apiErrorCode) ? apiErrorCode : undefined,
        state: 'invalid-key'
      });
    }
    if (response.status === 429) {
      return fail('TORN_UNAVAILABLE', 'Torn API rate limit reached', operation, {
        httpStatus: 429,
        tornStatus: Number.isFinite(apiErrorCode) ? apiErrorCode : undefined,
        state: 'rate-limited',
        retryable: true
      });
    }
    if (response.status >= 500) {
      return fail('TORN_UNAVAILABLE', 'Torn API server error', operation, {
        httpStatus: Number(response.status || 0),
        tornStatus: Number.isFinite(apiErrorCode) ? apiErrorCode : undefined,
        state: 'server-error',
        retryable: true
      });
    }
    if (!response.ok || (body && body.error)) {
      return fail('TORN_UNAVAILABLE', 'Torn API is temporarily unavailable', operation, {
        httpStatus: Number(response.status || 0),
        tornStatus: Number.isFinite(apiErrorCode) ? apiErrorCode : undefined,
        state: 'api-error',
        retryable: false
      });
    }
    return body;
  }

  async function malformed(operation, message, context = {}) {
    return fail('TORN_UNAVAILABLE', message, operation, { state: 'malformed', ...context });
  }

  async function getKeyInfo(apiKey) {
    const keyResponse = await request('/key/info', apiKey, undefined, 'key.info');
    const info = keyResponse && (keyResponse.info || keyResponse);
    const user = info && info.user;
    const tornId = Number(user && user.id);
    if (!Number.isSafeInteger(tornId) || tornId <= 0 || !info.access) {
      return malformed('key.info.validate', 'Torn key info response is incomplete');
    }

    const basicResponse = await request('/user/basic', apiKey, undefined, 'user.basic');
    const basic = basicResponse && (basicResponse.profile || basicResponse);
    const basicId = Number(basic && (basic.id ?? basic.player_id));
    const name = basic && basic.name;
    if (basicId !== tornId || typeof name !== 'string' || name.length === 0) {
      return malformed('user.basic.validate', 'Torn identity response is inconsistent');
    }

    const result = { tornId, name, access: info.access };
    if (info.selections && typeof info.selections === 'object') result.selections = info.selections;
    return result;
  }

  async function getLogCategories(apiKey) {
    const body = await request('/torn/logcategories', apiKey, undefined, 'torn.logcategories');
    if (!Array.isArray(body && body.logcategories)) {
      return malformed('torn.logcategories.validate', 'Torn log category response is incomplete');
    }
    return body.logcategories;
  }

  async function getUserRevives(apiKey, { direction, from, to, limit = 100, sort = 'ASC' } = {}) {
    if (!['incoming', 'outgoing'].includes(direction)) throw new Error('Revive direction must be incoming or outgoing');
    const body = await request('/user/revives', apiKey, { filters: direction, from, to, limit, sort }, 'user.revives');
    if (!Array.isArray(body && body.revives)) {
      return malformed('user.revives.validate', 'Torn revives response is incomplete');
    }
    return body.revives;
  }

  async function getUserProfile(apiKey) {
    const body = await request('/user/profile', apiKey, undefined, 'user.profile');
    const profile = body && (body.profile || body);
    if (!profile || typeof profile !== 'object') {
      return malformed('user.profile.validate', 'Torn profile response is incomplete');
    }
    return profile;
  }

  async function getUserLogs(apiKey, { categoryId, targetTornId, from, to, limit = 100 } = {}) {
    if (!Number.isSafeInteger(Number(categoryId)) || Number(categoryId) <= 0) throw new Error('Log category ID is required');
    const body = await request('/user/log', apiKey, {
      cat: Number(categoryId),
      target: targetTornId == null ? undefined : Number(targetTornId),
      from,
      to,
      limit
    }, 'user.log');
    if (!Array.isArray(body && body.log)) {
      return malformed('user.log.validate', 'Torn log response is incomplete');
    }
    return body.log;
  }

  return {
    getKeyInfo,
    getLogCategories,
    getUserRevives,
    getUserProfile,
    getUserLogs
  };
}

module.exports = {
  createTornClient,
  TornApiError
};
