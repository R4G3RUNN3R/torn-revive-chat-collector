const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createJobRepository, JOB_TYPES } = require('./db/jobs');
const { createErrorTelemetryRepository } = require('./db/error-telemetry');
const { createTelemetryReporter } = require('./telemetry/reporter');
const { createVerificationCredentialRepository } = require('./db/verification-credentials');
const { createPaymentRepository } = require('./db/payments');
const { createRefundRepository } = require('./db/refunds');
const { createReviveAttemptRepository } = require('./db/revive-attempts');
const { createTransactionService } = require('./domain/transaction-service');
const { createTornClient } = require('./torn/client');
const { createLogMetadataResolver } = require('./torn/log-metadata');
const { createTornEvidenceService } = require('./torn/evidence');
const { createPaymentVerifyHandler } = require('./worker/payment-verify');
const { createReviveVerifyHandler } = require('./worker/revive-verify');
const { createRefundVerifyHandler } = require('./worker/refund-verify');
const { createWorkerRunner } = require('./worker/runner');
const { createGoogleSheetsClient } = require('./integrations/google-sheets');
const { createSheetsMirrorHandler } = require('./worker/sheets-mirror');
const { createTelemetryRetentionHandler } = require('./worker/telemetry-retention');

function unimplementedHandler(stage, type) {
  return async () => {
    throw new Error(`${type} handler is not implemented in ${stage} yet`);
  };
}

function buildStageThreeHandlers({ paymentVerifyHandler, reviveVerifyHandler, refundVerifyHandler, sheetsMirrorHandler = null, telemetryRetentionHandler = null }) {
  if (typeof paymentVerifyHandler !== 'function') throw new Error('paymentVerifyHandler is required');
  if (typeof reviveVerifyHandler !== 'function') throw new Error('reviveVerifyHandler is required');
  if (typeof refundVerifyHandler !== 'function') throw new Error('refundVerifyHandler is required');

  return Object.fromEntries(JOB_TYPES.map(type => {
    if (type === 'payment.verify') return [type, paymentVerifyHandler];
    if (type === 'revive.verify') return [type, reviveVerifyHandler];
    if (type === 'refund.verify') return [type, refundVerifyHandler];
    if (type === 'sheets.mirror' && typeof sheetsMirrorHandler === 'function') return [type, sheetsMirrorHandler];
    if (type === 'telemetry.retention' && typeof telemetryRetentionHandler === 'function') return [type, telemetryRetentionHandler];
    return [type, unimplementedHandler('Stage 3', type)];
  }));
}

async function start() {
  const config = loadConfig(process.env);
  const pool = createPool(config.DATABASE_URL);
  const errorTelemetryRepository = createErrorTelemetryRepository(pool);
  const telemetryReporter = createTelemetryReporter({
    repository: errorTelemetryRepository,
    product: 'reviverelay',
    version: process.env.REVIVERELAY_VERSION || '0.3.0',
    buildCommit: process.env.REVIVERELAY_BUILD_COMMIT || null
  });
  const jobRepository = createJobRepository(pool);
  const verificationCredentialRepository = createVerificationCredentialRepository(pool, {
    encryptionKeyHex: config.API_KEY_ENCRYPTION_KEY
  });
  const paymentRepository = createPaymentRepository(pool);
  const refundRepository = createRefundRepository(pool);
  const reviveAttemptRepository = createReviveAttemptRepository(pool);
  const transactionService = createTransactionService(pool);
  const tornClient = createTornClient({ baseUrl: config.TORN_API_BASE_URL, telemetryReporter });
  const logMetadataResolver = createLogMetadataResolver({ tornClient });
  const evidenceService = createTornEvidenceService({
    tornClient,
    verificationCredentialRepository,
    logMetadataResolver
  });
  const paymentVerifyHandler = createPaymentVerifyHandler({
    paymentRepository,
    transactionService,
    evidenceService,
    jobRepository
  });
  const reviveVerifyHandler = createReviveVerifyHandler({
    reviveAttemptRepository,
    transactionService,
    evidenceService
  });
  const refundVerifyHandler = createRefundVerifyHandler({
    refundRepository,
    transactionService,
    evidenceService
  });
  const sheetsConfigured = Boolean(
    config.REVIVERELAY_GOOGLE_SERVICE_ACCOUNT_FILE && config.REVIVERELAY_ERROR_SHEET_ID
  );
  const sheetsMirrorHandler = sheetsConfigured ? createSheetsMirrorHandler({
    telemetryRepository: errorTelemetryRepository,
    sheetsClient: createGoogleSheetsClient({
      credentialsPath: config.REVIVERELAY_GOOGLE_SERVICE_ACCOUNT_FILE,
      spreadsheetId: config.REVIVERELAY_ERROR_SHEET_ID,
      sheetName: config.REVIVERELAY_ERROR_SHEET_TAB
    }),
    telemetryReporter
  }) : null;
  if (sheetsMirrorHandler) {
    await jobRepository.enqueueUniqueJob({
      type: 'sheets.mirror',
      runAt: new Date(),
      dedupeKey: 'sheets.mirror:reviverelay-errors',
      payload: {}
    });
  }
  const telemetryRetentionHandler = createTelemetryRetentionHandler({
    telemetryRepository: errorTelemetryRepository
  });
  await jobRepository.enqueueUniqueJob({
    type: 'telemetry.retention',
    runAt: new Date(),
    dedupeKey: 'telemetry.retention:reviverelay-errors',
    payload: {}
  });
  const runner = createWorkerRunner({
    workerId: process.env.REVIVERELAY_WORKER_ID || `worker-${process.pid}`,
    jobRepository,
    handlers: buildStageThreeHandlers({ paymentVerifyHandler, reviveVerifyHandler, refundVerifyHandler, sheetsMirrorHandler, telemetryRetentionHandler }),
    logger: console,
    telemetryReporter
  });

  const requestStop = signal => {
    console.info(`ReviveRelay worker received ${signal}; finishing current work before exit.`);
    runner.stop();
  };

  process.once('SIGINT', () => requestStop('SIGINT'));
  process.once('SIGTERM', () => requestStop('SIGTERM'));

  try {
    await runner.run();
  } catch (error) {
    await telemetryReporter.report(error, { component: 'worker', operation: 'worker.run' });
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  start().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildStageThreeHandlers,
  start
};
