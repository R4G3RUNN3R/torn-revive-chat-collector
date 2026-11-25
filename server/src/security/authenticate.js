const { hashSessionToken } = require('./sessions');

// Session presence failures are logged at most once per this interval.
const PRESENCE_WARN_INTERVAL_MS = 60000;

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

function createAuthenticateRequest({ sessionRepository, pepper, now = () => new Date(), logger = console }) {
  if (!sessionRepository) throw new Error('sessionRepository is required');
  if (!pepper) throw new Error('session token pepper is required');

  let lastPresenceWarnAt = null;

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

    if (typeof sessionRepository.touch === 'function') {
      try {
        await sessionRepository.touch({ sessionId: record.sessionId, now: now() });
      } catch (error) {
        // Presence is best-effort and must never block authentication.
        const warnedAt = now().getTime();
        if (lastPresenceWarnAt === null || warnedAt - lastPresenceWarnAt >= PRESENCE_WARN_INTERVAL_MS) {
          lastPresenceWarnAt = warnedAt;
          logger.warn(`ReviveRelay session presence update failed: ${error && error.message ? error.message : error}`);
        }
      }
    }

    return {
      sessionId: record.sessionId,
      userId: record.userId,
      tornId: record.tornId,
      name: record.name || null,
      roles,
      reviverStanding: record.reviverStanding || null
    };
  };
}

function installAuthentication(app, { sessionRepository, pepper, now }) {
  const authenticateRequest = createAuthenticateRequest({ sessionRepository, pepper, now, logger: app.log });

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
