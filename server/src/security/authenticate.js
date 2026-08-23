const { hashSessionToken } = require('./sessions');

class AuthenticationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

function extractBearerToken(request) {
  const header = request && request.headers && request.headers.authorization;
  if (typeof header !== 'string') {
    throw new AuthenticationError('AUTH_REQUIRED', 'Bearer token required');
  }

  const match = /^Bearer\s+([^\s]+)$/.exec(header.trim());
  if (!match) {
    throw new AuthenticationError('AUTH_REQUIRED', 'Bearer token required');
  }

  return match[1];
}

function createAuthenticator({ sessionRepository, pepper, now = () => new Date() }) {
  if (!sessionRepository || typeof sessionRepository.findByTokenHash !== 'function') {
    throw new TypeError('Session repository is required');
  }
  if (typeof pepper !== 'string' || pepper.length === 0) {
    throw new TypeError('Session token pepper is required');
  }

  return async function authenticateRequest(request) {
    const token = extractBearerToken(request);
    const tokenHash = hashSessionToken(token, pepper);
    const stored = await sessionRepository.findByTokenHash(tokenHash);

    if (!stored) {
      throw new AuthenticationError('AUTH_REQUIRED', 'Session not found');
    }
    if (stored.sessionRevokedAt) {
      throw new AuthenticationError('SESSION_REVOKED', 'Session has been revoked');
    }
    if (stored.expiresAt && new Date(stored.expiresAt).getTime() <= now().getTime()) {
      throw new AuthenticationError('SESSION_EXPIRED', 'Session has expired');
    }
    if (stored.accountState !== 'active') {
      throw new AuthenticationError('ACCOUNT_DISABLED', 'ReviveRelay account is disabled');
    }

    const roles = ['user'];
    if (
      stored.isReviver &&
      stored.reviverStanding === 'ACTIVE' &&
      !stored.activeBan
    ) {
      roles.push('reviver');
    }

    return {
      userId: stored.userId,
      tornId: Number(stored.tornId),
      roles,
      sessionId: stored.sessionId
    };
  };
}

module.exports = {
  AuthenticationError,
  createAuthenticator,
  extractBearerToken
};
