class TornApiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'TornApiError';
    this.code = code;
    this.status = options.status;
  }
}

function createTornClient({ baseUrl = 'https://api.torn.com/v2', fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required');
  }

  const normalizedBase = baseUrl.replace(/\/$/, '');

  async function request(path, apiKey) {
    let response;
    try {
      response = await fetchImpl(`${normalizedBase}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `ApiKey ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': 'ReviveRelay/0.1'
        }
      });
    } catch (error) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn API request failed');
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn API returned invalid JSON', {
        status: response.status
      });
    }

    const apiErrorCode = body && body.error && Number(body.error.code);
    if (response.status === 401 || response.status === 403 || apiErrorCode === 2) {
      throw new TornApiError('TORN_INVALID_KEY', 'Torn API key is invalid or unauthorized', {
        status: response.status
      });
    }

    if (!response.ok || (body && body.error)) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn API is temporarily unavailable', {
        status: response.status
      });
    }

    return body;
  }

  async function getKeyInfo(apiKey) {
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new TornApiError('TORN_INVALID_KEY', 'Torn API key is required');
    }

    const keyInfo = await request('/key/info', apiKey);
    const tornId = Number(keyInfo && keyInfo.user && keyInfo.user.id);
    if (!Number.isSafeInteger(tornId) || tornId <= 0 || !keyInfo.access) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn key info response is incomplete');
    }

    const basic = await request('/user/basic', apiKey);
    const basicId = Number(basic && (basic.id ?? basic.player_id));
    const name = basic && basic.name;

    if (basicId !== tornId || typeof name !== 'string' || name.length === 0) {
      throw new TornApiError('TORN_UNAVAILABLE', 'Torn identity response is inconsistent');
    }

    return {
      tornId,
      name,
      access: keyInfo.access
    };
  }

  return {
    getKeyInfo
  };
}

module.exports = {
  createTornClient,
  TornApiError
};
