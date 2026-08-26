class TornApiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'TornApiError';
    this.code = code;
    this.status = options.status;
  }
}

function createTornClient({ baseUrl = 'https://api.torn.com/v2', fetchImpl = globalThis.fetch } = {}) {
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

  async function request(path, apiKey, query) {
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new TornApiError('TORN_INVALID_KEY', 'Torn API key is required');
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
    } catch (_) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn API request failed');
    }

    let body;
    try {
      body = await response.json();
    } catch (_) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn API returned invalid JSON', { status: response.status });
    }

    const apiErrorCode = body && body.error && Number(body.error.code);
    if (response.status === 401 || response.status === 403 || apiErrorCode === 2) {
      throw new TornApiError('TORN_INVALID_KEY', 'Torn API key is invalid or unauthorized', { status: response.status });
    }
    if (!response.ok || (body && body.error)) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn API is temporarily unavailable', { status: response.status });
    }
    return body;
  }

  async function getKeyInfo(apiKey) {
    const keyResponse = await request('/key/info', apiKey);
    const info = keyResponse && (keyResponse.info || keyResponse);
    const user = info && info.user;
    const tornId = Number(user && user.id);
    if (!Number.isSafeInteger(tornId) || tornId <= 0 || !info.access) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn key info response is incomplete');
    }

    const basicResponse = await request('/user/basic', apiKey);
    const basic = basicResponse && (basicResponse.profile || basicResponse);
    const basicId = Number(basic && (basic.id ?? basic.player_id));
    const name = basic && basic.name;
    if (basicId !== tornId || typeof name !== 'string' || name.length === 0) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn identity response is inconsistent');
    }

    const result = { tornId, name, access: info.access };
    if (info.selections && typeof info.selections === 'object') result.selections = info.selections;
    return result;
  }

  async function getLogCategories(apiKey) {
    const body = await request('/torn/logcategories', apiKey);
    if (!Array.isArray(body && body.logcategories)) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn log category response is incomplete');
    }
    return body.logcategories;
  }

  async function getUserRevives(apiKey, { direction, from, to, limit = 100, sort = 'ASC' } = {}) {
    if (!['incoming', 'outgoing'].includes(direction)) throw new Error('Revive direction must be incoming or outgoing');
    const body = await request('/user/revives', apiKey, { filters: direction, from, to, limit, sort });
    if (!Array.isArray(body && body.revives)) throw new TornApiError('TORN_UNAVAILABLE', 'Torn revives response is incomplete');
    return body.revives;
  }

  async function getUserProfile(apiKey) {
    const body = await request('/user/profile', apiKey);
    const profile = body && (body.profile || body);
    if (!profile || typeof profile !== 'object') throw new TornApiError('TORN_UNAVAILABLE', 'Torn profile response is incomplete');
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
    });
    if (!Array.isArray(body && body.log)) throw new TornApiError('TORN_UNAVAILABLE', 'Torn log response is incomplete');
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
