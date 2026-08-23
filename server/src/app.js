const Fastify = require('fastify');
const { registerAuthRoute } = require('./routes/auth');
const { registerCandidateRoutes } = require('./routes/candidates');
const { registerRequestRoutes } = require('./routes/requests');
const { installAuthentication } = require('./security/authenticate');

function buildApp({
  config,
  tornClient,
  identityRepository,
  sessionRepository = null,
  candidateRepository = null,
  requestRepository = null,
  logger = false
}) {
  if (!config) throw new Error('config is required');
  if (!tornClient) throw new Error('tornClient is required');
  if (!identityRepository) throw new Error('identityRepository is required');

  const app = Fastify({ logger });

  if (sessionRepository) {
    installAuthentication(app, {
      sessionRepository,
      pepper: config.SESSION_TOKEN_PEPPER
    });
  }

  app.get('/health', async () => ({ ok: true }));

  app.register(async instance => {
    await registerAuthRoute(instance, {
      config,
      tornClient,
      identityRepository
    });
  });

  if (candidateRepository) {
    if (!sessionRepository) {
      throw new Error('candidate routes require a sessionRepository');
    }
    app.register(async instance => {
      await registerCandidateRoutes(instance, { candidateRepository });
    });
  }

  if (requestRepository) {
    if (!sessionRepository) {
      throw new Error('request routes require a sessionRepository');
    }
    app.register(async instance => {
      await registerRequestRoutes(instance, { requestRepository });
    });
  }

  return app;
}

module.exports = {
  buildApp
};
