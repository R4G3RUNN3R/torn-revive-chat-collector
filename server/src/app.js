const Fastify = require('fastify');
const fastifyRateLimit = require('@fastify/rate-limit');
const { registerAuthRoute } = require('./routes/auth');
const { registerCandidateRoutes } = require('./routes/candidates');
const { registerRequestRoutes } = require('./routes/requests');
const { registerReviverQueueRoutes } = require('./routes/reviver-queue');
const { registerMeRoute } = require('./routes/me');
const { registerVerificationCredentialRoutes } = require('./routes/verification-credential');
const { registerReviverRoutes } = require('./routes/revivers');
const { registerTransactionRoutes } = require("./routes/transactions");
const { installAuthentication } = require('./security/authenticate');

function buildApp({
  config,
  tornClient,
  identityRepository,
  sessionRepository = null,
  candidateRepository = null,
  requestRepository = null,
  transactionRepository = null,
  verificationCredentialRepository = null,
  logMetadataResolver = null,
  reviverRepository = null,
  transactionService = null,
  jobRepository = null,
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

  if (verificationCredentialRepository) {
    if (!sessionRepository) throw new Error('verification credential routes require a sessionRepository');
    if (!logMetadataResolver) throw new Error('verification credential routes require logMetadataResolver');
    app.register(async instance => {
      await registerVerificationCredentialRoutes(instance, {
        tornClient,
        verificationCredentialRepository,
        logMetadataResolver
      });
    });
  }

  if (reviverRepository) {
    if (!sessionRepository || !verificationCredentialRepository) {
      throw new Error('reviver registration requires session and verification credential repositories');
    }
    app.register(async instance => {
      await registerReviverRoutes(instance, { verificationCredentialRepository, reviverRepository });
    });
  }


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
    if (!verificationCredentialRepository) throw new Error('request routes require a verificationCredentialRepository');
    if (!sessionRepository) {
      throw new Error('request routes require a sessionRepository');
    }
    app.register(async instance => {
      await registerRequestRoutes(instance, { requestRepository, verificationCredentialRepository });
    });
  }

  if (transactionRepository) {
    if (!verificationCredentialRepository) throw new Error('reviver queue routes require a verificationCredentialRepository');
    if (!sessionRepository) {
      throw new Error('reviver queue routes require a sessionRepository');
    }
    app.register(async instance => {
      await registerReviverQueueRoutes(instance, { transactionRepository, verificationCredentialRepository });
    });
  }

  if (transactionRepository && transactionService && jobRepository) {
    if (!sessionRepository) throw new Error("transaction action routes require a sessionRepository");
    app.register(async instance => {
      await registerTransactionRoutes(instance,{transactionRepository,transactionService,jobRepository});
    });
  }

  return app;
}

module.exports = {
  buildApp
};
