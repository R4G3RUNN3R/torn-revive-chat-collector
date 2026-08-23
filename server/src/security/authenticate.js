const { hashSessionToken } = require('./sessions');

class AuthError extends Error {
  constructor(code, statusCode = 401) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function extractBearerToken(request) {
  const header = request && request.headers && request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match && match[1] ? match[1] : null;
}

function createAuthenticateRequest({ sessionRepository, pepper, now = () => new Date() }) {
  if (!sessionRepository) throw new Error('sessionRepository is required');
  if (!pepper) throw new Error('session token pepper is required');

  return async function authenticateRequest(request) {
    const token = extractBearerToken(request);
    if (!token) throw new AuthError('AUTH_REQUIRED');

    const tokenHash = hashSessionToken(token, pepper);
    const record = await sessionRepository.findByTokenHash(tokenHash);
    if (!record) throw new AuthError('AUTH_REQUIRED');
    if (record.revokedAt) throw new AuthError('SESSION_REVOKED');

    if (record.expiresAt && new Date(record.expiresAt).getTime() <= now().getTime()) {
      throw new AuthError('SESSION_EXPIRED');
    }

    const roles = ['requester'];
    if (record.reviverStanding === 'active' && !record.activeBan) {
      roles.push('reviver');
    }

    return {
      sessionId: record.sessionId,
      userId: record.userId,
      tornId: record.tornId,
      roles,
      reviverStanding: record.reviverStanding || null
    };
  };
}

function installAuthentication(app, { sessionRepository, pepper, now }) {
  const authenticateRequest = createAuthenticateRequest({ sessionRepository, pepper, now });

  app.decorateRequest('reviveRelayUser', null);
  app.decorate('authenticate', async function authenticate(request, reply) {
    try {
      request.reviveRelayUser = await authenticateRequest(request);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ error: error.code });
      }
      throw error;
    }
  });

  return authenticateRequest;
}

module.exports = {
  AuthError,
  createAuthenticateRequest,
  installAuthentication
};
