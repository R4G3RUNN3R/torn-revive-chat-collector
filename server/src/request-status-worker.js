const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createRequestRepository } = require('./db/requests');
const { createVerificationCredentialRepository } = require('./db/verification-credentials');
const { createTornClient } = require('./torn/client');
const { createRequestStatusScanHandler, REQUEST_STATUS_INTERVAL_MS } = require('./worker/request-status-scan');

const ERROR_RETRY_MS = 60 * 1000;

function validDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildRequestStatusHandler({ config, pool }) {
  return createRequestStatusScanHandler({
    requestRepository: createRequestRepository(pool),
    verificationCredentialRepository: createVerificationCredentialRepository(pool, {
      encryptionKeyHex: config.API_KEY_ENCRYPTION_KEY
    }),
    tornClient: createTornClient({ baseUrl: config.TORN_API_BASE_URL })
  });
}

async function runRequestStatusLoop({
  handler,
  sleep = defaultSleep,
  signal = { stop: false },
  clock = () => new Date(),
  logger = console
} = {}) {
  if (typeof handler !== 'function') throw new Error('request status handler is required');
  if (typeof sleep !== 'function') throw new Error('sleep must be a function');
  if (typeof clock !== 'function') throw new Error('clock must be a function');

  while (!signal.stop) {
    let result;
    try {
      result = await handler();
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`ReviveRelay request status scan failed: ${String(error && error.message || error)}`);
      }
      if (signal.stop) break;
      await sleep(ERROR_RETRY_MS);
      continue;
    }
    if (signal.stop) break;

    const now = clock();
    if (!validDate(now)) throw new Error('clock returned an invalid date');
    const requested = result && validDate(result.runAt)
      ? Math.max(0, result.runAt.getTime() - now.getTime())
      : REQUEST_STATUS_INTERVAL_MS;
    await sleep(requested);
  }
}

async function start() {
  const config = loadConfig(process.env);
  const pool = createPool(config.DATABASE_URL);
  const signal = { stop: false };

  const requestStop = name => {
    console.info(`ReviveRelay request status worker received ${name}; stopping after current scan.`);
    signal.stop = true;
  };
  process.once('SIGINT', () => requestStop('SIGINT'));
  process.once('SIGTERM', () => requestStop('SIGTERM'));

  try {
    const handler = buildRequestStatusHandler({ config, pool });
    await runRequestStatusLoop({ handler, signal, logger: console });
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
  ERROR_RETRY_MS,
  buildRequestStatusHandler,
  runRequestStatusLoop,
  start
};
