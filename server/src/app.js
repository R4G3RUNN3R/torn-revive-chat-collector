const Fastify = require('fastify');
const fastifyRateLimit = require('@fastify/rate-limit');
const { registerAuthRoute } = require('./routes/auth');
const { registerRequestRoutes } = require('./routes/requests');
const { registerReviverQueueRoutes } = require('./routes/reviver-queue');
const { registerMeRoute } = require('./routes/me');
const { registerProRoutes } = require('./routes/pro');
const { registerVerificationCredentialRoutes } = require('./routes/verification-credential');
const { registerReviverRoutes } = require('./routes/revivers');
const { registerTransactionRoutes } = require("./routes/transactions");
const { registerTelemetryRoutes } = require("./routes/telemetry");
const { registerClientVersionRoute } = require('./routes/client-version');
const { registerAdminProRoutes } = require('./routes/admin-pro');
const { installAuthentication } = require('./security/authenticate');
const { createClientVersionPreHandler } = require('./security/client-version');

function buildApp({
  config,
  tornClient,
  identityRepository,
  sessionRepository = null,
  entitlementRepository = null,
  proInvoiceRepository = null,
  candidateRepository = null,
  requestRepository = null,
  transactionRepository = null,
  verificationCredentialRepository = null,
  logMetadataResolver = null,
  reviverRepository = null,
  transactionService = null,
  jobRepository = null,
  errorTelemetryRepository = null,
  releaseRegistry = null,
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

  if (releaseRegistry) {
    app.addHook('preHandler', createClientVersionPreHandler({ releaseRegistry }));
  }

  if (sessionRepository) {
    installAuthentication(app, {
      sessionRepository,
      pepper: config.SESSION_TOKEN_PEPPER
    });
    app.register(async instance => {
      await registerMeRoute(instance, { entitlementRepository, config });
    });
    if (entitlementRepository) {
      app.register(async instance => {
        await registerProRoutes(instance, {
          entitlementRepository,
          proInvoiceRepository,
          verificationCredentialRepository,
          tornClient,
          config
        });
      });
    }
  }

  app.get('/health', async () => ({ ok: true }));

  if (config.ADMIN_API_TOKEN) {
    if (!entitlementRepository || typeof identityRepository.findByTornId!=='function') {
      throw new Error('admin Pro routes require entitlement repository and identity lookup');
    }
    app.register(async instance => {
      await registerAdminProRoutes(instance,{config,identityRepository,entitlementRepository});
    });
  }

  if (releaseRegistry) {
    app.register(async instance => {
      await registerClientVersionRoute(instance, { releaseRegistry });
    });
  }

  if (errorTelemetryRepository) {
    app.register(async instance => {
      await registerTelemetryRoutes(instance, { errorTelemetryRepository });
    });
  }

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
    if (!sessionRepository || !verificationCredentialRepository || !entitlementRepository) {
      throw new Error('reviver registration requires session, entitlement and verification credential repositories');
    }
    app.register(async instance => {
      await registerReviverRoutes(instance, {
        tornClient,
        verificationCredentialRepository,
        reviverRepository,
        entitlementRepository,
        config
      });
    });
  }


  app.register(async instance => {
    await registerAuthRoute(instance, {
      config,
      tornClient,
      identityRepository
    });
  });

  if (requestRepository) {
    if (!sessionRepository) {
      throw new Error('request routes require a sessionRepository');
    }
    app.register(async instance => {
      await registerRequestRoutes(instance, { requestRepository });
    });
  }

  if (transactionRepository) {
    if (!verificationCredentialRepository) throw new Error('reviver queue routes require a verificationCredentialRepository');
    if (!entitlementRepository) throw new Error('reviver queue routes require an entitlementRepository');
    if (!sessionRepository) {
      throw new Error('reviver queue routes require a sessionRepository');
    }
    app.register(async instance => {
      await registerReviverQueueRoutes(instance, {
        transactionRepository,
        verificationCredentialRepository,
        entitlementRepository,
        tornClient,
        config
      });
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
