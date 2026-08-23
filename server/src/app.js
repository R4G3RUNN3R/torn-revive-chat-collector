const Fastify = require('fastify');
const { registerAuthRoutes } = require('./routes/auth');
const { createAuthenticator } = require('./security/authenticate');

function authStatus(code) {
  if (code === 'ACCOUNT_DISABLED') return 403;
  return 401;
}

function createApp({ config, tornClient, userRepository, sessionRepository = null, logger = false }) {
  if (!config || !tornClient || !userRepository) {
    throw new TypeError('config, tornClient and userRepository are required');
  }

  const app = Fastify({ logger });
  const authenticateRequest = sessionRepository
    ? createAuthenticator({
      sessionRepository,
      pepper: config.SESSION_TOKEN_PEPPER
    })
    : null;

  app.decorateRequest('reviveRelayUser', null);
  app.decorate('authenticateReviveRelay', async function authenticateReviveRelay(request, reply) {
    if (!authenticateRequest) {
      return reply.code(500).send({
        ok: false,
        code: 'AUTH_NOT_CONFIGURED',
        message: 'ReviveRelay authentication is not configured'
      });
    }

    try {
      request.reviveRelayUser = await authenticateRequest(request);
    } catch (error) {
      const code = error && error.code ? error.code : 'AUTH_REQUIRED';
      return reply.code(authStatus(code)).send({
        ok: false,
        code,
        message: 'ReviveRelay authentication failed'
      });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  registerAuthRoutes(app, {
    config,
    tornClient,
    userRepository
  });

  return app;
}

module.exports = {
  createApp
};
