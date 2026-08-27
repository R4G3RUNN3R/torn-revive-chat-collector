const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createIdentityRepository } = require('./db/users');
const { createSessionRepository } = require('./db/sessions');
const { createCandidateRepository } = require('./db/candidates');
const { createRequestRepository } = require('./db/requests');
const { createTransactionRepository } = require('./db/transactions');
const { createJobRepository } = require("./db/jobs");
const { createTransactionService } = require("./domain/transaction-service");
const { createVerificationCredentialRepository } = require('./db/verification-credentials');
const { createReviverRepository } = require('./db/revivers');
const { createErrorTelemetryRepository } = require('./db/error-telemetry');
const { createTelemetryReporter } = require('./telemetry/reporter');
const { loadReleaseManifest } = require('./release/registry');
const { createTornClient } = require('./torn/client');
const { createLogMetadataResolver } = require('./torn/log-metadata');
const { buildApp } = require('./app');

async function start() {
  const config = loadConfig(process.env);
  const pool = createPool(config.DATABASE_URL);
  const releaseRegistry = config.REVIVERELAY_RELEASE_MANIFEST_FILE
    ? loadReleaseManifest(config.REVIVERELAY_RELEASE_MANIFEST_FILE)
    : null;
  const identityRepository = createIdentityRepository(pool);
  const sessionRepository = createSessionRepository(pool);
  const candidateRepository = createCandidateRepository(pool);
  const requestRepository = createRequestRepository(pool);
  const transactionRepository = createTransactionRepository(pool);
  const transactionService = createTransactionService(pool);
  const jobRepository = createJobRepository(pool);
  const verificationCredentialRepository = createVerificationCredentialRepository(pool, {
    encryptionKeyHex: config.API_KEY_ENCRYPTION_KEY
  });
  const reviverRepository = createReviverRepository(pool);
  const errorTelemetryRepository = createErrorTelemetryRepository(pool);
  const telemetryReporter = createTelemetryReporter({
    repository: errorTelemetryRepository,
    product: 'reviverelay',
    version: process.env.REVIVERELAY_VERSION || '0.3.0',
    buildCommit: process.env.REVIVERELAY_BUILD_COMMIT || null
  });
  const tornClient = createTornClient({
    baseUrl: config.TORN_API_BASE_URL,
    telemetryReporter
  });
  const logMetadataResolver = createLogMetadataResolver({ tornClient });
  const app = buildApp({
    config,
    tornClient,
    identityRepository,
    sessionRepository,
    candidateRepository,
    requestRepository,
    transactionRepository,
    transactionService,
    jobRepository,
    verificationCredentialRepository,
    reviverRepository,
    errorTelemetryRepository,
    releaseRegistry,
    logMetadataResolver,
    logger: true
  });

  const close = async signal => {
    try {
      await app.close();
      await pool.end();
    } finally {
      if (signal) process.exit(0);
    }
  };

  process.once('SIGINT', () => close('SIGINT'));
  process.once('SIGTERM', () => close('SIGTERM'));

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (error) {
    await telemetryReporter.report(error, { component: 'api', operation: 'startup.listen' });
    await close();
    throw error;
  }
}

if (require.main === module) {
  start().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  start
};
