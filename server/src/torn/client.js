class TornApiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TornApiError';
    this.code = code;
    this.details = details;
  }
}

function classifyTornError(apiError) {
  const numericCode = Number(apiError && apiError.code);

  if ([1, 2, 13, 18].includes(numericCode)) {
    return new TornApiError('TORN_INVALID_KEY', 'Torn rejected or disabled the API key', { tornCode: numericCode });
  }
  if (numericCode === 16) {
    return new TornApiError('TORN_KEY_ACCESS', 'The Torn API key does not grant the required selection', { tornCode: numericCode });
  }
  if ([5, 8, 9, 12, 14, 15, 17, 24].includes(numericCode)) {
    return new TornApiError('TORN_UNAVAILABLE', 'Torn API is temporarily unavailable', { tornCode: numericCode });
  }

  return new TornApiError('TORN_API_ERROR', 'Torn API rejected the request', { tornCode: numericCode || null });
}

function createTornClient({ baseUrl = 'https://api.torn.com/v2', fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required');
  }

  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, '');

  async function request(path, apiKey) {
    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `ApiKey ${apiKey}`,
          Accept: 'application/json'
        }
      });
    } catch (error) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Unable to reach Torn API', { cause: error && error.message });
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new TornApiError('TORN_RESPONSE_INVALID', 'Torn API returned invalid JSON');
    }

    if (body && body.error) {
      throw classifyTornError(body.error);
    }

    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        throw new TornApiError('TORN_UNAVAILABLE', 'Torn API is temporarily unavailable', { status: response.status });
      }
      throw new TornApiError('TORN_API_ERROR', 'Torn API rejected the request', { status: response.status });
    }

    return body;
  }

  async function getKeyInfo(apiKey) {
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new TornApiError('TORN_INVALID_KEY', 'A Torn API key is required');
    }

    const keyBody = await request('/key/info', apiKey);
    const info = keyBody && keyBody.info;
    const keyUser = info && info.user;

    if (!info || !keyUser || !Number.isInteger(Number(keyUser.id)) || !info.access || !info.selections) {
      throw new TornApiError('TORN_RESPONSE_INVALID', 'Torn key information response is missing required fields');
    }

    const profileBody = await request('/user/basic', apiKey);
    const profile = profileBody && profileBody.profile;

    if (!profile || !Number.isInteger(Number(profile.id)) || typeof profile.name !== 'string' || profile.name.length === 0) {
      throw new TornApiError('TORN_RESPONSE_INVALID', 'Torn basic profile response is missing required fields');
    }

    const tornId = Number(keyUser.id);
    if (Number(profile.id) !== tornId) {
      throw new TornApiError('TORN_RESPONSE_INVALID', 'Torn key owner does not match the returned profile');
    }

    return {
      tornId,
      name: profile.name,
      access: {
        ...info.access,
        selections: info.selections
      }
    };
  }

  return {
    getKeyInfo
  };
}

module.exports = {
  TornApiError,
  createTornClient
};
