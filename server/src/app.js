const Fastify = require('fastify');
const fastifyRateLimit = require('@fastify/rate-limit');
const { registerAuthRoute } = require('./routes/auth');
const { registerCandidateRoutes } = require('./routes/candidates');
const { registerRequestRoutes } = require('./routes/requests');
const { registerReviverQueueRoutes } = require('./routes/reviver-queue');
const { registerMeRoute } = require('./routes/me');
const { installAuthentication } = require('./security/authenticate');

function buildApp({
  config,
  tornClient,
  identityRepository,
  sessionRepository = null,
  candidateRepository = null,
  requestRepository = null,
  transactionRepository = null,
  logger = false
}) {
  if (!config) throw new Error('config is required');
  if (!tornClient) throw new Error('tornClient is required');
  if (!identityRepository) throw new Error('identityRepository is required');

  const app = Fastify({
    logger,
    trustProxy: true
  });

  app.register(fastifyRateLimit, {
    global: false
  });

  if (sessionRepository) {
    installAuthentication(app, {
      sessionRepository,
      pepper: config.SESSION_TOKEN_PEPPER
    });
    app.register(async instance => {
      await registerMeRoute(instance);
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

  if (transactionRepository) {
    if (!sessionRepository) {
      throw new Error('reviver queue routes require a sessionRepository');
    }
    app.register(async instance => {
      await registerReviverQueueRoutes(instance, { transactionRepository });
    });
  }

  return app;
}

module.exports = {
  buildApp
};
