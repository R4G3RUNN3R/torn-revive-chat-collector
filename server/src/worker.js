const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createJobRepository, JOB_TYPES } = require('./db/jobs');
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

function unimplementedHandler(stage, type) {
  return async () => {
    throw new Error(`${type} handler is not implemented in ${stage} yet`);
  };
}

function buildStageThreeHandlers({ paymentVerifyHandler, reviveVerifyHandler, refundVerifyHandler }) {
  if (typeof paymentVerifyHandler !== 'function') throw new Error('paymentVerifyHandler is required');
  if (typeof reviveVerifyHandler !== 'function') throw new Error('reviveVerifyHandler is required');
  if (typeof refundVerifyHandler !== 'function') throw new Error('refundVerifyHandler is required');

  return Object.fromEntries(JOB_TYPES.map(type => {
    if (type === 'payment.verify') return [type, paymentVerifyHandler];
    if (type === 'revive.verify') return [type, reviveVerifyHandler];
    if (type === 'refund.verify') return [type, refundVerifyHandler];
    return [type, unimplementedHandler('Stage 3', type)];
  }));
}

async function start() {
  const config = loadConfig(process.env);
  const pool = createPool(config.DATABASE_URL);
  const jobRepository = createJobRepository(pool);
  const verificationCredentialRepository = createVerificationCredentialRepository(pool, {
    encryptionKeyHex: config.API_KEY_ENCRYPTION_KEY
  });
  const paymentRepository = createPaymentRepository(pool);
  const refundRepository = createRefundRepository(pool);
  const reviveAttemptRepository = createReviveAttemptRepository(pool);
  const transactionService = createTransactionService(pool);
  const tornClient = createTornClient({ baseUrl: config.TORN_API_BASE_URL });
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
  const runner = createWorkerRunner({
    workerId: process.env.REVIVERELAY_WORKER_ID || `worker-${process.pid}`,
    jobRepository,
    handlers: buildStageThreeHandlers({ paymentVerifyHandler, reviveVerifyHandler, refundVerifyHandler }),
    logger: console
  });

  const requestStop = signal => {
    console.info(`ReviveRelay worker received ${signal}; finishing current work before exit.`);
    runner.stop();
  };

  process.once('SIGINT', () => requestStop('SIGINT'));
  process.once('SIGTERM', () => requestStop('SIGTERM'));

  try {
    await runner.run();
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
