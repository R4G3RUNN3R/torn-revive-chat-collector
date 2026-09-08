const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createProInvoiceRepository } = require('./db/pro-invoices');
const { createTornClient } = require('./torn/client');
const { createLogMetadataResolver } = require('./torn/log-metadata');
const { createProBillingEvidenceService } = require('./torn/pro-billing-evidence');
const { createSubscriptionScanHandler, SCAN_INTERVAL_MS } = require('./worker/subscription-scan');
const { PRO_MERCHANT_TORN_ID } = require('./domain/subscription-mode');

function validDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function configureReviewSubscriptionHandler({
  config,
  tornClient,
  logMetadataResolver,
  invoiceRepository,
  evidenceFactory = createProBillingEvidenceService,
  handlerFactory = createSubscriptionScanHandler
} = {}) {
  if (!config || config.SUBSCRIPTION_MODE !== 'review') {
    throw new Error('Review subscription worker requires review mode');
  }
  if (Number(config.PRO_RECEIVER_TORN_ID) !== PRO_MERCHANT_TORN_ID) {
    throw new Error(`Review subscription worker canonical merchant must be ${PRO_MERCHANT_TORN_ID}`);
  }
  if (!invoiceRepository) throw new Error('invoiceRepository is required');

  const evidenceService = evidenceFactory({
    tornClient,
    logMetadataResolver,
    receiverApiKey:config.PRO_RECEIVER_API_KEY,
    receiverTornId:config.PRO_RECEIVER_TORN_ID
  });
  if (!evidenceService || typeof evidenceService.validateCredential !== 'function') {
    throw new Error('Review billing evidence service must validate its credential');
  }
  await evidenceService.validateCredential();
  return handlerFactory({ invoiceRepository, evidenceService });
}

async function runSubscriptionLoop({
  handler,
  sleep = defaultSleep,
  signal = { stop:false },
  clock = () => new Date(),
  logger = console
} = {}) {
  if (typeof handler !== 'function') throw new Error('subscription handler is required');
  if (typeof sleep !== 'function') throw new Error('sleep must be a function');
  if (typeof clock !== 'function') throw new Error('clock must be a function');

  while (!signal.stop) {
    let result;
    try {
      result = await handler();
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`ReviveRelay review subscription scan failed: ${String(error && error.message || error)}`);
      }
      if (signal.stop) break;
      await sleep(SCAN_INTERVAL_MS);
      continue;
    }
    if (signal.stop) break;

    const now = clock();
    if (!validDate(now)) throw new Error('clock returned an invalid date');
    const requested = result && validDate(result.runAt)
      ? Math.max(0, result.runAt.getTime() - now.getTime())
      : SCAN_INTERVAL_MS;
    await sleep(requested);
  }
}

async function start() {
  const config = loadConfig(process.env);
  const pool = createPool(config.DATABASE_URL);
  const tornClient = createTornClient({ baseUrl:config.TORN_API_BASE_URL });
  const logMetadataResolver = createLogMetadataResolver({ tornClient });
  const invoiceRepository = createProInvoiceRepository(pool);
  const signal = { stop:false };

  const requestStop = name => {
    console.info(`ReviveRelay review subscription worker received ${name}; stopping after current scan.`);
    signal.stop = true;
  };
  process.once('SIGINT', () => requestStop('SIGINT'));
  process.once('SIGTERM', () => requestStop('SIGTERM'));

  try {
    const handler = await configureReviewSubscriptionHandler({
      config,
      tornClient,
      logMetadataResolver,
      invoiceRepository
    });
    await runSubscriptionLoop({ handler, signal, logger:console });
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
  configureReviewSubscriptionHandler,
  runSubscriptionLoop,
  start
};
